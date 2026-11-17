const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
async function resolveSemanticGraph(options, { root, env, confirm, source }) {
  const input = fs.realpathSync(options.solution);
  if (![".csproj", ".sln", ".slnx"].includes(path.extname(input).toLowerCase()))
    throw new Error("Choose a .NET solution/project");
  await confirm(
    "Resolve source dependencies using Roslyn/MSBuild? Project evaluation can execute project tooling. Restore the target solution first for complete references.",
  );
  const cache = path.join(root, "semantic-tool");
  fs.mkdirSync(cache, { recursive: true });
  for (const name of ["Cairn.Semantic.csproj", "Program.cs"]) {
    const content = fs.readFileSync(path.join(source, name), "utf8"),
      destination = path.join(cache, name);
    if (
      !fs.existsSync(destination) ||
      fs.readFileSync(destination, "utf8") !== content
    )
      fs.writeFileSync(destination, content);
  }
  const output = path.join(cache, "graph-" + randomUUID() + ".json");
  try {
    try {
      await run(
        "dotnet",
        [
          "run",
          "--project",
          path.join(cache, "Cairn.Semantic.csproj"),
          "--configuration",
          "Release",
          "--verbosity",
          "quiet",
          "--",
          input,
          output,
        ],
        {
          env,
          cwd: path.dirname(input),
          timeout: 180000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    } catch (error) {
      throw new Error(
        "Roslyn resolution failed. Ensure .NET SDK 8+ is installed and package restore is available.\n" +
          (error.stderr || error.stdout || error.message),
      );
    }
    if (fs.statSync(output).size > 30 * 1024 * 1024)
      throw new Error(
        "Semantic graph exceeds 30 MB; resolve a smaller project",
      );
    const graph = JSON.parse(fs.readFileSync(output, "utf8"));
    const projects = new Map(
      (options.projects || []).map((project) => [
        path.resolve(project.path),
        project,
      ]),
    );
    const ids = new Map();
    for (const node of graph.nodes) {
      if (node.kind === "project" && node.file) {
        const project = projects.get(path.resolve(node.file));
        if (project) {
          ids.set(node.id, "project:" + project.id);
          node.id = "project:" + project.id;
          node.kind = project.projectType;
        }
      }
    }
    for (const edge of graph.edges) {
      edge.source = ids.get(edge.source) || edge.source;
      edge.target = ids.get(edge.target) || edge.target;
    }
    return graph;
  } finally {
    if (fs.existsSync(output)) fs.unlinkSync(output);
  }
}
module.exports = { resolveSemanticGraph };
