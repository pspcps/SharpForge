import type { SolutionFile, ProjectItem } from "../types/minirider";

export function inspectSolution(solution: SolutionFile) {
  const aliases = new Map<string, ProjectItem[]>();
  const normalize = (s: string) =>
    s
      .replace(/\\/g, "/")
      .replace(/\.csproj$/i, "")
      .toLowerCase();
  const basename = (s: string) => normalize(s).split("/").pop()!;
  for (const project of solution.projects) {
    for (const key of new Set([
      normalize(project.id),
      normalize(project.name),
      normalize(project.path),
      basename(project.path),
    ]))
      aliases.set(key, [...(aliases.get(key) || []), project]);
  }
  const edges: { from: string; to: string }[] = [];
  const unresolved: { project: string; reference: string }[] = [];
  for (const project of solution.projects)
    for (const reference of project.dependencies.projectReferences) {
      const candidates =
        aliases.get(normalize(reference)) ||
        aliases.get(basename(reference)) ||
        [];
      if (candidates.length === 1)
        edges.push({ from: project.id, to: candidates[0].id });
      else unresolved.push({ project: project.name, reference });
    }
  // Tarjan strongly-connected components reports cycles without exponential path enumeration.
  let next = 0;
  const index = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    active = new Set<string>(),
    cycles: string[][] = [];
  const adjacency = new Map(
    solution.projects.map((p) => [
      p.id,
      edges.filter((e) => e.from === p.id).map((e) => e.to),
    ]),
  );
  function visit(id: string) {
    index.set(id, next);
    low.set(id, next++);
    stack.push(id);
    active.add(id);
    for (const target of adjacency.get(id) || []) {
      if (!index.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id)!, low.get(target)!));
      } else if (active.has(target))
        low.set(id, Math.min(low.get(id)!, index.get(target)!));
    }
    if (low.get(id) === index.get(id)) {
      const component: string[] = [];
      let item: string;
      do {
        item = stack.pop()!;
        active.delete(item);
        component.push(item);
      } while (item !== id);
      if (
        component.length > 1 ||
        edges.some((e) => e.from === id && e.to === id)
      )
        cycles.push(component);
    }
  }
  for (const p of solution.projects) if (!index.has(p.id)) visit(p.id);
  const packages = new Map<
    string,
    { name: string; declarations: { project: string; version: string }[] }
  >();
  for (const project of solution.projects)
    for (const pkg of project.dependencies.packages) {
      const key = pkg.id.toLowerCase();
      const group = packages.get(key) || { name: pkg.id, declarations: [] };
      group.declarations.push({ project: project.name, version: pkg.version });
      packages.set(key, group);
    }
  return {
    edges,
    cycles,
    unresolved,
    packages: [...packages.values()].map((p) => ({
      ...p,
      differs: new Set(p.declarations.map((d) => d.version)).size > 1,
    })),
  };
}

export function compareConfiguration(left: string, right: string) {
  function flatten(text: string) {
    if (text.length > 1_000_000)
      throw new Error("Use configuration inputs smaller than 1 MB");
    const result = new Map<string, string>();
    const root: unknown = JSON.parse(text);
    function walk(value: unknown, path: string, depth = 0) {
      if (depth > 100)
        throw new Error("Configuration nesting exceeds 100 levels");
      if (
        path === "" &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !Object.keys(value).length
      )
        return;
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length
      ) {
        for (const [key, child] of Object.entries(value))
          walk(
            child,
            path + "/" + key.replace(/~/g, "~0").replace(/\//g, "~1"),
            depth + 1,
          );
      } else result.set(path || "/", JSON.stringify(value));
    }
    walk(root, "");
    return result;
  }
  const a = flatten(left),
    b = flatten(right);
  return [...new Set([...a.keys(), ...b.keys()])].sort().flatMap((key) =>
    a.get(key) === b.get(key)
      ? []
      : [
          {
            key,
            status: !a.has(key) ? "added" : !b.has(key) ? "removed" : "changed",
            sensitive:
              /password|secret|token|connectionstring|credential|apikey/i.test(
                key,
              ),
            left: a.get(key),
            right: b.get(key),
          },
        ],
  );
}

export function parseLogLine(raw: string) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object")
      return {
        raw,
        level: String(
          obj.level || obj.Level || obj["@l"] || "info",
        ).toLowerCase(),
        message: String(obj.message || obj.Message || obj["@m"] || raw),
        correlation: String(
          obj.TraceId ||
            obj.traceId ||
            obj.CorrelationId ||
            obj.correlationId ||
            "",
        ),
        time: String(obj.timestamp || obj.Timestamp || obj["@t"] || ""),
      };
  } catch {
    /* Plain output is still searchable. */
  }
  return {
    raw,
    level: /\berror\b|exception/i.test(raw)
      ? "error"
      : /\bwarn(?:ing)?\b/i.test(raw)
        ? "warning"
        : "info",
    message: raw,
    correlation: "",
    time: "",
  };
}
