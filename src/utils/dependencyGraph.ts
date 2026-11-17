import type { SolutionFile } from "../types/minirider";
import { inspectSolution } from "./workspaceInsights";
import { getOrBuildSolutionIndex } from "./csharpSymbolNavigator";
export interface DependencyNode {
  id: string;
  label: string;
  kind: string;
  detail: string;
  file?: string;
  line?: number;
}
export interface DependencyEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
}
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}
export function dependencyGraph(
  solution: SolutionFile,
  mode: "projects" | "packages" | "types" | "calls",
  assets?: { nodes: DependencyNode[]; edges: DependencyEdge[] },
): DependencyGraph {
  const nodes: DependencyNode[] = solution.projects.map((project) => ({
    id: "project:" + project.id,
    label: project.name,
    kind: project.projectType,
    detail: (project.targetFrameworks || [project.targetFramework]).join(", "),
    file: project.path,
  }));
  const graph = inspectSolution(solution);
  const edges: DependencyEdge[] = graph.edges.map((edge, i) => ({
    id: "project-edge:" + i,
    source: "project:" + edge.from,
    target: "project:" + edge.to,
    kind: "ProjectReference",
  }));
  if (mode === "packages") {
    const known = new Set(nodes.map((node) => node.id));
    for (const project of solution.projects)
      for (const pkg of project.dependencies.packages) {
        const id =
          "package:" +
          pkg.id.toLowerCase() +
          "/" +
          (pkg.resolvedVersion || pkg.version);
        if (!known.has(id)) {
          known.add(id);
          nodes.push({
            id,
            label: pkg.id,
            kind: "package",
            detail: pkg.resolvedVersion || pkg.version,
          });
        }
        edges.push({
          id: "package-edge:" + edges.length,
          source: "project:" + project.id,
          target: id,
          kind: pkg.isDirect ? "direct package" : "loaded transitive package",
        });
      }
    if (assets) {
      for (const node of assets.nodes)
        if (!known.has(node.id)) {
          known.add(node.id);
          nodes.push(node);
        }
      for (const edge of assets.edges)
        if (known.has(edge.source) && known.has(edge.target)) edges.push(edge);
    }
  }
  if (mode === "types") {
    const index = getOrBuildSolutionIndex(solution),
      types = [...index.typesByName.values()].flat();
    const known = new Map<string, string>();
    for (const type of types) {
      const id = "type:" + type.key + "@" + type.file.path;
      known.set(type.key, id);
      known.set(type.name, id);
      if (!nodes.some((node) => node.id === id)) {
        nodes.push({
          id,
          label: type.name,
          kind: type.kind,
          detail: type.namespace,
          file: type.file.path,
          line: type.line,
        });
        edges.push({
          id: "contains:" + id,
          source: "project:" + type.project.id,
          target: id,
          kind: "contains",
        });
      }
    }
    for (const type of types) {
      const source = known.get(type.key)!;
      for (const parent of type.baseTypes) {
        const target = known.get(parent);
        if (target)
          edges.push({
            id: "inherits:" + source + ":" + target,
            source,
            target,
            kind: "inherits / implements",
          });
      }
      for (const member of type.members) {
        const dependencies = [
          member.returnType,
          ...member.params.map((param) => param.type),
        ];
        for (const name of dependencies) {
          const target = known.get(name.replace(/<.*>|\[\]|\?/g, ""));
          if (
            target &&
            target !== source &&
            !edges.some(
              (edge) => edge.source === source && edge.target === target,
            )
          )
            edges.push({
              id: "uses:" + source + ":" + target,
              source,
              target,
              kind: "signature dependency",
            });
        }
      }
    }
  }
  if (mode === "calls") {
    const index = getOrBuildSolutionIndex(solution);
    const methods = [...index.typesByName.values()]
      .flat()
      .flatMap((type) =>
        type.members
          .filter(
            (member) => member.kind === "method" || member.kind === "ctor",
          )
          .map((member) => ({
            type,
            member,
            id:
              "method:" +
              member.file.path +
              ":" +
              member.line +
              ":" +
              member.name,
          })),
      );
    const byName = new Map<string, typeof methods>();
    for (const method of methods) {
      const values = byName.get(method.member.name) || [];
      values.push(method);
      byName.set(method.member.name, values);
      nodes.push({
        id: method.id,
        label: method.type.name + "." + method.member.name,
        kind: "method",
        detail: method.member.returnType,
        file: method.member.file.path,
        line: method.member.line,
      });
      edges.push({
        id: "owns:" + method.id,
        source: "project:" + method.member.project.id,
        target: method.id,
        kind: "contains method",
      });
    }
    for (const method of methods) {
      const file = index.files.find(
        (file) => file.file.path === method.member.file.path,
      );
      if (
        !file ||
        method.member.bodyStartOffset === undefined ||
        method.member.bodyEndOffset === undefined
      )
        continue;
      const body = file.stripped.slice(
        method.member.bodyStartOffset,
        method.member.bodyEndOffset,
      );
      for (const match of body.matchAll(
        /\b([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*\(/g,
      )) {
        const candidates = byName.get(match[1]) || [];
        if (candidates.length === 1) {
          const target = candidates[0].id;
          const id = "calls:" + method.id + ":" + target;
          if (!edges.some((edge) => edge.id === id))
            edges.push({
              id,
              source: method.id,
              target,
              kind: "call candidate (unique name)",
            });
        }
      }
    }
  }
  return { nodes, edges };
}
export function impactedNodes(
  graph: DependencyGraph,
  id: string,
  direction: "dependents" | "dependencies",
) {
  const found = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      const from = direction === "dependents" ? edge.target : edge.source,
        to = direction === "dependents" ? edge.source : edge.target;
      if (found.has(from) && !found.has(to)) {
        found.add(to);
        changed = true;
      }
    }
  }
  return found;
}
