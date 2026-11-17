const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { gitTool } = require("../desktop/advanced-git.cjs");
test("Git graph, staging, comparisons, timeline, snapshots and branch cleanup use real repository", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-git-"));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
  const call = (action, options = {}) =>
    gitTool(
      action,
      { cwd: root, file: "file.txt", ...options },
      { env, confirm: async () => {} },
    );
  try {
    git("init", "-b", "main");
    fs.writeFileSync(path.join(root, "file.txt"), "one\n");
    git("add", ".");
    git("commit", "-m", "first");
    git("branch", "feature");
    fs.writeFileSync(path.join(root, "file.txt"), "two\n");
    assert.match((await call("overview")).graph, /first/);
    assert.match((await call("diff")).text, /two/);
    await call("stage");
    assert.match(git("diff", "--cached"), /two/);
    await call("unstage");
    assert.equal(git("diff", "--cached"), "");
    const patch = (await call("diff")).text;
    await call("stage-patch", { patch });
    git("commit", "-m", "second");
    assert.match((await call("timeline")).text, /second/);
    assert.match(
      (await call("compare", { from: "HEAD~1", to: "HEAD" })).patch,
      /two/,
    );
    assert.match((await call("impact", { commit: "HEAD" })).text, /second/);
    await assert.rejects(call("stage", { file: "../outside" }));
    await call("delete-branch", { branch: "feature" });
    fs.writeFileSync(path.join(root, "file.txt"), "snapshot\n");
    await call("snapshot");
    assert.equal(fs.readFileSync(path.join(root, "file.txt"), "utf8"), "two\n");
    await call("restore-snapshot", { ref: "stash@{0}" });
    assert.equal(
      fs.readFileSync(path.join(root, "file.txt"), "utf8"),
      "snapshot\n",
    );
    assert.deepEqual((await call("conflicts")).files, []);
    git("add", ".");
    git("commit", "-m", "third");
    const plan = await call("rebase-preview", { base: "HEAD~2" });
    await call("rebase", {
      base: "HEAD~2",
      todo: plan.commits.map((commit, index) => ({
        commit,
        action: index === 0 ? "pick" : "fixup",
      })),
    });
    assert.equal(Number(git("rev-list", "--count", "HEAD").trim()), 2);
    git("branch", "conflict");
    fs.writeFileSync(path.join(root, "file.txt"), "main edit\n");
    git("add", ".");
    git("commit", "-m", "main edit");
    git("switch", "conflict");
    fs.writeFileSync(path.join(root, "file.txt"), "other edit\n");
    git("add", ".");
    git("commit", "-m", "other edit");
    git("switch", "main");
    try {
      git("merge", "conflict");
    } catch {}
    assert.deepEqual((await call("conflicts")).files, ["file.txt"]);
    const conflict = await call("conflict-file");
    assert.match(conflict.ours, /main edit/);
    assert.match(conflict.theirs, /other edit/);
    await call("resolve", { text: "resolved\n" });
    assert.deepEqual((await call("conflicts")).files, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
