import { redactLogText } from '../utils/logRedaction';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { parseLogLine } from "../utils/workspaceInsights";
import { parseIncidents } from "../utils/incidentParser";
import { ReadOnlyDiff } from "./ReadOnlyDiff";
const field = "bg-gray-900 border border-gray-600 p-2 rounded",
  button = "bg-gray-700 p-2 rounded";
export function LogIntelligence({
  logs,
  onNavigate,
}: {
  logs: string;
  onNavigate: (file: string, line: number) => void;
}) {
  const [sources, setSources] = useState<
      Record<string, { name: string; text: string }>
    >({}),
    [sourceName, setSourceName] = useState("Service"),
    [query, setQuery] = useState(""),
    [level, setLevel] = useState("all"),
    [trace, setTrace] = useState(""),
    [group, setGroup] = useState("source"),
    [error, setError] = useState(""),
    [redact, setRedact] = useState(true),
    [left, setLeft] = useState("run"),
    [right, setRight] = useState(""),
    [compare, setCompare] = useState(false);
  const watches = useRef(new Set<string>()),
    tails = useRef(new Map<string, string>());
  useEffect(() => {
    const off = window.electronAPI?.onAdvancedEvent?.("logs:event", (event) => {
      if (event.error) {
        setError(event.error);
        return;
      }
      setSources((previous) => ({
        ...previous,
        [event.id]: {
          name: previous[event.id]?.name || event.source,
          text: ((previous[event.id]?.text || "") + event.text).slice(-1000000),
        },
      }));
    });
    return () => {
      off?.();
      for (const id of watches.current)
        void window.electronAPI?.advancedInvoke?.("logs", "stop", { id });
    };
  }, []);
  const allSources: Record<string, { name: string; text: string }> = {
    run: { name: "App run / debugger", text: logs },
    ...sources,
  };
  const rows = useMemo(
    () =>
      Object.entries(allSources)
        .flatMap(([id, source]) =>
          source.text
            .split("\n")
            .filter(Boolean)
            .map((raw) => ({ ...parseLogLine(raw), source: source.name, id })),
        )
        .filter(
          (row) =>
            (level === "all" || row.level === level) &&
            row.raw.toLowerCase().includes(query.toLowerCase()) &&
            row.correlation.includes(trace),
        )
        .sort((a, b) => (a.time && b.time ? a.time.localeCompare(b.time) : 0)),
    [logs, sources, query, level, trace],
  );
  const groups = useMemo(() => {
    const result = new Map<string, typeof rows>();
    for (const row of rows.slice(-2000)) {
      const key =
        group === "source"
          ? row.source
          : group === "level"
            ? row.level
            : row.correlation || "No correlation ID";
      result.set(key, [...(result.get(key) || []), row]);
    }
    return result;
  }, [rows, group]);
  const incidents = useMemo(
    () => parseIncidents(rows.map((row) => row.raw).join("\n")),
    [rows],
  );
  function exportReport() {
    const clean=(value:string)=>redact?redactLogText(value):value;
    const text = JSON.stringify(
      {
        created: new Date().toISOString(),
        redacted: redact,
        warning:
          "Review the report for sensitive data before sharing; pattern redaction is not exhaustive.",
        logs: rows.map((row) => ({
          ...row,
          raw: clean(row.raw),
          message: clean(row.message),
        })),
      },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "cairn-log-report.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      className="p-4 overflow-auto flex-1 min-h-0 space-y-3"
      aria-label="Log intelligence"
    >
      <h3 className="text-xl">Live multi-source logs</h3>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2 flex-wrap">
        <input
          aria-label="Log source name"
          className={field}
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
        />
        <label className={button}>
          Import service log
          <input
            type="file"
            className="block"
            accept=".log,.jsonl,.txt"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 1000000)
                  throw new Error("Import a log smaller than 1 MB");
                const text = await file.text();
                setSources((previous) => ({
                  ...previous,
                  [crypto.randomUUID()]: {
                    name: sourceName + " / " + file.name,
                    text,
                  },
                }));
              } catch (error) {
                setError(String(error));
              }
            }}
          />
        </label>
        <button
          className={button}
          onClick={async () => {
            try {
              const id = crypto.randomUUID();
              const result = await window.electronAPI?.advancedInvoke?.(
                "logs",
                "watch",
                { id },
              );
              if (!result)
                throw new Error("Live file streaming requires the desktop app");
              if (result.cancelled) return;
              watches.current.add(id);
              setSources((previous) => ({
                ...previous,
                [id]: { name: sourceName, text: result.text },
              }));
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Stream service log file
        </button>
        <button
          className={button}
          onClick={() => {
            for (const id of watches.current)
              void window.electronAPI?.advancedInvoke?.("logs", "stop", { id });
            watches.current.clear();
          }}
        >
          Stop file streams
        </button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <input
          aria-label="Search all logs"
          className={field}
          placeholder="Search logs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input
          aria-label="Trace ID filter"
          className={field}
          placeholder="Trace / correlation ID"
          value={trace}
          onChange={(e) => setTrace(e.target.value)}
        />
        <select
          aria-label="Level filter"
          className={field}
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="all">All levels</option>
          {[
            ...new Set(
              Object.values(allSources).flatMap((s) =>
                s.text
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => parseLogLine(line).level),
              ),
            ),
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Group logs by"
          className={field}
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          {["source", "level", "trace"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <details>
        <summary>
          Exception groups and stack navigation ({incidents.length})
        </summary>
        {incidents.map((incident, i) => (
          <article key={i}>
            <strong>
              {incident.type}: {incident.message} ({incident.count})
            </strong>
            {incident.frames
              .filter((frame) => frame.file)
              .map((frame, j) => (
                <button
                  className="block text-blue-300"
                  key={j}
                  onClick={() => onNavigate(frame.file!, frame.line || 1)}
                >
                  {frame.file}:{frame.line}
                </button>
              ))}
          </article>
        ))}
      </details>
      <details>
        <summary>Request lifecycle by explicit correlation ID</summary>
        <p>
          Events are linked only when services record matching IDs. No
          cross-service inference is performed.
        </p>
        {[...new Set(rows.map((row) => row.correlation).filter(Boolean))].map(
          (id) => (
            <details key={id}>
              <summary>{id}</summary>
              {rows
                .filter((row) => row.correlation === id)
                .map((row, i) => (
                  <p key={i}>
                    {row.time || "No timestamp"} · {row.source} · {row.message}
                  </p>
                ))}
            </details>
          ),
        )}
      </details>
      <details>
        <summary>Compare log sources</summary>
        <select
          aria-label="Original log source"
          className={field}
          value={left}
          onChange={(e) => setLeft(e.target.value)}
        >
          {Object.entries(allSources).map(([id, s]) => (
            <option key={id} value={id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Comparison log source"
          className={field}
          value={right}
          onChange={(e) => setRight(e.target.value)}
        >
          <option value="">Choose source</option>
          {Object.entries(allSources).map(([id, s]) => (
            <option key={id} value={id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          className={button}
          onClick={() => setCompare((value) => !value)}
        >
          Toggle comparison
        </button>
        {compare && (
          <div className="h-96">
            <ReadOnlyDiff
              original={allSources[left]?.text || ""}
              modified={allSources[right]?.text || ""}
            />
          </div>
        )}
      </details>
      <label>
        <input
          type="checkbox"
          checked={redact}
          onChange={(e) => setRedact(e.target.checked)}
        />
        Redact recognized secret patterns in export
      </label>
      <button className={button} onClick={exportReport}>
        Export filtered report
      </button>
      <p>
        {rows.length} matching events; showing the latest 2000, up to 500 per
        group.
      </p>
      {[...groups].map(([name, items]) => (
        <details key={name} open>
          <summary>
            {name} ({items.length})
          </summary>
          {items.slice(-500).map((row, i) => (
            <details key={i} className="border-b border-gray-700 p-1">
              <summary className="break-all">
                <span
                  className={
                    /error|fatal/i.test(row.level)
                      ? "text-red-300"
                      : /warn/i.test(row.level)
                        ? "text-amber-200"
                        : "text-teal-200"
                  }
                >
                  {row.level}
                </span>{" "}
                · {row.time} · {row.message}
              </summary>
              <pre className="whitespace-pre-wrap break-all">{row.raw}</pre>
              {row.correlation && (
                <button
                  className={button}
                  onClick={() => setTrace(row.correlation)}
                >
                  Follow {row.correlation}
                </button>
              )}
            </details>
          ))}
        </details>
      ))}
    </section>
  );
}
