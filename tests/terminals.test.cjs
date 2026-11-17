const { test } = require("node:test");
const assert = require("node:assert/strict");
const { registerTerminals } = require("../desktop/terminals.cjs");
test("terminal sessions isolate input, resize, output and cleanup", async () => {
  const handlers = new Map();
  const events = [];
  const processes = [];
  let quit;
  registerTerminals({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    app: {
      on: (_, fn) => {
        quit = fn;
      },
    },
    getWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: (_, data) => events.push(data) },
    }),
    getEnv: () => ({ PATH: "" }),
    ptyFactory: {
      spawn: () => {
        const p = {
          onData: (fn) => {
            p.data = fn;
          },
          onExit: (fn) => {
            p.exit = fn;
          },
          write: (data) => {
            p.input = data;
          },
          resize: (cols, rows) => {
            p.size = [cols, rows];
          },
          kill: () => {
            p.killed = true;
          },
        };
        processes.push(p);
        return p;
      },
    },
  });
  const call = (name, ...args) => handlers.get(name)(null, ...args);
  const one = await call("terminal:create", {
    cwd: process.cwd(),
    kind: "shell",
  });
  const two = await call("terminal:create", {
    cwd: process.cwd(),
    kind: "shell",
  });
  assert.notEqual(one.id, two.id);
  call("terminal:write", one.id, "hello");
  assert.equal(processes[0].input, "hello");
  assert.equal(processes[1].input, undefined);
  call("terminal:resize", one.id, 10000, -1);
  assert.deepEqual(processes[0].size, [500, 1]);
  processes[0].data("first output");
  assert.equal(events[0].id, one.id);
  assert.equal(events[0].sequence, 1);
  processes[0].exit({ exitCode: 1 });
  assert.equal(call("terminal:write", one.id, "ignored"), false);
  call("terminal:close", one.id);
  assert.equal(processes[0].killed, true);
  quit();
  assert.equal(processes[1].killed, true);
});
