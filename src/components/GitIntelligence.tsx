import { patchHunks } from "../utils/gitPatches";
import React, { useState } from "react";
import { ReadOnlyDiff } from "./ReadOnlyDiff";
const field = "bg-[#181b20] rounded border border-gray-600 p-2";
const button = "bg-[#343c49] rounded p-2 disabled:opacity-50";
export function GitIntelligence({ cwd }: { cwd: string }) {
  const [overview, setOverview] = useState<any>(null),
    [output, setOutput] = useState<any>(null),
    [file, setFile] = useState(""),
    [from, setFrom] = useState("HEAD~1"),
    [to, setTo] = useState("HEAD"),
    [commit, setCommit] = useState("HEAD"),
    [branch, setBranch] = useState(""),
    [stash, setStash] = useState("stash@{0}"),
    [patch, setPatch] = useState(""),
    [resolution, setResolution] = useState(""),
    [base, setBase] = useState("HEAD~3"),
    [todo, setTodo] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const invoke = async (
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!window.electronAPI?.advancedInvoke)
      throw new Error("Use the desktop app for Git tools");
    return window.electronAPI.advancedInvoke("git", action, {
      cwd,
      file,
      from,
      to,
      commit,
      branch,
      ref: stash,
      base,
      patch,
      text: resolution,
      ...extra,
    });
  };
  async function run(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      const extra =
        action === "rebase"
          ? {
              todo: todo
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                  const [action, commit] = line.trim().split(/\s+/);
                  return { action, commit };
                }),
            }
          : {};
      const result = await invoke(action, { ...extra, ...payload });
      if (action === "overview") setOverview(result);
      else setOutput(result);
      if (action === "diff") setPatch(result.text);
      if (["stage", "unstage", "stage-patch", "resolve"].includes(action))
        setPatch((await invoke("diff")).text);
      if (action === "conflict-file") setResolution(result.working);
      if (action === "rebase-preview")
        setTodo(
          result.commits.map((commit: string) => "pick " + commit).join("\n"),
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="p-4 flex-1 min-h-0 overflow-auto space-y-4"
      aria-label="Git intelligence"
    >
      <h3 className="text-xl">Git intelligence</h3>
      <p>
        Repository: {cwd}. History-changing operations require native
        confirmation. Branch cleanup only deletes merged local branches.
      </p>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      <button
        className={button}
        disabled={busy}
        onClick={() => run("overview")}
      >
        Refresh graph, status and health
      </button>
      {overview && (
        <>
          <h4>Commit graph</h4>
          <pre className="overflow-auto whitespace-pre">{overview.graph}</pre>
          <h4>Working tree / repository health</h4>
          <pre>
            {overview.status || "Clean working tree"}
            {"\n"}
            {overview.health}
          </pre>
        </>
      )}
      <h4>Interactive staging and file timeline</h4>
      <input
        aria-label="Git file"
        className={field}
        value={file}
        onChange={(e) => setFile(e.target.value)}
        placeholder="Relative file path"
      />
      <div className="flex gap-2 flex-wrap">
        {[
          ["diff", "View unstaged diff"],
          ["stage", "Stage file"],
          ["unstage", "Unstage file"],
          ["timeline", "File history"],
          ["conflicts", "List conflicts"],
          ["conflict-file", "Open conflict"],
        ].map(([action, label]) => (
          <button
            className={button}
            disabled={busy}
            key={action}
            onClick={() => run(action)}
          >
            {label}
          </button>
        ))}
      </div>
      <details>
        <summary>Stage selected hunks</summary>
        {patchHunks(patch).map((hunk, index) => (
          <details key={index}>
            <summary>{hunk.label}</summary>
            <pre className="whitespace-pre-wrap text-xs">{hunk.text}</pre>
            <button
              className={button}
              disabled={busy}
              onClick={() => run("stage-patch", { patch: hunk.patch })}
            >
              Stage this hunk
            </button>
          </details>
        ))}
        <p>
          Load a diff, remove unwanted complete hunks, then stage the edited
          patch. The working file is unchanged.
        </p>
        <textarea
          aria-label="Staging patch"
          className={field + " w-full h-48 font-mono"}
          value={patch}
          onChange={(e) => setPatch(e.target.value)}
        />
        <button
          className={button}
          disabled={busy}
          onClick={() => run("stage-patch")}
        >
          Validate and stage patch
        </button>
      </details>
      <h4>Branch comparison and commit impact</h4>
      <input
        aria-label="Compare from"
        className={field}
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      <input
        aria-label="Compare to"
        className={field}
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <button className={button} disabled={busy} onClick={() => run("compare")}>
        Compare branches
      </button>
      <input
        aria-label="Commit"
        className={field}
        value={commit}
        onChange={(e) => setCommit(e.target.value)}
      />
      <button className={button} disabled={busy} onClick={() => run("impact")}>
        Inspect commit impact
      </button>
      {output?.ours !== undefined && (
        <>
          <h4>Conflict: ours → theirs</h4>
          <details>
            <summary>Common ancestor</summary>
            <pre className="whitespace-pre-wrap">{output.base}</pre>
          </details>
          <div className="h-80">
            <ReadOnlyDiff original={output.ours} modified={output.theirs} />
          </div>
          <textarea
            aria-label="Conflict resolution"
            className={field + " w-full h-40"}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          />
          <button
            className={button}
            disabled={busy}
            onClick={() => run("resolve")}
          >
            Write and stage resolution
          </button>
        </>
      )}
      <details>
        <summary>Interactive rebase</summary>
        <input
          aria-label="Rebase base"
          className={field}
          value={base}
          onChange={(e) => setBase(e.target.value)}
        />
        <button
          className={button}
          disabled={busy}
          onClick={() => run("rebase-preview")}
        >
          Preview rebase commits
        </button>
        <p>
          Edit/reorder the plan using pick, drop, squash or fixup. Start with a
          clean working tree. Rewriting published history can affect
          collaborators.
        </p>
        <textarea
          aria-label="Rebase plan"
          className={field + " w-full h-48 font-mono"}
          value={todo}
          onChange={(e) => setTodo(e.target.value)}
        />
        {[
          ["rebase", "Apply rebase plan"],
          ["rebase-continue", "Continue rebase"],
          ["rebase-abort", "Abort rebase"],
        ].map(([action, label]) => (
          <button
            className={button + " m-1"}
            disabled={busy}
            key={action}
            onClick={() => run(action)}
          >
            {label}
          </button>
        ))}
      </details>
      <details>
        <summary>Branch cleanup assistant</summary>
        <button
          className={button}
          disabled={busy}
          onClick={() => run("cleanup-preview")}
        >
          Find merged branches
        </button>
        <input
          aria-label="Branch to delete"
          className={field}
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        />
        <button
          className={button}
          disabled={busy}
          onClick={() => run("delete-branch")}
        >
          Delete selected merged branch
        </button>
      </details>
      <details>
        <summary>Workspace change snapshots</summary>
        <pre>{overview?.snapshots}</pre>
        <button
          className={button}
          disabled={busy}
          onClick={() => run("snapshot")}
        >
          Create Git stash snapshot
        </button>
        <input
          aria-label="Snapshot reference"
          className={field}
          value={stash}
          onChange={(e) => setStash(e.target.value)}
        />
        <button
          className={button}
          disabled={busy}
          onClick={() => run("restore-snapshot")}
        >
          Apply snapshot (retain original)
        </button>
      </details>
      {output && output.ours === undefined && (
        <pre className="whitespace-pre-wrap break-all border border-gray-700 p-3">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </section>
  );
}
