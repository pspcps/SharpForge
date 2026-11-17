import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TerminalSession } from "../types/electron";

function TerminalView({
  session,
  visible,
}: {
  session: TerminalSession;
  visible: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Terminal | null>(null);
  const written = useRef(0);
  const fitRef = useRef<() => void>(() => {});
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      scrollback: 5000,
      theme: { background: "#18191c" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current!);
    instance.current = terminal;
    const input = terminal.onData((data) => {
      void window.electronAPI?.terminalWrite?.(session.id, data);
    });
    const resize = () => {
      if (!host.current?.offsetWidth || !host.current?.offsetHeight) return;
      fit.fit();
      void window.electronAPI?.terminalResize?.(
        session.id,
        terminal.cols,
        terminal.rows,
      );
    };
    fitRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(host.current!);
    return () => {
      observer.disconnect();
      input.dispose();
      terminal.dispose();
      instance.current = null;
      written.current = 0;
    };
  }, [session.id]);
  useEffect(() => {
    const length = session.outputLength - written.current;
    if (length > 0 && length <= session.output.length)
      instance.current?.write(session.output.slice(-length));
    else if (length > 0) {
      instance.current?.reset();
      instance.current?.write(session.output);
    }
    written.current = session.outputLength;
  }, [session.output, session.outputLength]);
  useEffect(() => {
    if (visible) {
      fitRef.current();
      instance.current?.focus();
    }
  }, [visible]);
  return (
    <div
      ref={host}
      className={`${visible ? "block" : "hidden"} h-full min-w-0 p-2`}
      aria-label={`${session.title} terminal`}
    />
  );
}

export function TerminalWorkspace({ cwd }: { cwd: string }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [active, setActive] = useState("");
  const [claudeAvailable, setClaudeAvailable] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const alive = useRef(true);
  type OutputEvent = {
    id: string;
    data: string;
    sequence: number;
    outputLength: number;
    exited?: boolean;
  };
  const pending = useRef(new Map<string, OutputEvent[]>());
  function apply(
    session: TerminalSession,
    event: OutputEvent,
  ): TerminalSession {
    return event.sequence > session.sequence
      ? {
          ...session,
          output: (session.output + event.data).slice(-200000),
          sequence: event.sequence,
          outputLength: event.outputLength,
          exited: event.exited || session.exited,
        }
      : session;
  }
  function replay(session: TerminalSession) {
    return (pending.current.get(session.id) || []).reduce(apply, session);
  }
  useEffect(() => {
    alive.current = true;
    const api = window.electronAPI;
    const unsubscribe = api?.onTerminalEvent?.((event) => {
      pending.current.set(
        event.id,
        [...(pending.current.get(event.id) || []), event].slice(-100),
      );
      setSessions((previous) =>
        previous.map((session) =>
          session.id === event.id ? apply(session, event) : session,
        ),
      );
    });
    api
      ?.terminalList?.(cwd)
      .then(async (result) => {
        if (!alive.current) return;
        setClaudeAvailable(result.claudeAvailable);
        if (result.sessions.length) {
          setSessions(result.sessions.map(replay));
          setActive(
            (
              result.sessions.find((s) => s.kind === "claude" && !s.exited) ||
              result.sessions[0]
            ).id,
          );
        } else {
          const created = await api.terminalCreate?.({
            cwd,
            kind: result.claudeAvailable ? "claude" : "shell",
          });
          if (created && alive.current) {
            setSessions([replay(created)]);
            setActive(created.id);
          }
        }
      })
      .catch((e) => {
        if (alive.current) setError(String(e.message || e));
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
    return () => {
      alive.current = false;
      unsubscribe?.();
      pending.current.clear();
    };
  }, [cwd]);
  async function create(kind: "shell" | "claude") {
    setBusy(true);
    setError("");
    try {
      const session = await window.electronAPI?.terminalCreate?.({ cwd, kind });
      if (session) {
        setSessions((previous) => [...previous, replay(session)]);
        pending.current.delete(session.id);
        setActive(session.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open terminal");
    } finally {
      setBusy(false);
    }
  }
  async function close(session: TerminalSession) {
    try {
      await window.electronAPI?.terminalClose?.(session.id);
      const next = sessions.filter((s) => s.id !== session.id);
      setSessions(next);
      pending.current.delete(session.id);
      if (active === session.id) setActive(next[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close terminal");
    }
  }
  return (
    <section
      className="h-full flex flex-col min-w-0 bg-[#18191c]"
      aria-label="Interactive terminals"
    >
      <div
        className="flex items-center gap-1 p-1 overflow-x-auto shrink-0 border-b border-gray-700"
        role="tablist"
        aria-label="Terminal sessions"
      >
        {sessions.map((session, index) => (
          <div className="flex shrink-0 items-center" key={session.id}>
            <button
              role="tab"
              aria-selected={active === session.id}
              className={`px-3 py-1 rounded ${active === session.id ? "bg-blue-900 text-white" : "text-gray-400"}`}
              onClick={() => setActive(session.id)}
            >
              {session.kind === "claude" ? "Claude" : `Terminal ${index + 1}`}
              {session.exited ? " (exited)" : ""}
            </button>
            <button
              aria-label={`Close ${session.title}`}
              className="px-2"
              onClick={() => close(session)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          disabled={busy}
          className="px-3 py-1 whitespace-nowrap disabled:opacity-50"
          onClick={() => create("shell")}
        >
          + Terminal
        </button>
        {claudeAvailable &&
          !sessions.some((s) => s.kind === "claude" && !s.exited) && (
            <button
              disabled={busy}
              className="px-3 py-1 whitespace-nowrap"
              onClick={() => create("claude")}
            >
              Open Claude
            </button>
          )}
      </div>
      {error && (
        <p role="alert" className="text-red-300 p-2">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="px-2 text-gray-400">
          Opening terminal…
        </p>
      )}
      {!busy && !sessions.length && !error && (
        <p className="p-3 text-gray-400">Open a terminal to begin.</p>
      )}
      <div className="flex-1 min-h-0 min-w-0">
        {sessions.map((session) => (
          <TerminalView
            key={session.id}
            session={session}
            visible={active === session.id}
          />
        ))}
      </div>
    </section>
  );
}
