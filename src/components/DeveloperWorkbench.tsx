import React, { useMemo, useState, useEffect, useRef } from "react";
import { FileHistory } from "./FileHistory";
import { WorkspaceTools, type WorkspaceTool } from "./WorkspaceTools";
import type { SolutionFile } from "../types/minirider";
import { parseIncidents } from "../utils/incidentParser";
interface Props {
  logs: string;
  solution: SolutionFile;
  activeFile?: { path: string; content?: string };
  workspace: string;
  onClose: () => void;
  onNavigate: (file: string, line: number) => void;
  onBuild: () => void;
  onRun: () => void;
  onDebug: () => void;
  onFailedTests: () => void;
  onCommand: (command: string) => void;
}
interface Task {
  name: string;
  command: string;
}
export function DeveloperWorkbench(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const incidents = useMemo(() => parseIncidents(props.logs), [props.logs]);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<
    "incidents" | "tasks" | WorkspaceTool | "history"
  >("incidents");
  const key = `sharpforge.tasks:${props.workspace}`;
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value)
        ? value.filter(
            (t) => typeof t.name === "string" && typeof t.command === "string",
          )
        : [];
    } catch {
      return [];
    }
  });
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [notice, setNotice] = useState("");
  const active = incidents[Math.min(selected, incidents.length - 1)];
  function save(next: Task[]) {
    setTasks(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setNotice(
        "Task storage is unavailable. Changes last for this session only.",
      );
    }
  }
  const button =
    "px-3 py-2 rounded bg-[#34373d] hover:bg-[#444850] text-left disabled:opacity-50";
  return (
    <dialog
      ref={dialogRef}
      onCancel={props.onClose}
      aria-label="Developer workbench"
      className="fixed inset-4 m-0 w-[calc(100%_-_2rem)] h-[calc(100%_-_2rem)] max-w-none max-h-none z-[100] bg-[#1e1f22] text-gray-200 border border-gray-600 rounded-xl shadow-2xl flex flex-col select-text"
    >
      <header className="p-4 flex justify-between border-b border-gray-700">
        <h2 className="font-semibold">Developer workbench</h2>
        <button className={button} onClick={props.onClose} autoFocus>
          Close
        </button>
      </header>
      <nav className="flex gap-2 p-3 flex-wrap" aria-label="Workbench sections">
        <button
          className={button}
          aria-pressed={tab === "incidents"}
          onClick={() => setTab("incidents")}
        >
          Exceptions ({incidents.length})
        </button>
        <button
          className={button}
          aria-pressed={tab === "tasks"}
          onClick={() => setTab("tasks")}
        >
          Tasks & shortcuts
        </button>
        {(
          [
            ["history", "File history"],
            ["solution", "Solution map"],
            ["packages", "NuGet overview"],
            ["configuration", "Configuration"],
            ["utilities", "Utilities"],
            ["logs", "Logs"],
            ["compare", "File comparison"],
          ] as const
        ).map(([id, label]) => (
          <button
            className={button}
            key={id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {notice && (
        <p role="status" className="px-4 text-amber-300">
          {notice}
        </p>
      )}
      {tab === "history" && <FileHistory file={props.activeFile} />}
      {tab !== "incidents" && tab !== "tasks" && tab !== "history" && (
        <WorkspaceTools
          solution={props.solution}
          logs={props.logs}
          tool={tab}
        />
      )}
      {(tab === "incidents" || tab === "tasks") &&
        (tab === "incidents" ? (
          <div className="flex flex-1 min-h-0 overflow-auto">
            <aside className="w-1/3 p-3 overflow-auto border-r border-gray-700">
              {incidents.length === 0 && (
                <p>
                  No parsed exceptions yet. Run your app or debug it to capture
                  exception output. Native crashes without a managed stack may
                  only report an exit code in Terminal.
                </p>
              )}
              {incidents.map((item, i) => (
                <button
                  key={item.id}
                  className={`${button} block w-full mb-2 break-words ${i === selected ? "ring-1 ring-blue-400" : ""}`}
                  onClick={() => setSelected(i)}
                >
                  <strong>{item.type}</strong>
                  <p>{item.message}</p>
                  <small>{item.count} occurrence(s)</small>
                </button>
              ))}
            </aside>
            <article className="flex-1 min-w-0 p-5 overflow-auto">
              {active && (
                <>
                  <h3 className="text-xl text-red-300">{active.type}</h3>
                  <p className="my-3 break-words">{active.message}</p>
                  <h4 className="font-semibold">Investigation suggestion</h4>
                  <p className="my-2 text-amber-200">{active.suggestion}</p>
                  {active.chain.length > 0 && (
                    <>
                      <h4>Inner exceptions</h4>
                      {active.chain.map((c, i) => (
                        <p className="my-2 break-words" key={i}>
                          {c}
                        </p>
                      ))}
                    </>
                  )}
                  <h4 className="my-3 font-semibold">Stack frames</h4>
                  {active.frames.length === 0 && (
                    <p>
                      No stack frames captured. Ensure debug symbols are
                      available and capture the complete exception output.
                    </p>
                  )}
                  {active.frames.map((f, i) => (
                    <button
                      className={`${button} block w-full my-2 break-all`}
                      key={i}
                      disabled={!f.file || !f.line}
                      onClick={() =>
                        f.file && props.onNavigate(f.file, f.line || 1)
                      }
                    >
                      {f.method}
                      <small className="block text-blue-300">
                        {f.file
                          ? `${f.file}:${f.line}`
                          : "External frame · no source location"}
                      </small>
                    </button>
                  ))}
                  <button
                    className={button}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(active.raw);
                        setNotice(
                          "Report copied. Review paths and secrets before sharing.",
                        );
                      } catch {
                        setNotice(
                          "Clipboard unavailable. Select and copy the raw details below.",
                        );
                      }
                    }}
                  >
                    Copy exception report
                  </button>
                  <details className="mt-4">
                    <summary>Raw details</summary>
                    <pre className="whitespace-pre-wrap break-all">
                      {active.raw}
                    </pre>
                  </details>
                </>
              )}
            </article>
          </div>
        ) : (
          <div className="p-5 overflow-auto">
            <h3 className="mb-3 font-semibold">Everyday actions</h3>
            <div className="flex gap-2 flex-wrap">
              {[
                ["Build", props.onBuild],
                ["Run", props.onRun],
                ["Debug", props.onDebug],
                ["Rerun failed tests", props.onFailedTests],
              ].map(([label, action]) => (
                <button
                  className={button}
                  key={String(label)}
                  onClick={() => {
                    props.onClose();
                    (action as () => void)();
                  }}
                >
                  {label as string}
                </button>
              ))}
            </div>
            <h3 className="mt-6 mb-2 font-semibold">
              Saved commands for this workspace
            </h3>
            <p className="mb-3">
              Save repetitive commands such as formatting, migrations or code
              generation. Commands run only when you click Run. Do not save
              secrets here.
            </p>
            <form
              className="flex gap-2 flex-wrap"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && command.trim()) {
                  save([
                    ...tasks,
                    { name: name.trim(), command: command.trim() },
                  ]);
                  setName("");
                  setCommand("");
                }
              }}
            >
              <input
                aria-label="Task name"
                required
                className="bg-gray-800 p-2"
                placeholder="Task name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                aria-label="Task command"
                required
                className="bg-gray-800 p-2 flex-1"
                placeholder="dotnet format"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
              <button className={button}>Save task</button>
            </form>
            {tasks.map((task, i) => (
              <div className="flex gap-2 items-center my-3" key={i}>
                <div className="flex-1 break-all">
                  <strong>{task.name}</strong>
                  <pre className="whitespace-pre-wrap">{task.command}</pre>
                </div>
                <button
                  className={button}
                  onClick={() => {
                    props.onClose();
                    props.onCommand(task.command);
                  }}
                >
                  Run
                </button>
                <button
                  className={button}
                  onClick={() => save(tasks.filter((_, index) => index !== i))}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        ))}
    </dialog>
  );
}
