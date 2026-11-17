const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const EXTENSIONS = new Set([
  ".cs",
  ".csproj",
  ".sln",
  ".slnx",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".md",
  ".css",
  ".html",
]);
function createFileHistory(root) {
  const recordPath = (file) =>
    path.join(
      root,
      createHash("sha256").update(path.resolve(file)).digest("hex") + ".json",
    );
  function list(file) {
    if (typeof file !== "string" || !path.isAbsolute(file)) return [];
    try {
      const record = JSON.parse(fs.readFileSync(recordPath(file), "utf8"));
      return record.path === path.resolve(file) &&
        Array.isArray(record.versions)
        ? record.versions
        : [];
    } catch {
      return [];
    }
  }
  function capture(file) {
    if (
      typeof file !== "string" ||
      !path.isAbsolute(file) ||
      !EXTENSIONS.has(path.extname(file).toLowerCase())
    )
      return;
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.size > 256 * 1024) return;
    const content = fs.readFileSync(file, "utf8");
    const versions = list(file);
    if (versions[0]?.content === content) return;
    versions.unshift({ timestamp: new Date().toISOString(), content });
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const target = recordPath(file),
      temporary = target + ".tmp";
    fs.writeFileSync(
      temporary,
      JSON.stringify({
        path: path.resolve(file),
        versions: versions.slice(0, 20),
      }),
      { mode: 0o600 },
    );
    fs.renameSync(temporary, target);
    const records = fs
      .readdirSync(root)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const file = path.join(root, name);
        return { file, ...fs.statSync(file) };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    let retained = 0;
    for (const [index, record] of records.entries()) {
      retained += record.size;
      if (index >= 100 || retained > 50 * 1024 * 1024)
        fs.unlinkSync(record.file);
    }
  }
  return { list, capture };
}
module.exports = { createFileHistory };
