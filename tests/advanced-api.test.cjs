const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const loader = require("@grpc/proto-loader");
const protobuf = require("protobufjs");
const { WebSocketServer } = require("ws");
const {
  sendHttp,
  interpolate,
  grpcRequest,
  createApiService,
} = require("../desktop/advanced-api.cjs");
test("HTTP client handles real REST, GraphQL, manual redirects and cancellation", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/slow") return;
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/ok" });
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          method: req.method,
          body,
          authorization: req.headers.authorization || null,
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const rest = await sendHttp({
      url: url + "/{{path}}",
      variables: { path: "ok" },
      method: "POST",
      body: "hello",
      token: "test",
    });
    assert.equal(rest.json.body, "hello");
    assert.equal(rest.json.authorization, "Bearer test");
    assert.ok(rest.durationMs >= 0);
    const graph = await sendHttp({
      url,
      mode: "graphql",
      query: "query { value }",
      graphqlVariables: '{"id":1}',
    });
    assert.equal(graph.json.method, "POST");
    assert.equal(JSON.parse(graph.json.body).variables.id, 1);
    assert.equal((await sendHttp({ url: url + "/redirect" })).status, 302);
    assert.throws(() => interpolate("{{missing}}", {}), /Missing/);
    await assert.rejects(sendHttp({ url: "file:///etc/passwd" }));
    const controller = new AbortController();
    const pending = sendHttp({ url: url + "/slow" }, controller.signal);
    controller.abort();
    await assert.rejects(pending);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test("gRPC client executes unary, server, client and bidirectional streaming against real server", async () => {
  const proto =
    'syntax="proto3";package test;message Message{string text=1;}service Echo{rpc Unary(Message)returns(Message);rpc Server(Message)returns(stream Message);rpc Client(stream Message)returns(Message);rpc Bidi(stream Message)returns(stream Message);}';
  const definition = loader.fromJSON(protobuf.parse(proto).root.toJSON());
  const server = new grpc.Server();
  server.addService(definition["test.Echo"], {
    Unary: (call, callback) => callback(null, call.request),
    Server: (call) => {
      call.write(call.request);
      call.end();
    },
    Client: (call, callback) => {
      const values = [];
      call.on("data", (value) => values.push(value.text));
      call.on("end", () => callback(null, { text: values.join(",") }));
    },
    Bidi: (call) => {
      call.on("data", (value) => call.write(value));
      call.on("end", () => call.end());
    },
  });
  const port = await new Promise((resolve, reject) =>
    server.bindAsync(
      "127.0.0.1:0",
      grpc.ServerCredentials.createInsecure(),
      (error, port) => (error ? reject(error) : resolve(port)),
    ),
  );
  try {
    const common = {
      proto,
      service: "test.Echo",
      target: "127.0.0.1:" + port,
      tls: false,
    };
    assert.equal(
      (await grpcRequest({ ...common, method: "Unary", body: '{"text":"hi"}' }))
        .json.text,
      "hi",
    );
    assert.equal(
      (
        await grpcRequest({
          ...common,
          method: "Server",
          body: '{"text":"hi"}',
        })
      ).json.length,
      1,
    );
    assert.equal(
      (
        await grpcRequest({
          ...common,
          method: "Client",
          body: '[{"text":"a"},{"text":"b"}]',
        })
      ).json.text,
      "a,b",
    );
    assert.equal(
      (await grpcRequest({ ...common, method: "Bidi", body: '[{"text":"a"}]' }))
        .json[0].text,
      "a",
    );
  } finally {
    await new Promise((resolve) => server.tryShutdown(resolve));
  }
});
test("vault never exposes plaintext listing, rejects insecure storage, and websocket sends/receives", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-api-"));
  const events = [];
  const vault = {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from("encrypted:" + text),
    decryptString: (buffer) => buffer.toString().slice(10),
  };
  const api = createApiService({
    root,
    safeStorage: vault,
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (_, event) => events.push(event) },
    }),
  });
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => server.on("listening", resolve));
  server.on("connection", (socket) =>
    socket.on("message", (data) => socket.send(data)),
  );
  try {
    const locked=createApiService({root,safeStorage:{...vault,isEncryptionAvailable:()=>false},getWindow:()=>null});
    await assert.rejects(locked('token-save',{name:'locked',value:'secret'}),/encryption/i);
    const plain=createApiService({root,safeStorage:{...vault,getSelectedStorageBackend:()=> 'basic_text'},getWindow:()=>null});
    await assert.rejects(plain('token-save',{name:'plain',value:'secret'}),/encryption/i);
    await api("token-save", { name: "dev", value: "secret" });
    assert.deepEqual(await api("token-list", {}), ["dev"]);
    assert.equal((await api("token-delete", { name: "dev" })).saved, true);
    await assert.rejects(api("token-save", { name: "__proto__", value: "x" }));
    await api("ws-open", {
      id: "one",
      url: "ws://127.0.0.1:" + server.address().port,
    });
    await waitFor(() => events.some((event) => event.kind === "open"));
    await api("ws-send", { id: "one", message: "hello" });
    await waitFor(() =>
      events.some(
        (event) => event.kind === "message" && event.data === "hello",
      ),
    );
    await api("ws-close", { id: "one" });
  } finally {
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
async function waitFor(predicate) {
  const limit = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > limit) throw new Error("Event timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
