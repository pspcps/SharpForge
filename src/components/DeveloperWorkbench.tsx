import { DependencyCanvas } from "./DependencyCanvas";
import {
  Cable,
  GitBranch,
  Gauge,
  Network,
  Boxes,
  Layers,
  Bug,
  ScrollText,
  TerminalSquare,
  History,
  Settings2,
  Wrench,
  Files,
  X,
} from "lucide-react";
import { ApiClient } from "./ApiClient";
import { GitIntelligence } from "./GitIntelligence";
import { LogIntelligence } from "./LogIntelligence";
import { QualityCenter } from "./QualityCenter";
import { SolutionIntelligence } from "./SolutionIntelligence";
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
    | "incidents"
    | "tasks"
    | WorkspaceTool
    | "history"
    | "api"
    | "git-tools"
    | "quality"
    | "solution-health"
  >(incidents.length ? "incidents" : "solution");
  const cwd =
    props.solution.path.replace(/\\/g, "/").replace(/\/[^/]+$/, "") || ".";
  function closeWorkbench() {
    dialogRef.current?.close();
    props.onClose();
  }
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
      onCancel={(event) => {
        event.preventDefault();
        closeWorkbench();
      }}
      onClose={props.onClose}
      aria-label="Developer workbench"
      className="workbench-shell sharpforge-no-drag"
    >
      <header className="wb-header">
        <div className="flex items-center gap-3">
          <img src="./icon.png" alt="" className="w-7 h-7 rounded-lg" />
          <div>
            <h2 className="font-semibold text-sm text-slate-100">
              Developer workbench
            </h2>
            <p className="text-[11px] text-slate-500">
              {props.solution.name} · {props.solution.projects.length} projects
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close developer workbench"
          className="wb-close"
          onClick={(event) => {
            event.stopPropagation();
            closeWorkbench();
          }}
          autoFocus
        >
          <X size={16} />
          <span>Close</span>
          <kbd>Esc</kbd>
        </button>
      </header>
      <div className="wb-layout">
        <nav className="wb-sidebar" aria-label="Workbench sections">
          {(
            [
              {
                name: "Architecture",
                items: [
                  ["solution", "Dependency explorer", Network],
                  ["solution-health", "Solution intelligence", Layers],
                  ["packages", "NuGet overview", Boxes],
                ],
              },
              {
                name: "Investigate",
                items: [
                  ["incidents", "Exceptions", Bug],
                  ["logs", "Log intelligence", ScrollText],
                  ["api", "API client", Cable],
                  ["quality", "Testing & quality", Gauge],
                  ["git-tools", "Git intelligence", GitBranch],
                ],
              },
              {
                name: "Workspace",
                items: [
                  ["tasks", "Tasks & shortcuts", TerminalSquare],
                  ["history", "File history", History],
                  ["configuration", "Configuration", Settings2],
                  ["compare", "File comparison", Files],
                  ["utilities", "Utilities", Wrench],
                ],
              },
            ] as const
          ).map((group) => (
            <div key={group.name}>
              <p className="wb-group">{group.name}</p>
              {group.items.map(([id, label, Icon]) => (
                <button
                  type="button"
                  key={id}
                  className={"wb-nav-item " + (tab === id ? "is-active" : "")}
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                  {id === "incidents" && incidents.length > 0 && (
                    <small>{incidents.length}</small>
                  )}
                </button>
              ))}
            </div>
          ))}
          <div className="wb-sidebar-foot">
            CAIRN IDE <span>Developer tools</span>
          </div>
        </nav>
        <main className="wb-content">
          {notice && (
            <p role="status" className="px-4 text-amber-300">
              {notice}
            </p>
          )}
          {tab === "solution" && (
            <DependencyCanvas
              solution={props.solution}
              onNavigate={props.onNavigate}
            />
          )}
          {tab === "api" && <ApiClient workspace={props.workspace} />}
          {tab === "git-tools" && <GitIntelligence cwd={cwd} />}
          {tab === "quality" && (
            <QualityCenter
              solution={props.solution}
              cwd={cwd}
              onNavigate={props.onNavigate}
            />
          )}
          {tab === "solution-health" && (
            <SolutionIntelligence
              solution={props.solution}
              onNavigate={props.onNavigate}
            />
          )}
          {tab === "logs" && (
            <LogIntelligence logs={props.logs} onNavigate={props.onNavigate} />
          )}
          {tab === "history" && <FileHistory file={props.activeFile} />}
          {tab !== "incidents" &&
            tab !== "tasks" &&
            tab !== "history" &&
            tab !== "api" &&
            tab !== "git-tools" &&
            tab !== "quality" &&
            tab !== "solution-health" &&
            tab !== "logs" &&
            tab !== "solution" && (
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
                      No exceptions captured. Run or debug your application to
                      inspect failures here.
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
                      <h4 className="font-semibold">
                        Investigation suggestion
                      </h4>
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
                  Save repetitive commands such as formatting, migrations or
                  code generation. Commands run only when you click Run. Do not
                  save secrets here.
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
                      onClick={() =>
                        save(tasks.filter((_, index) => index !== i))
                      }
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            ))}
        </main>
      </div>
    </dialog>
  );
}
