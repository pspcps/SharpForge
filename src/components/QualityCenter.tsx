import React, { useMemo, useState, useRef } from "react";
import type { SolutionFile } from "../types/minirider";
import { qualityMetrics, solutionHealth } from "../utils/solutionHealth";
const button = "bg-gray-700 p-2 rounded disabled:opacity-50";
export function QualityCenter({
  solution,
  cwd,
  onNavigate,
}: {
  solution: SolutionFile;
  cwd: string;
  onNavigate: (file: string, line: number) => void;
}) {
  const runId = useRef("");
  const metrics = useMemo(() => qualityMetrics(solution), [solution]),
    health = useMemo(() => solutionHealth(solution), [solution]);
  const [report, setReport] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]),
    [target, setTarget] = useState(solution.path),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [changes, setChanges] = useState("");
  const impacted = useMemo(() => {
    const changed = changes.split("\n").filter(Boolean);
    const globalChange = changed.some((file) =>
      /(?:^|\/)(?:Directory\..*\.(?:props|targets)|global\.json|[Nn]u[Gg]et\.config)$|\.slnx?$/.test(
        file,
      ),
    );
    const projects = new Set(
      solution.projects
        .filter(
          (project) =>
            globalChange ||
            changed.some((file) =>
              file
                .replace(/\\/g, "/")
                .startsWith(
                  project.path.replace(/\\/g, "/").replace(/\/[^/]+$/, "") +
                    "/",
                ),
            ),
        )
        .map((project) => project.id),
    );
    let added = true;
    while (added) {
      added = false;
      for (const edge of health.graph.edges)
        if (projects.has(edge.to) && !projects.has(edge.from)) {
          projects.add(edge.from);
          added = true;
        }
    }
    return solution.projects.filter(
      (p) => projects.has(p.id) && p.projectType === "test",
    );
  }, [changes, solution, health]);
  async function run(action: string) {
    setBusy(true);
    setError("");
    try {
      if (!window.electronAPI?.advancedInvoke)
        throw new Error("Use the desktop app for .NET quality tooling");
      runId.current = crypto.randomUUID();
      const result = await window.electronAPI.advancedInvoke(
        "quality",
        action,
        { cwd, target, id: runId.current },
      );
      if (action === "history") setHistory(result);
      else setReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="p-4 flex-1 min-h-0 overflow-auto space-y-3"
      aria-label="Testing and quality center"
    >
      <h3 className="text-xl">Testing and quality center</h3>
      <p>
        The existing Tests sidebar remains the unified explorer, grouped by
        project. This center adds actual .NET runs, retained results, Cobertura
        coverage, static-analysis diagnostics and source metrics.
      </p>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      <label>
        Target{" "}
        <select
          className="bg-gray-900 border p-2"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value={solution.path}>{solution.name}</option>
          {solution.projects.map((project) => (
            <option key={project.id} value={project.path}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2 flex-wrap">
        {[
          ["test", "Run tests"],
          ["coverage", "Run tests with coverage"],
          ["coverage-import", "Import Cobertura report"],
          ["analyze", "Run compiler/analyzers"],
          ["format", "Verify formatting"],
          ["history", "Load run history"],
        ].map(([action, label]) => (
          <button
            className={button}
            disabled={busy}
            key={action}
            onClick={() => run(action)}
          >
            {busy ? "Working…" : label}
          </button>
        ))}
      </div>
      {busy && (
        <button
          className={button}
          onClick={() =>
            void window.electronAPI?.advancedInvoke?.("quality", "cancel", {
              id: runId.current,
            })
          }
        >
          Cancel quality run
        </button>
      )}
      <p className="text-gray-400">
        Coverage runs require coverlet.collector in the test project. The IDE
        reports tooling failures without modifying project dependencies.
        Formatting verification never rewrites files.
      </p>
      {report && (
        <>
          <h4>Run result</h4>
          <p>
            Exit {report.exitCode ?? "—"} · {report.durationMs ?? "—"} ms ·
            started {report.started}
          </p>
          {report.testResults?.map((test: any, i: number) => (
            <details key={i}>
              <summary
                className={
                  test.outcome === "Passed" ? "text-teal-200" : "text-red-300"
                }
              >
                {test.outcome} · {test.name} · {test.duration}
              </summary>
              <pre className="whitespace-pre-wrap">{test.error}</pre>
            </details>
          ))}
          <details>
            <summary>Analysis dashboard / dead-code diagnostics</summary>
            <p>
              Unused/dead code is reported only when the compiler or installed
              analyzers emit relevant diagnostics (for example CS0162, CS0219,
              IDE0051). This is not a proof that public symbols are unused.
            </p>
            {report.diagnostics?.map((line: string, i: number) => (
              <p key={i} className="break-all">
                {line}
              </p>
            ))}
          </details>
          <details>
            <summary>Tool output</summary>
            <pre className="whitespace-pre-wrap break-all">
              {report.stdout}
              {report.stderr}
            </pre>
          </details>
          {(report.coverage || (report.files ? [report] : [])).map(
            (coverage: any, i: number) => (
              <article key={i}>
                <h4>
                  Line coverage: {(coverage.lineRate * 100).toFixed(1)}% ·
                  branch coverage {(coverage.branchRate * 100).toFixed(1)}%
                </h4>
                {coverage.files.map((file: any, j: number) => (
                  <details key={j}>
                    <summary>
                      {file.file} · {(file.lineRate * 100).toFixed(1)}%
                    </summary>
                    {file.lines.map((line: any) => (
                      <button
                        className={`m-1 p-1 ${line.hits ? "bg-teal-900" : "bg-red-900"}`}
                        key={line.number}
                        onClick={() =>
                          onNavigate(
                            file.file.startsWith("/")
                              ? file.file
                              : cwd + "/" + file.file,
                            line.number,
                          )
                        }
                      >
                        L{line.number}: {line.hits} hits
                      </button>
                    ))}
                  </details>
                ))}
              </article>
            ),
          )}
        </>
      )}
      <details>
        <summary>Test execution timeline and failed-test history</summary>
        {history.map((item) => (
          <article key={item.id} className="p-2 border-b border-gray-700">
            <button onClick={() => setReport(item)}>
              {item.started} · {item.action} · {item.durationMs} ms · exit{" "}
              {item.exitCode}
            </button>
            {item.testResults
              ?.filter((test: any) => test.outcome !== "Passed")
              .map((test: any, i: number) => (
                <p className="text-red-300" key={i}>
                  {test.name}: {test.outcome}
                </p>
              ))}
          </article>
        ))}
      </details>
      <details>
        <summary>
          Code complexity analyzer ({metrics.methods.length} methods)
        </summary>
        <p>
          Syntax-based decision counts and body lengths are review indicators;
          generated code and language constructs can affect these estimates.
        </p>
        {metrics.methods.slice(0, 300).map((method, i) => (
          <button
            className="block text-blue-300"
            key={i}
            onClick={() => onNavigate(method.file, method.line)}
          >
            {method.name} · decisions {method.decisions} · {method.lines} lines
          </button>
        ))}
      </details>
      <details>
        <summary>
          Duplicate code candidates ({metrics.duplicates.length})
        </summary>
        <p>
          Exact normalized eight-line windows; overlapping windows may describe
          the same duplication.
        </p>
        {metrics.duplicates.map((duplicate, i) => (
          <details key={i}>
            <summary>{duplicate.locations.length} occurrences</summary>
            {duplicate.locations.map((location, j) => (
              <button
                className="block text-blue-300"
                key={j}
                onClick={() => onNavigate(location.file, location.line)}
              >
                {location.file}:{location.line}
              </button>
            ))}
            <pre>{duplicate.text}</pre>
          </details>
        ))}
      </details>
      <details>
        <summary>Test impact analysis by project dependency</summary>
        <p>
          Enter changed absolute source paths, one per line. This conservatively
          selects dependent test projects; it does not claim method-level
          coverage impact.
        </p>
        <button
          className={button}
          onClick={async () => {
            try {
              const result = await window.electronAPI?.advancedInvoke?.(
                "git",
                "changed-files",
                { cwd },
              );
              if (!result)
                throw new Error("Use desktop mode to inspect Git changes");
              setChanges(result.files.join("\n"));
            } catch (error) {
              setError(String(error));
            }
          }}
        >
          Load changed files from Git
        </button>
        <textarea
          aria-label="Changed source paths"
          className="bg-gray-900 w-full h-28 border p-2"
          value={changes}
          onChange={(e) => setChanges(e.target.value)}
        />
        {impacted.map((project) => (
          <button
            className={button + " m-1"}
            key={project.id}
            onClick={() => setTarget(project.path)}
          >
            Select {project.name}
          </button>
        ))}
        {changes && !impacted.length && (
          <p>
            No dependent test project identified. Run the full suite when
            dependency evidence is incomplete.
          </p>
        )}
      </details>
    </section>
  );
}
