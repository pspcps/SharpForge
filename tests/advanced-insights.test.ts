import { test } from "node:test";
import assert from "node:assert/strict";
import { dependencyGraph, impactedNodes } from "../src/utils/dependencyGraph";
import {
  frameworkCompatibility,
  solutionHealth,
  qualityMetrics,
} from "../src/utils/solutionHealth";
import { runUtility } from "../src/utils/developerUtilities";
import type { SolutionFile, ProjectItem } from "../src/types/minirider";
const project = (
  name: string,
  refs: string[],
  type: "classlib" | "test" = "classlib",
): ProjectItem => ({
  id: name,
  name,
  path: `/repo/${name}/${name}.csproj`,
  targetFramework: "net8.0",
  projectType: type,
  dependencies: {
    frameworks: [],
    projectReferences: refs,
    packages: [{ id: "Example", version: "1.0", isDirect: true }],
  },
  files: [
    {
      id: name,
      name: name + ".cs",
      path: `/repo/${name}/${name}.cs`,
      relativePath: name + ".cs",
      extension: ".cs",
      isDirectory: false,
      content:
        name === "Core"
          ? "namespace Demo; public interface IFoo {} public class Foo : IFoo { public int Count(int a) { if(a>0) return a; return 0; } }"
          : "namespace Demo; public class FooTests {}",
    },
  ],
});
const solution: SolutionFile = {
  name: "Demo",
  path: "/repo/Demo.sln",
  format: "sln",
  projects: [project("Core", []), project("Tests", ["Core"], "test")],
};
test("dependency graph links projects, package declarations and inherited types with bidirectional impact", () => {
  const graph = dependencyGraph(solution, "projects");
  assert.equal(graph.edges[0].source, "project:Tests");
  assert.equal(impactedNodes(graph, "project:Core", "dependents").size, 2);
  assert.equal(
    dependencyGraph(solution, "packages").nodes.filter(
      (n) => n.kind === "package",
    ).length,
    1,
  );
  const types = dependencyGraph(solution, "types");
  assert.ok(types.edges.some((e) => e.kind === "inherits / implements"));
});
test("solution intelligence reports interface evidence and framework compatibility without claiming unknown combinations", () => {
  assert.equal(frameworkCompatibility("net8.0", "net9.0"), "incompatible");
  assert.equal(
    frameworkCompatibility("net10.0", "netstandard2.0"),
    "compatible",
  );
  assert.equal(
    frameworkCompatibility("net8.0", "net8.0-windows"),
    "incompatible",
  );
  assert.equal(frameworkCompatibility("custom", "net8.0"), "unknown");
  const health = solutionHealth(solution);
  assert.equal(health.interfaces[0].implementations[0].name, "Demo.Foo");
  assert.equal(
    health.projects.find((p) => p.name === "Core")?.unusedCandidate,
    false,
  );
  assert.ok(qualityMetrics(solution).methods.some((m) => m.decisions >= 2));
});
test("XML/YAML/cron tools validate real input and reject malformed or unsafe structures", async () => {
  assert.match(
    await runUtility("xml", "<root><value>1</value></root>"),
    /<value>1<\/value>/,
  );
  await assert.rejects(
    runUtility("xml", '<!DOCTYPE root [<!ENTITY x "value">]><root>&x;</root>'),
  );
  await assert.rejects(runUtility("yaml", "key: 1\nkey: 2"));
  assert.match(await runUtility("yaml", "key: [1, 2]"), /key/);
  const result = JSON.parse(await runUtility("cron", "*/5 * * * *"));
  assert.equal(result.next.length, 5);
  assert.equal(result.timezone, "UTC");
});
import { apiAssertions } from "../src/utils/apiAssertions";
test("API test runner evaluates status, timing and typed JSON-pointer assertions", () => {
  assert.equal(
    apiAssertions(
      {
        mode: "rest",
        expected: 200,
        maxMs: 100,
        assertionPath: "/data/id",
        assertionValue: "2",
      },
      { status: 200, durationMs: 20, json: { data: { id: 2 } } },
    ).passed,
    true,
  );
  assert.equal(
    apiAssertions(
      {
        mode: "rest",
        expected: 200,
        maxMs: 100,
        assertionPath: "/data/id",
        assertionValue: '"2"',
      },
      { status: 200, durationMs: 20, json: { data: { id: 2 } } },
    ).passed,
    false,
  );
});
import { architectureViolations } from "../src/utils/solutionHealth";
import { patchHunks } from "../src/utils/gitPatches";
import { redactLogText } from "../src/utils/logRedaction";
test("architecture rules identify dependency paths and patch selection isolates hunks", () => {
  assert.equal(
    architectureViolations(solution, [
      { from: "Tests", to: "Core", transitive: true, reason: "boundary" },
    ]).length,
    1,
  );
  const hunks = patchHunks(
    "diff --git a/a.cs b/a.cs\n--- a/a.cs\n+++ b/a.cs\n@@ -1 +1 @@\n-old\n+new\n@@ -30 +30 @@\n-before\n+after\n",
  );
  assert.equal(hunks.length, 2);
  assert.match(hunks[0].patch, /diff --git/);
  assert.equal(hunks[0].patch.includes("after"), false);
});
test("log report redaction handles JSON secrets with spaces and bearer tokens", () => {
  const result = redactLogText(
    '{"Password":"secret with spaces","nested":{"apiKey":"hidden"},"message":"Bearer credential"}',
  );
  assert.equal(result.includes("secret with spaces"), false);
  assert.equal(result.includes("hidden"), false);
  assert.equal(result.includes("Bearer credential"), false);
  assert.equal(
    redactLogText('password="long secret text"').includes("long secret"),
    false,
  );
});
