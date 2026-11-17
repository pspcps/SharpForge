const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createFileHistory } = require("../desktop/file-history.cjs");
test("file history deduplicates, caps versions, excludes configuration and ignores symlinks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sharpforge-history-"));
  try {
    const history = createFileHistory(path.join(root, "history"));
    const file = path.join(root, "Program.cs");
    fs.writeFileSync(file, "original");
    history.capture(file);
    history.capture(file);
    assert.equal(history.list(file).length, 1);
    for (let i = 0; i < 25; i++) {
      fs.writeFileSync(file, "version " + i);
      history.capture(file);
    }
    assert.equal(history.list(file).length, 20);
    assert.equal(history.list(file)[0].content, "version 24");
    const config = path.join(root, "appsettings.json");
    fs.writeFileSync(config, '{"password":"secret"}');
    history.capture(config);
    assert.deepEqual(history.list(config), []);
    const link = path.join(root, "Link.cs");
    fs.symlinkSync(file, link);
    history.capture(link);
    assert.deepEqual(history.list(link), []);
    assert.deepEqual(history.list("relative.cs"), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
