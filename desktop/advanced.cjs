const fs = require("node:fs");
const path = require("node:path");
const { createApiService } = require("./advanced-api.cjs");
const { gitTool } = require("./advanced-git.cjs");
const { qualityTool } = require("./advanced-quality.cjs");
const { systemTool } = require("./advanced-system.cjs");
function registerAdvanced({
  ipcMain,
  app,
  dialog,
  safeStorage,
  getWindow,
  getEnv,
}) {
  const root = app.getPath("userData");
  const api = createApiService({ safeStorage, root, getWindow });
  const watchers = new Map();
  const qualityControllers = new Map();
  const context = () => ({
    root,
    dialog,
    window: getWindow(),
    env: getEnv(),
    confirm: async (message) => {
      const answer = await dialog.showMessageBox(getWindow(), {
        type: "warning",
        message,
        buttons: ["Cancel", "Continue"],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) throw new Error("Cancelled");
    },
  });
  ipcMain.handle("advanced:invoke", async (_, area, action, options = {}) => {
    if (!options || typeof options !== "object")
      throw new Error("Invalid tool input");
    if (area === "api") return api(action, options);
    if (area === "git") return gitTool(action, options, context());
    if (area === "quality") {
      if (action === "cancel") {
        qualityControllers.get(options.id)?.abort();
        return { cancelled: true };
      }
      const controller = new AbortController();
      qualityControllers.set(options.id, controller);
      try {
        return await qualityTool(action, options, {
          ...context(),
          signal: controller.signal,
        });
      } finally {
        qualityControllers.delete(options.id);
      }
    }
    if (area === "system") return systemTool(action, options, context());
    if (area === "dependencies" && action === "semantic")
      return require("./semantic.cjs").resolveSemanticGraph(options, {
        ...context(),
        source: app.isPackaged
          ? path.join(process.resourcesPath, "semantic")
          : path.join(__dirname, "..", "tools", "semantic"),
      });
    if (area === "dependencies" && action === "assets") {
      if (!Array.isArray(options.projects) || options.projects.length > 200)
        throw new Error("Choose a solution with up to 200 projects");
      const nodes = new Map(),
        edges = [];
      const missing = [];
      for (const project of options.projects) {
        const file = path.join(
          path.dirname(project.path),
          "obj",
          "project.assets.json",
        );
        let data;
        try {
          if (fs.statSync(file).size > 20 * 1024 * 1024)
            throw new Error("Assets file exceeds 20 MB");
          data = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
          missing.push(project.path);
          continue;
        }
        for (const [framework, libraries] of Object.entries(
          data.targets || {},
        )) {
          const lookup = new Map(
            Object.keys(libraries).map((key) => [
              key.slice(0, key.lastIndexOf("/")).toLowerCase(),
              key,
            ]),
          );
          for (const [key, library] of Object.entries(libraries)) {
            if (library.type !== "package") continue;
            const id = "package:" + key.toLowerCase();
            nodes.set(id, {
              id,
              label: key.slice(0, key.lastIndexOf("/")),
              kind: "package",
              detail: key.slice(key.lastIndexOf("/") + 1) + " · " + framework,
            });
            for (const dependency of Object.keys(library.dependencies || {})) {
              const match = lookup.get(dependency.toLowerCase());
              if (match)
                edges.push({
                  id:
                    "asset:" +
                    project.id +
                    ":" +
                    framework +
                    ":" +
                    key +
                    ":" +
                    dependency,
                  source: id,
                  target: "package:" + match.toLowerCase(),
                  kind: "transitive package",
                });
            }
          }
          const declared =
            data.project?.frameworks?.[framework]?.dependencies || {};
          for (const dependency of Object.keys(declared)) {
            const key = lookup.get(dependency.toLowerCase());
            if (key)
              edges.push({
                id: "restored:" + project.id + ":" + framework + ":" + key,
                source: "project:" + project.id,
                target: "package:" + key.toLowerCase(),
                kind: "restored direct package",
              });
          }
        }
      }
      return { nodes: [...nodes.values()], edges, missing };
    }
    if (area === "logs") {
      if (action === "stop") {
        watchers.get(options.id)?.close();
        watchers.delete(options.id);
        return { stopped: true };
      }
      if (action === "watch") {
        if (watchers.size >= 12) throw new Error("Close a log stream first");
        const selection = await dialog.showOpenDialog(getWindow(), {
          properties: ["openFile"],
          filters: [{ name: "Logs", extensions: ["log", "jsonl", "txt"] }],
        });
        if (selection.canceled) return { cancelled: true };
        const file = selection.filePaths[0],
          id = String(options.id),
          initial = fs.statSync(file);
        let offset = initial.size,
          inode = initial.ino,
          modified = initial.mtimeMs;
        const read = async () => {
          try {
            const info = await fs.promises.stat(file),
              size = info.size;
            if (
              size < offset ||
              info.ino !== inode ||
              (size === offset && info.mtimeMs !== modified)
            )
              offset = 0;
            inode = info.ino;
            modified = info.mtimeMs;
            if (size === offset) return;
            const start = Math.max(offset, size - 256 * 1024);
            offset = size;
            const handle = await fs.promises.open(file, "r");
            try {
              const buffer = Buffer.alloc(size - start);
              await handle.read(buffer, 0, buffer.length, start);
              getWindow()?.webContents.send("logs:event", {
                id,
                source: path.basename(file),
                text: buffer.toString("utf8"),
                time: new Date().toISOString(),
              });
            } finally {
              await handle.close();
            }
          } catch (error) {
            if (error.code === "ENOENT") return;
            getWindow()?.webContents.send("logs:event", {
              id,
              error: error.message,
            });
          }
        };
        let busy = false,
          pending = false;
        const watcher = fs.watch(path.dirname(file), async (_, changed) => {
          if (changed && changed.toString() !== path.basename(file)) return;
          if (busy) {
            pending = true;
            return;
          }
          busy = true;
          try {
            do {
              pending = false;
              await read();
            } while (pending);
          } finally {
            busy = false;
          }
        });
        watchers.set(id, watcher);
        const handle = await fs.promises.open(file, "r");
        let text;
        try {
          const length = Math.min(initial.size, 256 * 1024),
            buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, initial.size - length);
          text = buffer.toString("utf8");
        } finally {
          await handle.close();
        }
        return { id, source: path.basename(file), text };
      }
    }
    throw new Error("Unsupported advanced tool");
  });
  app.on("before-quit", () => {
    api.dispose();
    for (const controller of qualityControllers.values()) controller.abort();
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  });
}
module.exports = { registerAdvanced };
