const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { registerAdvanced } = require("../desktop/advanced.cjs");
const { systemTool } = require("../desktop/advanced-system.cjs");
test("native log streams follow appends/rotation and package graph reads restored dependencies", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-native-"));
  const handlers = new Map(),
    events = [];
  let cleanup;
  const log = path.join(root, "service.log");
  fs.writeFileSync(log, "start\n");
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, event) => events.push({ channel, ...event }),
    },
  };
  registerAdvanced({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    app: {
      getPath: () => root,
      on: (_, callback) => {
        cleanup = callback;
      },
    },
    dialog: {
      showOpenDialog: async () => ({ filePaths: [log], canceled: false }),
    },
    safeStorage: { isEncryptionAvailable: () => false },
    getWindow: () => window,
    getEnv: () => process.env,
  });
  const invoke = (area, action, options) =>
    handlers.get("advanced:invoke")(null, area, action, options);
  try {
    const first = await invoke("logs", "watch", { id: "service" });
    assert.equal(first.text, "start\n");
    fs.appendFileSync(log, "next\n");
    await waitFor(() => events.some((event) => event.text?.includes("next")));
    fs.writeFileSync(log, "new\n");
    await waitFor(() => events.some((event) => event.text === "new\n"));
    fs.renameSync(log,log+".old");fs.writeFileSync(log,"rotated\n");await waitFor(()=>events.some(event=>event.text==="rotated\n"));
    await invoke("logs", "stop", { id: "service" });
    const project = path.join(root, "App.csproj");
    fs.writeFileSync(project, "<Project/>");
    fs.mkdirSync(path.join(root, "obj"));
    fs.writeFileSync(
      path.join(root, "obj", "project.assets.json"),
      JSON.stringify({
        targets: {
          "net10.0": {
            "A/1.0": { type: "package", dependencies: { B: "2.0" } },
            "B/2.0": { type: "package" },
          },
        },
        project: {
          frameworks: {
            "net10.0": { dependencies: { A: { target: "Package" } } },
          },
        },
      }),
    );
    const graph = await invoke("dependencies", "assets", {
      projects: [{ id: "app", path: project }],
    });
    assert.equal(graph.nodes.length, 2);
    assert.ok(
      graph.edges.some(
        (edge) =>
          edge.source === "package:a/1.0" && edge.target === "package:b/2.0",
      ),
    );
    assert.ok(graph.edges.some((edge) => edge.source === "project:app"));
  } finally {
    cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("certificate, process and folder-size inspectors use real local data without following symlinks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-system-"));
  try {
    const key = path.join(root, "key.pem"),
      cert = path.join(root, "certificate.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        "/CN=localhost",
        "-days",
        "1",
        "-keyout",
        key,
        "-out",
        cert,
      ],
      { stdio: "ignore" },
    );
    const context = {
      env: process.env,
      dialog: {
        showOpenDialog: async () => ({ filePaths: [root], canceled: false }),
      },
    };
    assert.match(
      (
        await systemTool(
          "certificate",
          { pem: fs.readFileSync(cert, "utf8") },
          context,
        )
      ).subject,
      /localhost/,
    );
    assert.ok(
      (await systemTool("processes", {}, context)).some(
        (process) => process.pid === global.process.pid,
      ),
    );
    fs.symlinkSync(root, path.join(root, "recursive-link"));
    const sizes = await systemTool("sizes", {}, context);
    assert.ok(sizes.totalBytes > 0);
    assert.equal(
      sizes.largest.some((file) => file.path.includes("recursive-link")),
      false,
    );
  } finally {
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
