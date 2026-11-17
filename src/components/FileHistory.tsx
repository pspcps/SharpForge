import React, { useEffect, useState } from "react";
import { ReadOnlyDiff } from "./ReadOnlyDiff";
export function FileHistory({
  file,
}: {
  file?: { path: string; content?: string };
}) {
  const [versions, setVersions] = useState<
    { timestamp: string; content: string }[]
  >([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setVersions([]);
    setSelected(0);
    setError("");
    if (!file || !window.electronAPI?.fileHistory) return;
    setLoading(true);
    window.electronAPI
      .fileHistory(file.path)
      .then((items) => {
        if (!cancelled) setVersions(items);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file?.path]);
  return (
    <section
      className="flex-1 min-h-0 flex flex-col gap-3 p-4 overflow-auto"
      aria-label="Local file history"
    >
      <h3>Local file history {file && <code>{file.path}</code>}</h3>
      <p className="text-gray-400">
        Previous on-disk versions are captured before desktop saves for
        supported source files. Configuration files are excluded. Up to 20
        versions per file are retained within a 50 MB / 100-file budget. History
        is stored locally and may contain sensitive source code. This preview
        never overwrites your editor.
      </p>
      {loading && <p role="status">Loading history…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !versions.length && (
        <p>
          No saved history for this file. History starts with desktop saves
          after this update. Browser preview has no disk history.
        </p>
      )}
      {versions.length > 0 && (
        <>
          <label>
            Previous version{" "}
            <select
              aria-label="Historical version"
              className="bg-gray-800 p-2"
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {versions.map((version, index) => (
                <option key={index} value={index}>
                  {version.timestamp}
                </option>
              ))}
            </select>
          </label>
          <div className="h-96 min-h-64">
            <ReadOnlyDiff
              original={versions[selected]?.content || ""}
              modified={file?.content || ""}
            />
          </div>
          <details>
            <summary>Previous text (select to copy)</summary>
            <pre className="whitespace-pre-wrap break-all">
              {versions[selected]?.content}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}
