const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const runFile = promisify(execFile);

function registerTerminals({ ipcMain, app, getWindow, getEnv, ptyFactory }) {
  const sessions = new Map();
  const safeDirectory = (cwd) => fs.realpathSync(cwd || os.homedir());
  const serialize = (session) => ({
    id: session.id,
    cwd: session.cwd,
    kind: session.kind,
    title: session.title,
    exited: session.exited,
    output: session.output,
    sequence: session.sequence,
    outputLength: session.outputLength,
  });
  const send = (data) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("terminal:event", data);
  };
  async function claudePath() {
    const env = getEnv();
    // Common native installs plus PATH; never execute arbitrary shell startup files to detect a command.
    const roots = [
      path.join(os.homedir(), ".local", "bin"),
      path.join(os.homedir(), ".claude", "local"),
      ...(env.PATH || "").split(path.delimiter),
    ];
    for (const root of roots) {
      const candidate = path.resolve(
        root,
        process.platform === "win32" ? "claude.exe" : "claude",
      );
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        await runFile(candidate, ["--version"], {
          env,
          timeout: 4000,
          maxBuffer: 65536,
        });
        return candidate;
      } catch {
        /* unavailable or broken installation */
      }
    }
    return null;
  }
  ipcMain.handle("terminal:list", async (_, cwd) => {
    const root = safeDirectory(cwd);
    return {
      claudeAvailable: Boolean(await claudePath()),
      sessions: [...sessions.values()]
        .filter((s) => s.cwd === root)
        .map(serialize),
    };
  });
  ipcMain.handle("terminal:create", async (_, options = {}) => {
    if (sessions.size >= 12)
      throw new Error("Close a terminal before opening another (limit: 12).");
    const cwd = safeDirectory(options.cwd);
    if (!fs.statSync(cwd).isDirectory())
      throw new Error("Terminal working directory must be a folder");
    const kind = options.kind === "claude" ? "claude" : "shell";
    const binary =
      kind === "claude" ? await claudePath() : process.env.SHELL || "/bin/zsh";
    if (!binary)
      throw new Error("Claude CLI is not installed or is not runnable");
    const pty = ptyFactory || require("node-pty");
    const proc = pty.spawn(binary, kind === "shell" ? ["-l"] : [], {
      name: "xterm-256color",
      cols: 100,
      rows: 24,
      cwd,
      env: { ...getEnv(), TERM: "xterm-256color" },
    });
    const session = {
      id: randomUUID(),
      cwd,
      kind,
      title: kind === "claude" ? "Claude" : "Terminal",
      output: "",
      sequence: 0,
      outputLength: 0,
      exited: false,
      proc,
    };
    sessions.set(session.id, session);
    proc.onData((data) => {
      session.output = (session.output + data).slice(-200000);
      session.outputLength += data.length;
      session.sequence++;
      send({
        id: session.id,
        data,
        sequence: session.sequence,
        outputLength: session.outputLength,
      });
    });
    proc.onExit(({ exitCode }) => {
      session.exited = true;
      const data = `\r\n[Session exited: ${exitCode}]\r\n`;
      session.output = (session.output + data).slice(-200000);
      session.outputLength += data.length;
      session.sequence++;
      send({
        id: session.id,
        data,
        exited: true,
        sequence: session.sequence,
        outputLength: session.outputLength,
      });
    });
    return serialize(session);
  });
  ipcMain.handle("terminal:write", (_, id, data) => {
    const session = sessions.get(id);
    if (
      !session ||
      session.exited ||
      typeof data !== "string" ||
      data.length > 65536
    )
      return false;
    session.proc.write(data);
    return true;
  });
  ipcMain.handle("terminal:resize", (_, id, cols, rows) => {
    const session = sessions.get(id);
    if (
      !session ||
      session.exited ||
      !Number.isInteger(cols) ||
      !Number.isInteger(rows)
    )
      return;
    session.proc.resize(
      Math.max(2, Math.min(cols, 500)),
      Math.max(1, Math.min(rows, 200)),
    );
  });
  ipcMain.handle("terminal:close", (_, id) => {
    const session = sessions.get(id);
    if (session) {
      session.proc.kill();
      sessions.delete(id);
    }
  });
  app.on("before-quit", () => {
    for (const session of sessions.values()) session.proc.kill();
    sessions.clear();
  });
}
module.exports = { registerTerminals };
