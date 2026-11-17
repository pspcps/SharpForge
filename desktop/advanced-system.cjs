const fs = require("node:fs");
const path = require("node:path");
const { X509Certificate } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
async function systemTool(action, options, { dialog, window, env }) {
  if (action === "certificate") {
    const cert = new X509Certificate(String(options.pem || ""));
    return {
      subject: cert.subject,
      issuer: cert.issuer,
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      serialNumber: cert.serialNumber,
      fingerprint256: cert.fingerprint256,
      subjectAltName: cert.subjectAltName,
      ca: cert.ca,
      warning:
        "Inspection only. This does not verify trust, hostname or revocation.",
    };
  }
  if (action === "processes") {
    const { stdout } = await run(
      "ps",
      ["-axo", "pid=,ppid=,%cpu=,%mem=,comm="],
      { env, timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout
      .trim()
      .split("\n")
      .map((line) => {
        const match = line
          .trim()
          .match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
        return match
          ? {
              pid: Number(match[1]),
              parent: Number(match[2]),
              cpu: match[3],
              memory: match[4],
              command: match[5],
            }
          : null;
      })
      .filter(Boolean);
  }
  if (action === "sizes") {
    const selection = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
    });
    if (selection.canceled) return { cancelled: true };
    const root = selection.filePaths[0],
      stack = [root],
      rows = [];
    let total = 0,
      scanned = 0;
    while (stack.length && scanned < 50000) {
      const directory = stack.pop();
      let entries;
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (++scanned > 50000) break;
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          stack.push(file);
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          const info = await fs.promises.stat(file);
          total += info.size;
          rows.push({ path: path.relative(root, file), bytes: info.size });
        } catch {}
      }
    }
    return {
      root,
      totalBytes: total,
      scanned,
      truncated: scanned >= 50000,
      largest: rows.sort((a, b) => b.bytes - a.bytes).slice(0, 100),
    };
  }
  throw new Error("Unsupported system operation");
}
module.exports = { systemTool };
