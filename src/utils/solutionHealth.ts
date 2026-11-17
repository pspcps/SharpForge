import type { SolutionFile } from "../types/minirider";
import { inspectSolution } from "./workspaceInsights";
import { getOrBuildSolutionIndex } from "./csharpSymbolNavigator";
function parseFramework(value: string) {
  const [base, platform] = value.toLowerCase().split("-");
  let match = base.match(/^(netstandard|netcoreapp|net)(\d+)\.(\d+)$/);
  if (match)
    return {
      family: match[1] === "net" && Number(match[2]) >= 5 ? "modern" : match[1],
      version: Number(match[2]) + Number(match[3]) / 10,
      platform,
    };
  match = base.match(/^net([1-4])([0-9])([0-9]?)$/);
  return match
    ? {
        family: "framework",
        version:
          Number(match[1]) +
          Number(match[2]) / 10 +
          Number(match[3] || 0) / 100,
        platform,
      }
    : null;
}
export function frameworkCompatibility(
  source: string,
  target: string,
): "compatible" | "incompatible" | "unknown" {
  const a = parseFramework(source),
    b = parseFramework(target);
  if (!a || !b) return "unknown";
  if (b.platform && !a.platform) return "incompatible";
  if (b.platform && a.platform && a.platform !== b.platform) return "unknown";
  if (a.family === b.family)
    return a.version >= b.version ? "compatible" : "incompatible";
  if (b.family === "netstandard") {
    if (a.family === "modern")
      return b.version <= 2.1 ? "compatible" : "unknown";
    if (a.family === "framework")
      return b.version <= 2 && a.version >= 4.61
        ? "compatible"
        : "incompatible";
    if (a.family === "netcoreapp")
      return a.version >= 3 && b.version <= 2.1 ? "compatible" : "unknown";
  }
  return "incompatible";
}
export function solutionHealth(solution: SolutionFile) {
  const graph = inspectSolution(solution),
    index = getOrBuildSolutionIndex(solution);
  const types = [...index.typesByName.values()].flat();
  const interfaces = types
    .filter((t) => t.isInterface)
    .map((t) => ({
      name: t.key,
      file: t.file.path,
      line: t.line,
      implementations: types
        .filter(
          (candidate) =>
            !candidate.isInterface &&
            inherits(candidate.name, t.name, new Set()),
        )
        .map((candidate) => ({
          name: candidate.key,
          file: candidate.file.path,
          line: candidate.line,
        })),
    }));
  function inherits(type: string, base: string, seen: Set<string>): boolean {
    if (seen.has(type)) return false;
    seen.add(type);
    return (index.typesByName.get(type) || []).some((t) =>
      t.baseTypes.some(
        (parent) => parent === base || inherits(parent, base, seen),
      ),
    );
  }
  const frameworkChecks = graph.edges.flatMap((edge) => {
    const from = solution.projects.find((p) => p.id === edge.from)!,
      to = solution.projects.find((p) => p.id === edge.to)!;
    return (from.targetFrameworks || [from.targetFramework]).map((source) => {
      const targets = to.targetFrameworks || [to.targetFramework];
      const results = targets.map((target) =>
        frameworkCompatibility(source, target),
      );
      return {
        from: from.name,
        to: to.name,
        source,
        targets,
        status: results.includes("compatible")
          ? "compatible"
          : results.includes("unknown")
            ? "unknown"
            : "incompatible",
      };
    });
  });
  const projects = solution.projects.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.projectType,
    frameworks: p.targetFrameworks || [p.targetFramework],
    incoming: graph.edges.filter((e) => e.to === p.id).length,
    outgoing: graph.edges.filter((e) => e.from === p.id).length,
    unresolved: graph.unresolved.filter((e) => e.project === p.name).length,
    cycle: graph.cycles.some((c) => c.includes(p.id)),
    unusedCandidate:
      p.projectType === "classlib" && !graph.edges.some((e) => e.to === p.id),
    sourceFiles: index.files.filter((f) => f.project.id === p.id).length,
  }));
  return {
    projects,
    interfaces,
    frameworkChecks,
    architecture: graph.edges.map((e) => ({
      from: solution.projects.find((p) => p.id === e.from)!.name,
      fromKind: solution.projects.find((p) => p.id === e.from)!.projectType,
      to: solution.projects.find((p) => p.id === e.to)!.name,
      toKind: solution.projects.find((p) => p.id === e.to)!.projectType,
    })),
    graph,
  };
}
export function qualityMetrics(solution: SolutionFile) {
  const index = getOrBuildSolutionIndex(solution),
    methods = index.files
      .flatMap((file) =>
        file.types.flatMap((type) =>
          type.members
            .filter((m) => m.kind === "method" || m.kind === "ctor")
            .map((member) => {
              const body = file.stripped.slice(
                member.bodyStartOffset || 0,
                member.bodyEndOffset || 0,
              );
              return {
                name: type.name + "." + member.name,
                file: member.file.path,
                line: member.line,
                decisions:
                  (
                    body.match(
                      /\b(?:if|for|foreach|while|case|catch)\b|&&|\|\||\?(?![?.])/g,
                    ) || []
                  ).length + 1,
                lines: body.split("\n").length,
              };
            }),
        ),
      )
      .sort((a, b) => b.decisions - a.decisions);
  const windows = new Map<string, { file: string; line: number }[]>();
  for (const file of index.files) {
    const lines = file.stripped
      .split("\n")
      .map((text, i) => ({
        text: text.trim().replace(/\s+/g, " "),
        line: i + 1,
      }))
      .filter((row) => row.text.length > 3);
    for (let i = 0; i <= lines.length - 8; i++) {
      const key = lines
        .slice(i, i + 8)
        .map((row) => row.text)
        .join("\n");
      const values = windows.get(key) || [];
      if (values.length < 20)
        values.push({ file: file.file.path, line: lines[i].line });
      windows.set(key, values);
    }
  }
  const duplicates = [...windows.entries()]
    .filter(([, locations]) => locations.length > 1)
    .slice(0, 100)
    .map(([text, locations]) => ({ text, locations }));
  return { methods, duplicates, sourceFiles: index.files.length };
}

export interface ArchitectureRule {from:string;to:string;transitive:boolean;reason:string}
export function architectureViolations(solution:SolutionFile,rules:ArchitectureRule[]){const graph=inspectSolution(solution);return rules.flatMap((rule,index)=>{const visited=new Set([rule.from]);const queue=[{id:rule.from,path:[rule.from]}];while(queue.length){const current=queue.shift()!;for(const edge of graph.edges.filter(edge=>edge.from===current.id)){const path=[...current.path,edge.to];if(edge.to===rule.to)return [{rule:index,path,reason:rule.reason}];if(rule.transitive&&!visited.has(edge.to)){visited.add(edge.to);queue.push({id:edge.to,path});}}}return [];});}
