import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspectSolution,
  compareConfiguration,
  parseLogLine,
} from "../src/utils/workspaceInsights";
import type { SolutionFile, ProjectItem } from "../src/types/minirider";
function project(
  name: string,
  references: string[],
  version = "1.0",
): ProjectItem {
  return {
    id: name,
    name,
    path: `/repo/${name}/${name}.csproj`,
    targetFramework: "net8.0",
    projectType: "classlib",
    files: [],
    dependencies: {
      frameworks: [],
      projectReferences: references,
      packages: [{ id: "Example", version, isDirect: true }],
    },
  };
}
test("resolves project references, reports strongly connected cycles and version differences", () => {
  const solution: SolutionFile = {
    name: "Demo",
    path: "/repo/Demo.sln",
    format: "sln",
    projects: [
      project("A", ["B"]),
      project("B", ["A", "Missing"], "2.0"),
      project("C", []),
    ],
  };
  const result = inspectSolution(solution);
  assert.equal(result.edges.length, 2);
  assert.deepEqual(result.cycles[0].sort(), ["A", "B"]);
  assert.deepEqual(result.unresolved, [{ project: "B", reference: "Missing" }]);
  assert.equal(result.packages[0].differs, true);
  assert.equal(
    inspectSolution({ ...solution, projects: [project("C", ["C"])] }).cycles
      .length,
    1,
  );
});
test("configuration comparison preserves types, escaped keys and sensitive field detection", () => {
  const changes = compareConfiguration(
    '{"a/b":1,"empty":{},"ConnectionStrings":{"Main":"secret"},"enabled":false}',
    '{"a/b":"1","empty":[],"ConnectionStrings":{"Main":"changed"},"new":null}',
  );
  assert.equal(changes.find((c) => c.key === "/a~1b")?.status, "changed");
  assert.equal(
    changes.find((c) => c.key === "/ConnectionStrings/Main")?.sensitive,
    true,
  );
  assert.equal(changes.find((c) => c.key === "/enabled")?.status, "removed");
  assert.equal(changes.find((c) => c.key === "/new")?.status, "added");
  assert.equal(changes.find((c) => c.key === "/empty")?.status, "changed");
  assert.deepEqual(compareConfiguration('{"x":1,"y":2}', '{"y":2,"x":1}'), []);
  assert.throws(() => compareConfiguration("invalid", "{}"));
  assert.equal(
    compareConfiguration('{"__proto__":{"x":1}}', "{}")[0].key,
    "/__proto__/x",
  );
});
test("structured logs expose explicit correlation evidence and plain logs remain searchable", () => {
  assert.equal(
    parseLogLine('{"@l":"Error","@m":"failed","TraceId":"abc"}').correlation,
    "abc",
  );
  assert.equal(parseLogLine("Unhandled exception: missing").level, "error");
  assert.equal(parseLogLine("{incomplete").message, "{incomplete");
});
