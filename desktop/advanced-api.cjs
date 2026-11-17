const { performance } = require("node:perf_hooks");
const fs = require("node:fs");
const path = require("node:path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const WebSocket = require("ws");
function interpolate(text, variables = {}) {
  return String(text || "").replace(/\{\{([\w.-]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(variables, key))
      throw new Error(`Missing environment variable: ${key}`);
    return String(variables[key]);
  });
}
async function sendHttp(options, signal) {
  const variables = options.variables || {},
    url = new URL(interpolate(options.url, variables));
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Only HTTP(S) URLs are supported");
  if (url.username || url.password)
    throw new Error(
      "Use the authentication token field instead of URL credentials",
    );
  const method = String(options.method || "GET").toUpperCase();
  if (
    !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
      method,
    )
  )
    throw new Error("Unsupported method");
  const headers = {};
  for (const [key, value] of Object.entries(options.headers || {}))
    headers[key] = interpolate(value, variables);
  if (options.token) headers.Authorization = "Bearer " + options.token;
  let body = interpolate(options.body, variables);
  if (options.mode === "graphql") {
    body = JSON.stringify({
      query: interpolate(options.query, variables),
      variables: JSON.parse(options.graphqlVariables || "{}"),
    });
    headers["Content-Type"] = "application/json";
  }
  if (body.length > 1024 * 1024) throw new Error("Request body limit is 1 MB");
  const started = performance.now();
  const response = await fetch(url, {
    method: options.mode === "graphql" ? "POST" : method,
    headers,
    body:
      ["GET", "HEAD"].includes(method) && options.mode !== "graphql"
        ? undefined
        : body,
    redirect: "manual",
    signal: AbortSignal.any([
      signal || new AbortController().signal,
      AbortSignal.timeout(
        Math.min(60000, Math.max(1000, Number(options.timeout) || 15000)),
      ),
    ]),
  });
  let total = 0;
  const chunks = [];
  try {
    for await (const chunk of response.body || []) {
      total += chunk.length;
      if (total > 2 * 1024 * 1024)
        throw new Error("Response exceeded the 2 MB limit");
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    throw error;
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers),
    body: text,
    json,
    bytes: total,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
  };
}
function grpcRequest(options, signal) {
  return new Promise((resolve, reject) => {
    if (String(options.proto || "").length > 1024 * 1024)
      return reject(new Error("Proto limit is 1 MB"));
    let definition;
    try {
      const protobuf = require("protobufjs");
      const root = protobuf.parse(String(options.proto || "")).root;
      definition = protoLoader.fromJSON(root.toJSON(), {
        keepCase: true,
        defaults: true,
        oneofs: true,
      });
    } catch (error) {
      return reject(error);
    }
    const service = definition[options.service];
    if (!service)
      return reject(
        new Error(
          "Service not found in the supplied proto. Imports must be included inline.",
        ),
      );
    const method = service[options.method];
    if (!method) return reject(new Error("Method not found"));

    if (!/^[\w.:[\]-]+:\d+$/.test(String(options.target)))
      return reject(new Error("Target must be host:port"));
    const Client = grpc.makeGenericClientConstructor(service, options.service),
      client = new Client(
        options.target,
        options.tls === false
          ? grpc.credentials.createInsecure()
          : grpc.credentials.createSsl(),
        { "grpc.max_receive_message_length": 2 * 1024 * 1024 },
      );
    const metadata = new grpc.Metadata();
    if (options.token) metadata.set("authorization", "Bearer " + options.token);
    let request;
    try {
      if (String(options.body || "").length > 1024 * 1024)
        throw new Error("Message input exceeds 1 MB");
      request = JSON.parse(options.body || "{}");
      if (
        method.requestStream &&
        (!Array.isArray(request) || request.length > 1000)
      )
        throw new Error(
          "Streaming input must be an array of up to 1000 messages",
        );
    } catch (error) {
      client.close();
      return reject(error);
    }
    const started = performance.now(),
      deadline = new Date(Date.now() + 15000);
    let settled = false,
      call;
    const values = [];
    const abort = () => call?.cancel();
    const done = (error, result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      client.close();
      error
        ? reject(error)
        : resolve({
            body: JSON.stringify(result, null, 2),
            json: result,
            durationMs: performance.now() - started,
          });
    };
    if (method.responseStream) {
      call = method.requestStream
        ? client[options.method](metadata, { deadline })
        : client[options.method](request, metadata, { deadline });
      let bytes = 0;
      call.on("data", (value) => {
        bytes += Buffer.byteLength(JSON.stringify(value));
        values.push(value);
        if (values.length > 1000 || bytes > 2 * 1024 * 1024) {
          call.cancel();
          done(new Error("Stream exceeded the message/size limit"));
        }
      });
      call.on("error", (error) => done(error));
      call.on("end", () => done(null, values));
    } else
      call = method.requestStream
        ? client[options.method](metadata, { deadline }, done)
        : client[options.method](request, metadata, { deadline }, done);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    if (method.requestStream) {
      for (const item of request) call.write(item);
      call.end();
    }
  });
}
function createApiService({ safeStorage, root, getWindow }) {
  const controllers = new Map(),
    sockets = new Map();
  const vault = path.join(root, "api-tokens.json");
  function tokens() {
    try {
      return JSON.parse(fs.readFileSync(vault, "utf8"));
    } catch {
      return {};
    }
  }
  function token(name) {
    if (!name) return undefined;
    if (
      !safeStorage.isEncryptionAvailable() ||
      safeStorage.getSelectedStorageBackend?.() === "basic_text"
    )
      throw new Error("OS credential encryption is unavailable");
    const values = tokens();
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (!value) throw new Error("Selected token was not found");
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  }
  const invoke = async function api(action, options) {
    if (action === "token-list") return Object.keys(tokens());
    if (action === "token-save" || action === "token-delete") {
      if (
        ["__proto__", "prototype", "constructor"].includes(options.name) ||
        !/^[\w .-]{1,80}$/.test(options.name || "")
      )
        throw new Error("Token name must be 1–80 simple characters");
      const values = tokens();
      if (action === "token-delete") delete values[options.name];
      else {
        if (
          !safeStorage.isEncryptionAvailable() ||
          safeStorage.getSelectedStorageBackend?.() === "basic_text"
        )
          throw new Error("Secure OS credential encryption is unavailable");
        values[options.name] = safeStorage
          .encryptString(String(options.value))
          .toString("base64");
      }
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(vault + ".tmp", JSON.stringify(values), { mode: 0o600 });
      fs.renameSync(vault + ".tmp", vault);
      return { saved: true };
    }
    if (action === "cancel") {
      controllers.get(options.id)?.abort();
      return { cancelled: true };
    }
    if (action === "http") {
      const controller = new AbortController();
      controllers.set(options.id, controller);
      try {
        return await sendHttp(
          { ...options, token: token(options.tokenName) },
          controller.signal,
        );
      } finally {
        controllers.delete(options.id);
      }
    }
    if (action === "grpc") {
      const controller = new AbortController();
      controllers.set(options.id, controller);
      try {
        return await grpcRequest(
          { ...options, token: token(options.tokenName) },
          controller.signal,
        );
      } finally {
        controllers.delete(options.id);
      }
    }
    if (action === "ws-close") {
      sockets.get(options.id)?.close();
      sockets.delete(options.id);
      return { closed: true };
    }
    if (action === "ws-send") {
      const socket = sockets.get(options.id);
      if (!socket || socket.readyState !== WebSocket.OPEN)
        throw new Error("Socket is not connected");
      if (String(options.message).length > 65536)
        throw new Error("Message limit is 64 KB");
      socket.send(String(options.message));
      return { sent: true };
    }
    if (action === "ws-open") {
      const url = new URL(interpolate(options.url, options.variables));
      if (!["ws:", "wss:"].includes(url.protocol))
        throw new Error("Only WS(S) URLs are supported");
      if (sockets.size >= 8) throw new Error("Close a WebSocket session first");
      const socket = new WebSocket(url, {
        maxPayload: 1024 * 1024,
        handshakeTimeout: 10000,
        headers: options.tokenName
          ? { Authorization: "Bearer " + token(options.tokenName) }
          : {},
      });
      sockets.set(options.id, socket);
      const emit = (kind, data) => {
        const win = getWindow();
        if (win && !win.isDestroyed())
          win.webContents.send("api:event", {
            id: options.id,
            kind,
            data,
            time: new Date().toISOString(),
          });
      };
      socket.on("open", () => emit("open", "Connected"));
      socket.on("message", (data) =>
        emit("message", data.toString().slice(0, 100000)),
      );
      socket.on("error", (error) => emit("error", error.message));
      socket.on("close", () => {
        sockets.delete(options.id);
        emit("close", "Disconnected");
      });
      return { connecting: true };
    }
    throw new Error("Unsupported API action");
  };
  invoke.dispose = () => {
    for (const controller of controllers.values()) controller.abort();
    for (const socket of sockets.values()) socket.terminate();
    sockets.clear();
  };
  return invoke;
}
module.exports = { interpolate, sendHttp, grpcRequest, createApiService };
