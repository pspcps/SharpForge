import React, { useMemo, useState } from "react";
import type { SolutionFile } from "../types/minirider";
import {
  solutionHealth,
  architectureViolations,
  type ArchitectureRule,
} from "../utils/solutionHealth";
export function SolutionIntelligence({
  solution,
  onNavigate,
}: {
  solution: SolutionFile;
  onNavigate: (file: string, line: number) => void;
}) {
  const ruleKey = "sharpforge.architecture.rules:" + solution.path;
  const [rules, setRules] = useState<ArchitectureRule[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(ruleKey) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  });
  const [ruleFrom, setRuleFrom] = useState(solution.projects[0]?.id || ""),
    [ruleTo, setRuleTo] = useState(solution.projects[1]?.id || ""),
    [transitive, setTransitive] = useState(true),
    [reason, setReason] = useState("Layer boundary");
  const violations = useMemo(
    () => architectureViolations(solution, rules),
    [solution, rules],
  );
  function storeRules(next: ArchitectureRule[]) {
    setRules(next);
    try {
      localStorage.setItem(ruleKey, JSON.stringify(next));
    } catch {}
  }
  const report = useMemo(() => solutionHealth(solution), [solution]);
  const [query, setQuery] = useState("");
  return (
    <section
      className="p-4 overflow-auto flex-1 min-h-0 space-y-4"
      aria-label="Solution intelligence"
    >
      <h3 className="text-xl">Project health and architecture</h3>
      <p>
        Reference and syntax evidence from the loaded solution. Conditional
        MSBuild behavior and unsupported framework/platform combinations require
        a restore/build check.
      </p>
      <div className="grid md:grid-cols-3 gap-3">
        {report.projects.map((project) => (
          <article
            className="border border-gray-600 rounded p-3"
            key={project.id}
          >
            <h4>{project.name}</h4>
            <p>
              {project.kind} · {project.frameworks.join(", ")}
            </p>
            <p>
              {project.sourceFiles} source files · {project.incoming} incoming ·{" "}
              {project.outgoing} outgoing
            </p>
            <p
              className={
                project.cycle || project.unresolved
                  ? "text-amber-200"
                  : "text-teal-200"
              }
            >
              {project.cycle ? "Dependency cycle detected. " : ""}
              {project.unresolved} unresolved references
            </p>
            {project.unusedCandidate && (
              <p className="text-amber-200">
                Unused-project candidate: no incoming solution references. Check
                external consumers before removing.
              </p>
            )}
          </article>
        ))}
      </div>
      <h4>Architecture constraints</h4>
      <p>
        Define dependencies that your architecture forbids. These rules are
        local to this solution.
      </p>
      <div className="flex gap-2 flex-wrap">
        <select
          aria-label="Rule source project"
          className="bg-gray-800 border p-2"
          value={ruleFrom}
          onChange={(e) => setRuleFrom(e.target.value)}
        >
          {solution.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <span>must not depend on</span>
        <select
          aria-label="Rule target project"
          className="bg-gray-800 border p-2"
          value={ruleTo}
          onChange={(e) => setRuleTo(e.target.value)}
        >
          {solution.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Architecture rule reason"
          className="bg-gray-800 border p-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={transitive}
            onChange={(e) => setTransitive(e.target.checked)}
          />
          Include transitive paths
        </label>
        <button
          className="bg-gray-700 p-2 rounded"
          onClick={() =>
            ruleFrom &&
            ruleTo &&
            storeRules([
              ...rules,
              { from: ruleFrom, to: ruleTo, transitive, reason },
            ])
          }
        >
          Add constraint
        </button>
      </div>
      {rules.map((rule, index) => (
        <p key={index}>
          {solution.projects.find((p) => p.id === rule.from)?.name} ↛{" "}
          {solution.projects.find((p) => p.id === rule.to)?.name} ·{" "}
          {rule.reason}{" "}
          <button
            className="text-red-300"
            onClick={() => storeRules(rules.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </p>
      ))}
      {violations.map((violation, index) => (
        <p className="text-red-300" key={index}>
          Violation:{" "}
          {violation.path
            .map(
              (id) =>
                solution.projects.find((project) => project.id === id)?.name ||
                id,
            )
            .join(" → ")}{" "}
          · {violation.reason}
        </p>
      ))}
      {rules.length > 0 && violations.length === 0 && (
        <p className="text-teal-200">
          No constraint violations in the loaded reference graph.
        </p>
      )}
      <h4>Architecture relationships</h4>
      {report.architecture.map((edge, i) => (
        <p key={i}>
          {edge.from} ({edge.fromKind}) → {edge.to} ({edge.toKind})
        </p>
      ))}
      <h4>Target framework compatibility</h4>
      {report.frameworkChecks.map((check, i) => (
        <p
          className={
            check.status === "incompatible"
              ? "text-red-300"
              : check.status === "unknown"
                ? "text-amber-200"
                : "text-teal-200"
          }
          key={i}
        >
          {check.from} [{check.source}] → {check.to} [{check.targets.join(", ")}
          ]: {check.status}
        </p>
      ))}
      {report.graph.unresolved.map((item, i) => (
        <p key={i} className="text-red-300">
          Unresolved reference: {item.project} → {item.reference}
        </p>
      ))}
      <h4>Interface implementation explorer</h4>
      <p>
        Includes syntactically detected inherited interfaces; ambiguous names
        and runtime registration are not semantic proof.
      </p>
      <input
        aria-label="Filter interfaces"
        className="bg-gray-800 border p-2"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Interface name"
      />
      {report.interfaces
        .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
        .map((item, i) => (
          <details key={i}>
            <summary>
              {item.name} ({item.implementations.length})
            </summary>
            <button
              className="text-blue-300"
              onClick={() => onNavigate(item.file, item.line)}
            >
              Open interface
            </button>
            {item.implementations.map((implementation, j) => (
              <button
                className="block p-2 text-teal-200"
                key={j}
                onClick={() =>
                  onNavigate(implementation.file, implementation.line)
                }
              >
                {implementation.name} · {implementation.file}:
                {implementation.line}
              </button>
            ))}
          </details>
        ))}
    </section>
  );
}
