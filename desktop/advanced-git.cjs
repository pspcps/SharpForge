const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const { inside } = require("./security.cjs");
function safeRef(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("-") ||
    /[\x00-\x20]/.test(value)
  )
    throw new Error("Invalid Git reference");
  return value;
}
async function gitTool(action, options, { env, confirm }) {
  let cwd = fs.realpathSync(options.cwd);
  if (!fs.statSync(cwd).isDirectory())
    throw new Error("Choose a repository directory");
  const git = async (args, extra = {}) => {
    try {
      return await run("git", ["--literal-pathspecs", ...args], {
        cwd,
        env,
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
        ...extra,
      });
    } catch (error) {
      throw new Error(error.stderr || error.message);
    }
  };
  const root = (await git(["rev-parse", "--show-toplevel"])).stdout.trim();
  cwd = root;
  const file = () => {
    const value = String(options.file || "");
    if (
      !value ||
      path.isAbsolute(value) ||
      !inside(root, path.resolve(root, value))
    )
      throw new Error("Choose a relative file inside this repository");
    return value;
  };
  if (action === "changed-files") {
    const [tracked, untracked] = await Promise.all([
      git(["diff", "--name-only", "-z", "HEAD", "--"]),
      git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    return {
      files: [
        ...new Set(
          (tracked.stdout + untracked.stdout).split("\0").filter(Boolean),
        ),
      ].map((file) => path.join(root, file)),
    };
  }
  if (action === "overview") {
    const [graph, status, branches, health, snapshots] = await Promise.all([
      git(["log", "--all", "--graph", "--decorate", "--oneline", "-80"]),
      git(["status", "--porcelain=v1"]),
      git(["branch", "--format=%(refname:short)"]),
      git(["fsck", "--connectivity-only"]),
      git(["stash", "list"]),
    ]);
    return {
      graph: graph.stdout,
      status: status.stdout,
      branches: branches.stdout.trim().split("\n").filter(Boolean),
      health: health.stdout || "Connectivity check passed",
      snapshots: snapshots.stdout,
    };
  }
  if (action === "diff")
    return {
      text: (
        await git([
          "diff",
          ...(options.staged ? ["--cached"] : []),
          "--",
          file(),
        ])
      ).stdout,
    };
  if (action === "compare")
    return {
      text: (
        await git([
          "diff",
          "--stat",
          safeRef(options.from),
          safeRef(options.to),
          "--",
        ])
      ).stdout,
      patch: (
        await git(["diff", safeRef(options.from), safeRef(options.to), "--"])
      ).stdout,
    };
  if (action === "timeline")
    return {
      text: (
        await git([
          "log",
          "--follow",
          "-40",
          "--format=%h %ad %an %s",
          "--date=iso",
          "--",
          file(),
        ])
      ).stdout,
    };
  if (action === "impact") {
    const commit = safeRef(options.commit);
    return {
      text: (await git(["show", "--format=fuller", "--stat", commit, "--"]))
        .stdout,
      patch: (await git(["show", "--format=", "--find-renames", commit, "--"]))
        .stdout,
    };
  }
  if (action === "conflicts")
    return {
      files: (
        await git(["diff", "--name-only", "--diff-filter=U", "-z"])
      ).stdout
        .split("\0")
        .filter(Boolean),
    };
  if (action === "conflict-file") {
    const name = file();
    const stages = {};
    for (const [stage, label] of [
      [1, "base"],
      [2, "ours"],
      [3, "theirs"],
    ]) {
      try {
        stages[label] = (await git(["show", `:${stage}:${name}`])).stdout;
      } catch {
        stages[label] = "";
      }
    }
    return {
      ...stages,
      working: fs.readFileSync(path.resolve(root, name), "utf8"),
    };
  }
  if (action === "stage" || action === "unstage") {
    await git(
      action === "stage"
        ? ["add", "--", file()]
        : ["restore", "--staged", "--", file()],
    );
    return { ok: true };
  }
  if (action === "stage-patch") {
    const patch = String(options.patch || "");
    if (patch.length > 1024 * 1024 || !patch.startsWith("diff --git "))
      throw new Error("Supply a Git unified diff smaller than 1 MB");
    // --cached modifies the index only; git apply rejects traversal and unsafe paths by default.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-patch-"));
    try {
      const target = path.join(dir, "index.patch");
      fs.writeFileSync(target, patch);
      await git(["apply", "--cached", "--check", target]);
      await git(["apply", "--cached", target]);
      return { ok: true };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  if (action === "resolve") {
    const name = file(),
      target = path.resolve(root, name);
    if (
      !inside(fs.realpathSync(root), fs.realpathSync(path.dirname(target))) ||
      fs.lstatSync(target).isSymbolicLink()
    )
      throw new Error("Symlink paths cannot be resolved here");
    if (String(options.text).length > 2 * 1024 * 1024)
      throw new Error("Resolution limit is 2 MB");
    await confirm(`Write and stage resolved file: ${name}?`);
    fs.writeFileSync(target, String(options.text));
    await git(["add", "--", name]);
    return { ok: true };
  }
  if (action === "snapshot") {
    await confirm(
      "Save tracked and untracked changes in a Git stash and clear them from the working tree?",
    );
    return {
      text: (
        await git([
          "stash",
          "push",
          "--include-untracked",
          "-m",
          "Cairn workspace snapshot " + new Date().toISOString(),
        ])
      ).stdout,
    };
  }
  if (action === "restore-snapshot") {
    const ref = safeRef(options.ref);
    if (!/^stash@\{\d+\}$/.test(ref))
      throw new Error("Choose a stash reference");
    await confirm(
      `Apply ${ref} to the working tree? The snapshot will be retained.`,
    );
    return { text: (await git(["stash", "apply", ref])).stdout };
  }
  if (action === "cleanup-preview")
    return { text: (await git(["branch", "--merged", "HEAD"])).stdout };
  if (action === "delete-branch") {
    const branch = safeRef(options.branch);
    await confirm(`Delete merged local branch ${branch}?`);
    return { text: (await git(["branch", "-d", "--", branch])).stdout };
  }
  if (action === "rebase-preview") {
    const base = safeRef(options.base);
    const log = (await git(["rev-list", "--reverse", `${base}..HEAD`])).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    if (log.length > 30) throw new Error("Limit the rebase to 30 commits");
    return {
      commits: log,
      subjects: (await git(["log", "--reverse", "--oneline", `${base}..HEAD`]))
        .stdout,
    };
  }
  if (action === "rebase") {
    const base = safeRef(options.base);
    if ((await git(["status", "--porcelain"])).stdout.trim())
      throw new Error("Commit or snapshot working changes before rebasing");
    const commits = (
      await git(["rev-list", "--reverse", `${base}..HEAD`])
    ).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    const todo = options.todo;
    if (
      !Array.isArray(todo) ||
      todo.length !== commits.length ||
      todo.length > 30 ||
      new Set(todo.map((x) => x.commit)).size !== commits.length ||
      todo.some(
        (x) =>
          !commits.includes(x.commit) ||
          !["pick", "drop", "squash", "fixup"].includes(x.action),
      )
    )
      throw new Error(
        "Todo must contain each previewed commit exactly once with a supported action",
      );
    if (todo[0] && ["squash", "fixup"].includes(todo[0].action))
      throw new Error("The first commit cannot squash/fixup");
    await confirm(
      "Rewrite local commit history using this rebase plan?\n" +
        todo.map((x) => `${x.action} ${x.commit}`).join("\n"),
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-rebase-"));
    try {
      const script = path.join(dir, "sequence.cjs");
      fs.writeFileSync(
        script,
        `require('node:fs').writeFileSync(process.argv[2],${JSON.stringify(todo.map((x) => x.action + " " + x.commit).join("\n") + "\n")});`,
      );
      const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
      return {
        text: (
          await git(["rebase", "-i", base], {
            env: {
              ...env,
              GIT_SEQUENCE_EDITOR:
                quote(process.execPath) + " " + quote(script),
              GIT_EDITOR: "true",
              ELECTRON_RUN_AS_NODE: "1",
            },
          })
        ).stdout,
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  if (action === "rebase-abort" || action === "rebase-continue") {
    await confirm(`Run ${action}?`);
    return {
      text: (
        await git([
          "-c",
          "core.editor=true",
          "rebase",
          action === "rebase-abort" ? "--abort" : "--continue",
        ])
      ).stdout,
    };
  }
  throw new Error("Unsupported Git operation");
}
module.exports = { gitTool, safeRef };
