import React, { useEffect, useRef, useState } from "react";
import RegexWorker from "../utils/regex.worker?worker&inline";
const field = "bg-gray-900 border border-gray-600 p-2 rounded",
  button = "bg-gray-700 rounded p-2 disabled:opacity-50";
export function UtilitiesExtras() {
  const [pattern, setPattern] = useState("\\b\\w+\\b"),
    [flags, setFlags] = useState("g"),
    [text, setText] = useState("Hello Cairn"),
    [pem, setPem] = useState(""),
    [port, setPort] = useState(5000),
    [output, setOutput] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      worker.current?.terminate();
      clearTimeout(timer.current);
    },
    [],
  );
  function regex() {
    worker.current?.terminate();
    clearTimeout(timer.current);
    setBusy(true);
    setError("");
    const current = new RegexWorker();
    worker.current = current;
    const finish = () => {
      current.terminate();
      clearTimeout(timer.current);
      setBusy(false);
    };
    timer.current = setTimeout(() => {
      finish();
      setError(
        "Regex exceeded 500 ms and was terminated. Simplify the pattern.",
      );
    }, 500);
    current.onmessage = (event) => {
      finish();
      if (event.data.error) setError(event.data.error);
      else setOutput(JSON.stringify(event.data.matches, null, 2));
    };
    current.onerror = () => {
      finish();
      setError("Regex worker failed");
    };
    current.postMessage({ pattern, flags, text });
  }
  async function run(action: string) {
    setBusy(true);
    setError("");
    try {
      let result;
      if (action === "port") {
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new Error("Choose a port from 1 to 65535");
        result = await window.electronAPI?.portsCheck?.(port);
      } else if (action === "ports")
        result = await window.electronAPI?.portsList?.();
      else
        result = await window.electronAPI?.advancedInvoke?.("system", action, {
          pem,
        });
      if (result === undefined)
        throw new Error("Use the desktop app for system inspection");
      setOutput(JSON.stringify(result, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="border-t border-gray-600 pt-4 space-y-3"
      aria-label="Additional developer utilities"
    >
      <h4>Regex tester</h4>
      <p>
        JavaScript regex syntax. Matching runs in a disposable worker with a 500
        ms limit.
      </p>
      <input
        aria-label="Regex pattern"
        className={field}
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
      />
      <input
        aria-label="Regex flags"
        className={field}
        value={flags}
        onChange={(e) => setFlags(e.target.value)}
      />
      <textarea
        aria-label="Regex text"
        className={field + " w-full h-24"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className={button} disabled={busy} onClick={regex}>
        Test regular expression
      </button>
      <details>
        <summary>Certificate inspector (PEM)</summary>
        <p>
          Displays certificate metadata; it does not certify trust or revocation
          status.
        </p>
        <textarea
          aria-label="Certificate PEM"
          className={field + " w-full h-28"}
          value={pem}
          onChange={(e) => setPem(e.target.value)}
        />
        <button
          className={button}
          disabled={busy}
          onClick={() => run("certificate")}
        >
          Inspect certificate
        </button>
      </details>
      <div className="flex gap-2 flex-wrap">
        <input
          aria-label="Port number"
          className={field}
          type="number"
          min="1"
          max="65535"
          value={port}
          onChange={(e) => setPort(Number(e.target.value))}
        />
        <button className={button} disabled={busy} onClick={() => run("port")}>
          Check port
        </button>
        <button className={button} disabled={busy} onClick={() => run("ports")}>
          List listeners
        </button>
        <button
          className={button}
          disabled={busy}
          onClick={() => run("processes")}
        >
          Explore processes
        </button>
        <button className={button} disabled={busy} onClick={() => run("sizes")}>
          Analyze folder sizes
        </button>
      </div>
      {error && (
        <p className="text-red-300" role="alert">
          {error}
        </p>
      )}
      <pre className="whitespace-pre-wrap break-all max-h-96 overflow-auto">
        {output}
      </pre>
    </section>
  );
}
