const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { qualityTool } = require("../desktop/advanced-quality.cjs");
test(
  "real .NET tests, coverage, analyzer diagnostics, formatting, history and Roslyn graph",
  { skip: process.env.CAIRN_DOTNET_INTEGRATION !== "1", timeout: 240000 },
  async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cairn-dotnet-integration-"),
    );
    try {
      fs.cpSync(path.join(__dirname, "fixtures", "quality"), root, {
        recursive: true,
      });
      const target = path.join(root, "Tests", "Tests.csproj"),
        source = path.join(root, "Tests", "Tests.cs"),
        before = fs.readFileSync(source, "utf8");
      await promisify(execFile)("dotnet", ["restore", target], {
        env: process.env,
        timeout: 90000,
        maxBuffer: 2 * 1024 * 1024,
      });
      await promisify(execFile)(
        "dotnet",
        [
          "new",
          "sln",
          "--format",
          "slnx",
          "--name",
          "Fixture",
          "--output",
          root,
        ],
        { env: process.env, timeout: 30000 },
      );
      await promisify(execFile)(
        "dotnet",
        ["sln", path.join(root, "Fixture.slnx"), "add", target],
        { env: process.env, timeout: 30000 },
      );
      const semantic =
        await require("../desktop/semantic.cjs").resolveSemanticGraph(
          {
            solution: path.join(root, "Fixture.slnx"),
            projects: [
              { id: "tests", path: target, projectType: "test" },
              {
                id: "library",
                path: path.join(root, "Library", "Library.csproj"),
                projectType: "classlib",
              },
            ],
          },
          {
            root: path.join(root, "semantic-cache"),
            env: process.env,
            confirm: async () => {},
            source: path.join(__dirname, "..", "tools", "semantic"),
          },
        );
      assert.equal(semantic.engine, "Roslyn");
      assert.ok(semantic.nodes.some((node) => node.id === "project:tests"));
      assert.ok(
        semantic.edges.some((edge) => edge.kind === "calls (resolved)"),
      );
      assert.equal(semantic.diagnostics.length, 0);
      const options = { cwd: root, target },
        context = {
          env: process.env,
          root: path.join(root, "reports"),
          confirm: async () => {},
        };
      const coverage = await qualityTool("coverage", options, context);
      assert.equal(coverage.exitCode, 1);
      assert.equal(coverage.testResults.length, 2);
      assert.ok(coverage.testResults.some((test) => test.outcome === "Failed"));
      assert.ok(coverage.coverage.flatMap((report) => report.files).length > 0);
      const analysis = await qualityTool("analyze", options, context);
      assert.equal(analysis.exitCode, 0);
      assert.ok(analysis.diagnostics.some((line) => line.includes("CS0169")));
      const formatting = await qualityTool("format", options, context);
      assert.notEqual(formatting.exitCode, 0);
      assert.equal(fs.readFileSync(source, "utf8"), before);
      assert.deepEqual(
        (await qualityTool("history", {}, context)).map(
          (report) => report.action,
        ),
        ["format", "analyze", "coverage"],
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
