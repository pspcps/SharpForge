const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.electronAPI = { isElectron: true };
  });
  await page.goto("/");
  await page.locator(".view-lines").first().waitFor();
});
test("toolbar remains on one row and the semantic C# categories have distinct colors", async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.locator(".view-lines span").evaluateAll((nodes) => {
        const find = (text) => nodes.find((node) => node.textContent === text);
        return ["UsersController", "IUserService", "_service"].map((text) => {
          const node = find(text);
          return node ? getComputedStyle(node).color : "";
        });
      }),
    )
    .toEqual(["rgb(78, 201, 176)", "rgb(120, 220, 232)", "rgb(199, 125, 187)"]);
  for (const width of [1024, 1280, 1920, 2048]) {
    await page.setViewportSize({ width, height: 900 });
    const header = page.locator("header").first(),
      rect = await header.boundingBox();
    expect(rect.height).toBeLessThanOrEqual(45);
    const boxes = await header.locator(":scope > div").evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }),
    );
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        expect(
          a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y,
        ).toBeFalsy();
      }
  }
});
test("dependency explorer supports inspection, type and call layers, Close and Escape", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Developer workbench", exact: true })
    .click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.locator(".react-flow__node").first().click();
  await expect(
    page.getByRole("combobox", { name: "Impact direction" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Types & interfaces", exact: true })
    .click();
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Method calls", exact: true }).click();
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0);
  await page
    .getByRole("button", { name: "Close developer workbench", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByRole("button", { name: "Developer workbench", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});
test("utilities validate XML and terminate a pathological regex without freezing the UI", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Developer workbench", exact: true })
    .click();
  await page.getByRole("button", { name: "Utilities", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Utility", exact: true })
    .selectOption("xml");
  await page
    .getByRole("textbox", { name: "Utility input", exact: true })
    .fill("<root><value>1</value></root>");
  await page
    .getByRole("button", { name: "Process locally", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Utility result", exact: true }),
  ).toContainText("");
  expect(
    await page
      .getByRole("textbox", { name: "Utility result", exact: true })
      .inputValue(),
  ).toContain("<value>1</value>");
  await page
    .getByRole("textbox", { name: "Regex pattern", exact: true })
    .fill("(a+)+$");
  await page
    .getByRole("textbox", { name: "Regex text", exact: true })
    .fill("a".repeat(10000) + "!");
  await page
    .getByRole("button", { name: "Test regular expression", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Regex exceeded" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close developer workbench", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("API UI sends real HTTP, GraphQL, gRPC and WebSocket requests through the desktop contract", async ({
  page,
}) => {
  const http = require("node:http"),
    fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path"),
    grpc = require("@grpc/grpc-js"),
    protoLoader = require("@grpc/proto-loader"),
    protobuf = require("protobufjs"),
    { WebSocketServer } = require("ws");
  const { createApiService } = require("../../desktop/advanced-api.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-api-ui-")),
    seen = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (data) => (body += data));
    request.on("end", () => {
      seen.push({ method: request.method, body });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const ws = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => ws.on("listening", resolve));
  ws.on("connection", (socket) =>
    socket.on("message", (data) => socket.send(data)),
  );
  const proto =
    'syntax="proto3";package demo;message Message{string text=1;}service Greeter{rpc Hello(Message)returns(Message);}';
  const rpc = new grpc.Server();
  rpc.addService(
    protoLoader.fromJSON(protobuf.parse(proto).root.toJSON())["demo.Greeter"],
    { Hello: (call, callback) => callback(null, call.request) },
  );
  const rpcPort = await new Promise((resolve, reject) =>
    rpc.bindAsync(
      "127.0.0.1:0",
      grpc.ServerCredentials.createInsecure(),
      (error, port) => (error ? reject(error) : resolve(port)),
    ),
  );
  const service = createApiService({
    root,
    safeStorage: { isEncryptionAvailable: () => false },
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (_, event) => {
          void page
            .evaluate(
              (event) =>
                window.dispatchEvent(
                  new CustomEvent("test-api-event", { detail: event }),
                ),
              event,
            )
            .catch(() => {});
        },
      },
    }),
  });
  try {
    await page.exposeFunction("testAdvanced", (_, action, options) =>
      service(action, options),
    );
    await page.evaluate(() => {
      window.electronAPI.advancedInvoke = window.testAdvanced;
      window.electronAPI.onAdvancedEvent = (_, callback) => {
        const handler = (event) => callback(event.detail);
        window.addEventListener("test-api-event", handler);
        return () => window.removeEventListener("test-api-event", handler);
      };
    });
    await page
      .getByRole("button", { name: "Developer workbench", exact: true })
      .click();
    await page.getByRole("button", { name: "API client", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Request URL", exact: true })
      .fill("http://127.0.0.1:" + server.address().port);
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await expect(page.getByText(/Response 200/)).toBeVisible();
    expect(seen[0].method).toBe("GET");
    await page
      .getByRole("combobox", { name: "API protocol", exact: true })
      .selectOption("graphql");
    await page
      .getByRole("textbox", { name: "GraphQL query", exact: true })
      .fill("query { test }");
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await expect.poll(() => seen.length).toBe(2);
    expect(seen[1].method).toBe("POST");
    expect(JSON.parse(seen[1].body).query).toBe("query { test }");
    await page
      .getByRole("combobox", { name: "API protocol", exact: true })
      .selectOption("grpc");
    await page
      .getByRole("textbox", { name: "gRPC target", exact: true })
      .fill("127.0.0.1:" + rpcPort);
    await page
      .getByRole("textbox", { name: "Proto definition", exact: true })
      .fill(proto);
    await page.getByRole("checkbox", { name: "TLS", exact: true }).uncheck();
    await page
      .getByRole("textbox", { name: "Request body", exact: true })
      .fill('{"text":"grpc-ui-result"}');
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await expect(
      page.getByText('"grpc-ui-result"', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "API protocol", exact: true })
      .selectOption("websocket");
    await page
      .getByRole("textbox", { name: "Request URL", exact: true })
      .fill("ws://127.0.0.1:" + ws.address().port);
    await page
      .getByRole("button", { name: "Connect WebSocket", exact: true })
      .click();
    await expect(page.getByText(/open: Connected/)).toBeVisible();
    await page
      .getByRole("textbox", { name: "WebSocket message", exact: true })
      .fill("websocket-ui-result");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.getByText(/message: websocket-ui-result/)).toBeVisible();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  } finally {
    service.dispose();
    for (const client of ws.clients) client.terminate();
    await new Promise((resolve) => ws.close(resolve));
    rpc.forceShutdown();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
