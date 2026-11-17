import React, { useMemo, useState } from "react";
import { ReadOnlyDiff } from "./ReadOnlyDiff";
import type { SolutionFile } from "../types/minirider";
import {
  inspectSolution,
  compareConfiguration,
  parseLogLine,
} from "../utils/workspaceInsights";
import { runUtility, type UtilityAction } from "../utils/developerUtilities";

const control =
  "bg-[#30333a] rounded px-3 py-2 border border-gray-600 disabled:opacity-50";
const textarea =
  "w-full min-h-40 bg-[#16171a] text-gray-200 rounded border border-gray-600 p-3 font-mono text-xs";
export type WorkspaceTool =
  | "solution"
  | "packages"
  | "configuration"
  | "utilities"
  | "logs"
  | "compare";
export function WorkspaceTools({
  solution,
  logs,
  tool,
}: {
  solution: SolutionFile;
  logs: string;
  tool: WorkspaceTool;
}) {
  const insights = useMemo(() => inspectSolution(solution), [solution]);
  const [project, setProject] = useState("");
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [correlation, setCorrelation] = useState("");
  const [left, setLeft] = useState("{}");
  const [right, setRight] = useState("{}");
  const [changes, setChanges] = useState<ReturnType<
    typeof compareConfiguration
  > | null>(null);
  const [reveal, setReveal] = useState(false);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [action, setAction] = useState<UtilityAction>("json");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = (id: string) =>
    solution.projects.find((p) => p.id === id)?.name || id;
  const logRows = useMemo(
    () =>
      logs
        .split("\n")
        .filter(Boolean)
        .map(parseLogLine)
        .filter(
          (row) =>
            (level === "all" || row.level === level) &&
            row.raw.toLowerCase().includes(query.toLowerCase()) &&
            row.correlation.toLowerCase().includes(correlation.toLowerCase()),
        ),
    [logs, level, query, correlation],
  );
  const allLevels = useMemo(
    () => [
      ...new Set(
        logs
          .split("\n")
          .filter(Boolean)
          .map((line) => parseLogLine(line).level),
      ),
    ],
    [logs],
  );
  const projects = project
    ? solution.projects.filter((p) => p.id === project)
    : solution.projects;
  async function utility() {
    setBusy(true);
    setError("");
    try {
      setOutput(await runUtility(action, input));
    } catch (e) {
      setOutput("");
      setError(e instanceof Error ? e.message : "Could not process input");
    } finally {
      setBusy(false);
    }
  }
  async function readFile(
    event: React.ChangeEvent<HTMLInputElement>,
    setter: (value: string) => void,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      if (file.size > 1_000_000)
        throw new Error("Choose a text file smaller than 1 MB");
      setter(await file.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read file");
    }
    event.target.value = "";
  }
  return (
    <section
      aria-label="Workspace tools"
      className="p-5 overflow-auto flex-1 min-h-0 space-y-4"
    >
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {tool === "solution" && (
        <>
          <h3 className="text-lg font-semibold">Solution dependencies</h3>
          <p>
            {solution.projects.length} projects · {insights.edges.length}{" "}
            references · {insights.cycles.length} cycle groups
          </p>
          <p className="text-gray-400">
            Based on the loaded project model. Conditional MSBuild references
            may require reloading with the intended configuration. An
            unreferenced project is not necessarily unused.
          </p>
          <label>
            Project{" "}
            <select
              className={control}
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">All projects</option>
              {solution.projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {solution.projects.length <= 60 && (
            <div className="overflow-auto bg-[#16171a] rounded border border-gray-700">
              <svg
                role="img"
                aria-label="Directed project dependency map; arrows point to referenced projects"
                width="900"
                height={Math.max(
                  180,
                  Math.ceil(solution.projects.length / 3) * 100,
                )}
              >
                <defs>
                  <marker
                    id="reference-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8" fill="#60a5fa" />
                  </marker>
                </defs>
                {insights.edges.map((edge, i) => {
                  const a = solution.projects.findIndex(
                      (p) => p.id === edge.from,
                    ),
                    b = solution.projects.findIndex((p) => p.id === edge.to);
                  return (
                    <line
                      key={i}
                      x1={(a % 3) * 290 + 135}
                      y1={Math.floor(a / 3) * 100 + 40}
                      x2={(b % 3) * 290 + 135}
                      y2={Math.floor(b / 3) * 100 + 40}
                      stroke="#60a5fa"
                      strokeOpacity={
                        project && edge.from !== project && edge.to !== project
                          ? 0.15
                          : 0.8
                      }
                      markerEnd="url(#reference-arrow)"
                    />
                  );
                })}
                {solution.projects.map((p, i) => (
                  <g key={p.id}>
                    <rect
                      x={(i % 3) * 290 + 10}
                      y={Math.floor(i / 3) * 100 + 20}
                      width="250"
                      height="40"
                      rx="6"
                      fill={project === p.id ? "#1e40af" : "#34373d"}
                    />
                    <text
                      x={(i % 3) * 290 + 20}
                      y={Math.floor(i / 3) * 100 + 45}
                      fill="white"
                      fontSize="12"
                    >
                      <title>{p.name}</title>
                      {p.name.length > 32 ? p.name.slice(0, 29) + "…" : p.name}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          )}
          {insights.cycles.map((cycle, i) => (
            <p key={i} className="text-amber-200">
              Cycle group: {cycle.map(name).join(", ")}
            </p>
          ))}
          {insights.unresolved.map((item, i) => (
            <p key={i} className="text-amber-200">
              Unresolved or ambiguous reference: {item.project} →{" "}
              {item.reference}
            </p>
          ))}
          {projects.map((p) => (
            <article className="border border-gray-700 p-3 rounded" key={p.id}>
              <h4 className="font-semibold">
                {p.name}{" "}
                <small>
                  {(p.targetFrameworks || [p.targetFramework]).join(", ")}
                </small>
              </h4>
              <p>
                References:{" "}
                {insights.edges
                  .filter((e) => e.from === p.id)
                  .map((e) => name(e.to))
                  .join(", ") || "None resolved"}
              </p>
              <p>
                Referenced by:{" "}
                {insights.edges
                  .filter((e) => e.to === p.id)
                  .map((e) => name(e.from))
                  .join(", ") || "None in this solution"}
              </p>
            </article>
          ))}
        </>
      )}
      {tool === "packages" && (
        <>
          <h3 className="text-lg font-semibold">
            NuGet declarations across projects
          </h3>
          <p className="text-gray-400">
            Different declarations are a review signal, not proof of
            incompatibility. This view does not query advisories, resolve
            transitive dependencies or provide legal clearance.
          </p>
          <input
            aria-label="Filter packages"
            className={control}
            placeholder="Filter package name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {insights.packages
            .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
            .map((pkg) => (
              <article
                key={pkg.name}
                className="p-3 border border-gray-700 rounded"
              >
                <h4 className="font-semibold">
                  {pkg.name}{" "}
                  {pkg.differs && (
                    <span className="text-amber-200">
                      · Declared versions differ
                    </span>
                  )}
                </h4>
                {pkg.declarations.map((d, i) => (
                  <p key={i}>
                    {d.project}: <code>{d.version}</code>
                  </p>
                ))}
              </article>
            ))}
          {!insights.packages.length && (
            <p>No package declarations in the loaded solution.</p>
          )}
        </>
      )}
      {(tool === "configuration" || tool === "compare") && (
        <>
          <h3 className="text-lg font-semibold">
            {tool === "configuration"
              ? "Compare JSON configuration"
              : "Compare text files"}
          </h3>
          <p className="text-gray-400">
            Choose local files or paste text. Inputs stay in this view and are
            not saved or sent to a server. Close the workbench to discard them.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label>
              Before
              <input
                aria-label="Choose before file"
                type="file"
                accept="text/*,.json,.cs,.xml,.yaml,.yml,.config"
                onChange={(e) => readFile(e, setLeft)}
              />
              <textarea
                aria-label="Before text"
                className={textarea}
                value={left}
                onChange={(e) => {
                  setLeft(e.target.value);
                  setChanges(null);
                }}
              />
            </label>
            <label>
              After
              <input
                aria-label="Choose after file"
                type="file"
                accept="text/*,.json,.cs,.xml,.yaml,.yml,.config"
                onChange={(e) => readFile(e, setRight)}
              />
              <textarea
                aria-label="After text"
                className={textarea}
                value={right}
                onChange={(e) => {
                  setRight(e.target.value);
                  setChanges(null);
                }}
              />
            </label>
          </div>
          {tool === "configuration" ? (
            <>
              <button
                className={control}
                onClick={() => {
                  setError("");
                  try {
                    setChanges(compareConfiguration(left, right));
                  } catch (e) {
                    setChanges(null);
                    setError(e instanceof Error ? e.message : "Invalid JSON");
                  }
                }}
              >
                Compare configuration
              </button>
              <label className="block">
                <input
                  type="checkbox"
                  checked={reveal}
                  onChange={(e) => setReveal(e.target.checked)}
                />{" "}
                Reveal sensitive values in results
              </label>
              {changes?.length === 0 && <p>No differences.</p>}
              {changes?.map((change) => (
                <article
                  className="p-3 rounded border border-gray-700 break-all"
                  key={change.key}
                >
                  <strong>
                    {change.status}: {change.key}
                  </strong>
                  <p>
                    Before:{" "}
                    {change.sensitive && !reveal
                      ? "[hidden]"
                      : (change.left ?? "[missing]")}
                  </p>
                  <p>
                    After:{" "}
                    {change.sensitive && !reveal
                      ? "[hidden]"
                      : (change.right ?? "[missing]")}
                  </p>
                </article>
              ))}
            </>
          ) : (
            <div className="h-96">
              <ReadOnlyDiff
                original={left}
                modified={right}
              />
            </div>
          )}
        </>
      )}
      {tool === "utilities" && (
        <>
          <h3 className="text-lg font-semibold">Local developer utilities</h3>
          <p className="text-gray-400">
            Inputs are not persisted or sent to a server. JWT inspection only
            decodes claims; it does not validate the token.
          </p>
          <label>
            Tool{" "}
            <select
              aria-label="Utility"
              className={control}
              value={action}
              onChange={(e) => {
                setAction(e.target.value as UtilityAction);
                setOutput("");
                setError("");
              }}
            >
              {[
                ["json", "Format / validate JSON"],
                ["base64-encode", "Base64 encode (UTF-8)"],
                ["base64-decode", "Base64 decode (UTF-8)"],
                ["url-encode", "URL encode"],
                ["url-decode", "URL decode"],
                ["jwt", "Inspect JWT (unverified)"],
                ["sha256", "SHA-256"],
                ["uuid", "Generate UUID"],
                ["timestamp", "Unix seconds → UTC"],
              ].map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <textarea
            aria-label="Utility input"
            className={textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className={control} disabled={busy} onClick={utility}>
            {busy ? "Working…" : "Process locally"}
          </button>
          <label className="block">
            Result
            <textarea
              aria-label="Utility result"
              className={textarea}
              value={output}
              readOnly
            />
          </label>
        </>
      )}
      {tool === "logs" && (
        <>
          <h3 className="text-lg font-semibold">Captured log explorer</h3>
          <p className="text-gray-400">
            Searches the retained run/debug output. Structured JSON supports
            common Serilog fields and trace/correlation IDs. It cannot infer
            links that services did not record.
          </p>
          <div className="flex gap-2 flex-wrap">
            <input
              aria-label="Search logs"
              className={control}
              placeholder="Search message or raw JSON"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Log level"
              className={control}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="all">All levels</option>
              {allLevels.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <input
              aria-label="Correlation ID"
              className={control}
              placeholder="Trace / correlation ID"
              value={correlation}
              onChange={(e) => setCorrelation(e.target.value)}
            />
          </div>
          <p>
            {logRows.length} matching lines. Showing the latest{" "}
            {Math.min(500, logRows.length)}.
          </p>
          {logRows.slice(-500).map((row, i) => (
            <details className="border-b border-gray-700 p-2" key={i}>
              <summary className="break-all">
                <span
                  className={
                    /error|fatal/i.test(row.level)
                      ? "text-red-300"
                      : "text-blue-300"
                  }
                >
                  {row.level}
                </span>{" "}
                {row.time} {row.message}
              </summary>
              {row.correlation && (
                <button
                  className={control}
                  onClick={() => setCorrelation(row.correlation)}
                >
                  Filter trace: {row.correlation}
                </button>
              )}
              <pre className="whitespace-pre-wrap break-all">{row.raw}</pre>
            </details>
          ))}
        </>
      )}
    </section>
  );
}
