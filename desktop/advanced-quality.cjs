const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const { XMLParser } = require("fast-xml-parser");
function coverageReport(xml) {
  if (xml.length > 10 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Use a Cobertura report under 10 MB without DTD/entities");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: (name) => ["package", "class", "line"].includes(name),
  }).parse(xml);
  const coverage = parsed.coverage;
  if (!coverage) throw new Error("Expected Cobertura XML");
  const classes = (coverage.packages?.package || []).flatMap(
    (p) => p.classes?.class || [],
  );
  return {
    lineRate: Number(coverage["line-rate"]),
    branchRate: Number(coverage["branch-rate"]),
    files: classes.map((c) => ({
      file: (() => {
        if (path.isAbsolute(c.filename)) return c.filename;
        const sources = [coverage.sources?.source]
          .flat()
          .filter((source) => typeof source === "string");
        return (
          sources
            .map((source) => path.join(source, c.filename))
            .find((file) => fs.existsSync(file)) || c.filename
        );
      })(),
      lineRate: Number(c["line-rate"]),
      lines: (c.lines?.line || []).map((l) => ({
        number: Number(l.number),
        hits: Number(l.hits),
      })),
    })),
  };
}
async function qualityTool(
  action,
  options,
  { env, confirm, root, dialog, window, signal },
) {
  const historyFile = path.join(root, "quality-history.json");
  const history = () => {
    try {
      return JSON.parse(fs.readFileSync(historyFile, "utf8"));
    } catch {
      return [];
    }
  };
  if (action === "history") return history();
  if (action === "coverage-import") {
    const selection = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [{ name: "Cobertura report", extensions: ["xml"] }],
    });
    if (selection.canceled) return { cancelled: true };
    return coverageReport(
      await fs.promises.readFile(selection.filePaths[0], "utf8"),
    );
  }
  const cwd = fs.realpathSync(options.cwd),
    target = fs.realpathSync(options.target);
  if (![".sln", ".slnx", ".csproj"].includes(path.extname(target)))
    throw new Error("Choose a .NET solution or project");
  await confirm(
    "Run " +
      action +
      " for " +
      target +
      "? .NET project tooling can execute project code.",
  );
  const args =
    action === "analyze"
      ? [
          "build",
          target,
          "--no-restore",
          "--no-incremental",
          "--nologo",
          "-v:minimal",
          "-p:RunAnalyzers=true",
          "-p:AnalysisLevel=latest",
          "-p:EnforceCodeStyleInBuild=true",
        ]
      : action === "format"
        ? ["format", target, "--verify-no-changes", "--no-restore"]
        : action === "coverage"
          ? ["test", target, "--collect:XPlat Code Coverage"]
          : action === "test"
            ? ["test", target]
            : null;
  if (!args) throw new Error("Unsupported quality operation");
  const results = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-test-results-"));
  if (action === "coverage" || action === "test")
    args.push("--logger", "trx", "--results-directory", results);
  const started = new Date().toISOString(),
    before = Date.now();
  let stdout = "",
    stderr = "",
    exitCode = 0;
  try {
    try {
      const result = await run("dotnet", args, {
        cwd,
        env,
        timeout: 180000,
        signal,
        maxBuffer: 8 * 1024 * 1024,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      stdout = error.stdout || "";
      stderr = error.stderr || error.message;
      exitCode = Number(error.code) || 1;
    }
    const reports = [];
    const stack = [results];
    while (stack.length) {
      for (const entry of fs.readdirSync(stack.pop(), {
        withFileTypes: true,
      })) {
        const parent = entry.parentPath || entry.path;
        const file = path.join(parent, entry.name);
        if (entry.isDirectory()) stack.push(file);
        else if (
          entry.name.endsWith(".trx") ||
          entry.name === "coverage.cobertura.xml"
        ) {
          if (fs.statSync(file).size <= 10 * 1024 * 1024)
            reports.push({
              name: entry.name,
              text: fs.readFileSync(file, "utf8"),
            });
        }
      }
    }
    const testResults = [];
    for (const report of reports.filter((r) => r.name.endsWith(".trx"))) {
      const trx = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        removeNSPrefix: true,
        isArray: (name) => name === "UnitTestResult",
      }).parse(report.text);
      for (const result of trx.TestRun?.Results?.UnitTestResult || [])
        testResults.push({
          name: result.testName,
          outcome: result.outcome,
          duration: result.duration,
          started: result.startTime,
          ended: result.endTime,
          error: result.Output?.ErrorInfo?.Message || "",
        });
    }
    const diagnostics = stdout
      .split("\n")
      .filter((line) => /\b(?:warning|error)\s+[A-Z]+\d+:/i.test(line));
    const report = {
      id: Date.now().toString(),
      action,
      target,
      started,
      durationMs: Date.now() - before,
      exitCode,
      stdout: stdout.slice(-1024 * 1024),
      stderr: stderr.slice(-1024 * 1024),
      testResults,
      diagnostics,
      coverage: reports
        .filter((r) => r.name === "coverage.cobertura.xml")
        .map((r) => coverageReport(r.text)),
    };
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      historyFile + ".tmp",
      JSON.stringify([report, ...history()].slice(0, 20)),
      { mode: 0o600 },
    );
    fs.renameSync(historyFile + ".tmp", historyFile);
    return report;
  } finally {
    fs.rmSync(results, { recursive: true, force: true });
  }
}
module.exports = { qualityTool, coverageReport };
