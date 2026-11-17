import { apiAssertions } from "../utils/apiAssertions";
import React, { useEffect, useRef, useState } from "react";
import { ReadOnlyDiff } from "./ReadOnlyDiff";
const field = "bg-[#16191e] border border-gray-600 rounded p-2 min-w-0";
const button =
  "bg-[#343c49] hover:bg-[#46536a] disabled:opacity-50 rounded px-3 py-2";
interface RequestSpec {
  name: string;
  mode: string;
  method: string;
  url: string;
  headers: string;
  body: string;
  query: string;
  graphqlVariables: string;
  proto: string;
  service: string;
  grpcMethod: string;
  target: string;
  tls: boolean;
  tokenName: string;
  expected: number;
  maxMs: number;
  collection?: string;
  assertionPath?: string;
  assertionValue?: string;
}
const initial: RequestSpec = {
  name: "New request",
  collection: "Default",
  assertionPath: "",
  assertionValue: "",
  mode: "rest",
  method: "GET",
  url: "http://localhost:5000/",
  headers: "{}",
  body: "{}",
  query: "query { __typename }",
  graphqlVariables: "{}",
  proto:
    'syntax = "proto3";\npackage demo;\nservice Greeter { rpc Hello (Message) returns (Message); }\nmessage Message { string text = 1; }',
  service: "demo.Greeter",
  grpcMethod: "Hello",
  target: "localhost:5001",
  tls: true,
  tokenName: "",
  expected: 200,
  maxMs: 5000,
};
function JsonTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth === 0);
  if (depth > 12)
    return (
      <span className="text-slate-400">
        [Expand via raw response comparison for deeper data]
      </span>
    );
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return (
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          {Array.isArray(value)
            ? `Array (${entries.length})`
            : `Object (${entries.length})`}
        </summary>
        {open && (
          <div className="pl-4 border-l border-gray-600">
            {entries.slice(0, 100).map(([key, item]) => (
              <div key={key}>
                <strong>{key}: </strong>
                <JsonTree value={item} depth={depth + 1} />
              </div>
            ))}
            {entries.length > 100 && (
              <p className="text-slate-400">Showing the first 100 entries.</p>
            )}
          </div>
        )}
      </details>
    );
  }
  return (
    <span className="text-teal-200 break-all">{JSON.stringify(value)}</span>
  );
}

export function ApiClient({ workspace }: { workspace: string }) {
  const key = "sharpforge.api.collections.v1:" + workspace;
  const [request, setRequest] = useState<RequestSpec>(initial),
    [collections, setCollections] = useState<RequestSpec[]>(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(stored)
          ? stored
              .filter(
                (item) =>
                  item &&
                  typeof item.name === "string" &&
                  typeof item.url === "string",
              )
              .map((item) => ({ ...initial, ...item }))
          : [];
      } catch {
        return [];
      }
    });
  const [environment, setEnvironment] = useState("{}"),
    [environmentName, setEnvironmentName] = useState("Local"),
    [environments, setEnvironments] = useState<Record<string, string>>({
      Local: "{}",
    });
  const [response, setResponse] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]),
    [comparison, setComparison] = useState(-1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tokens, setTokens] = useState<string[]>([]),
    [tokenName, setTokenName] = useState(""),
    [tokenValue, setTokenValue] = useState(""),
    [events, setEvents] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [results, setResults] = useState<any[]>([]);
  const activeId = useRef(""),
    wsId = useRef("");
  const running = useRef(false);
  const invoke = async (
    action: string,
    options: Record<string, unknown> = {},
  ) => {
    if (!window.electronAPI?.advancedInvoke)
      throw new Error("Use the desktop app for API requests");
    return window.electronAPI.advancedInvoke("api", action, options);
  };
  const update = (name: keyof RequestSpec, value: unknown) =>
    setRequest((previous) => ({ ...previous, [name]: value }));
  useEffect(() => {
    invoke("token-list")
      .then(setTokens)
      .catch(() => {});
    const off = window.electronAPI?.onAdvancedEvent?.("api:event", (event) => {
      if (event.id === wsId.current)
        setEvents((previous) => [...previous, event].slice(-500));
    });
    return () => {
      off?.();
      if (wsId.current) void invoke("ws-close", { id: wsId.current });
      if (activeId.current) void invoke("cancel", { id: activeId.current });
      running.current = false;
    };
  }, []);
  async function send(spec = request) {
    const id = crypto.randomUUID();
    activeId.current = id;
    const variables = JSON.parse(environment);
    if (!variables || typeof variables !== "object" || Array.isArray(variables))
      throw new Error("Environment must be a JSON object");
    const options = {
      ...spec,
      id,
      variables,
      headers: JSON.parse(spec.headers),
      method: spec.mode === "grpc" ? spec.grpcMethod : spec.method,
    };
    const result = await invoke(
      spec.mode === "grpc" ? "grpc" : "http",
      options,
    );
    setResponse(result);
    setHistory((previous) =>
      [
        {
          ...result,
          request: spec,
          name: spec.name,
          method: spec.method,
          url: spec.url,
          time: new Date().toISOString(),
        },
        ...previous,
      ].slice(0, 30),
    );
    return result;
  }
  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      activeId.current = "";
    }
  }
  function saveCollection() {
    try {
      const headers = JSON.parse(request.headers);
      for (const name of Object.keys(headers))
        if (/authorization|cookie|api.?key|token/i.test(name))
          headers[name] = "";
      const next = [
        ...collections.filter(
          (item) =>
            item.name !== request.name ||
            (item.collection || "Default") !==
              (request.collection || "Default"),
        ),
        { ...request, headers: JSON.stringify(headers, null, 2) },
      ];
      localStorage.setItem(key, JSON.stringify(next));
      setCollections(next);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section
      className="p-4 overflow-auto flex-1 min-h-0 space-y-3"
      aria-label="API testing client"
    >
      <h3 className="text-xl">API testing client</h3>
      <p className="text-gray-400">
        Requests execute only when sent. Redirects are shown, not followed.
        Collections are local; use environment placeholders and the encrypted
        token vault for credentials.
      </p>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Request name"
          className={field}
          value={request.name}
          onChange={(e) => update("name", e.target.value)}
        />
        <select
          aria-label="API protocol"
          className={field}
          value={request.mode}
          onChange={(e) => update("mode", e.target.value)}
        >
          {["rest", "graphql", "grpc", "websocket"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="HTTP method"
          className={field}
          value={request.method}
          onChange={(e) => update("method", e.target.value)}
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
        <input
          aria-label="Request URL"
          className={field + " flex-1"}
          value={request.url}
          onChange={(e) => update("url", e.target.value)}
        />
      </div>
      <details>
        <summary>Environment variables (session only)</summary>
        <div className="flex gap-2">
          <input
            aria-label="Environment name"
            className={field}
            value={environmentName}
            onChange={(e) => setEnvironmentName(e.target.value)}
          />
          <button
            className={button}
            onClick={() => {
              try {
                JSON.parse(environment);
                setEnvironments((previous) => ({
                  ...previous,
                  [environmentName]: environment,
                }));
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Save session environment
          </button>
          <select
            className={field}
            aria-label="Select environment"
            value={environmentName}
            onChange={(e) => {
              setEnvironmentName(e.target.value);
              setEnvironment(environments[e.target.value]);
            }}
          >
            {Object.keys(environments).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <textarea
          aria-label="Environment JSON"
          className={field + " w-full h-28"}
          value={environment}
          onChange={(e) => setEnvironment(e.target.value)}
        />
        <p>
          Use {"{{variable}}"} in URLs, headers, query and body. Environment
          values are not persisted.
        </p>
      </details>
      <div className="grid md:grid-cols-2 gap-3">
        <label>
          Headers (JSON)
          <textarea
            aria-label="Request headers"
            className={field + " w-full h-28 font-mono"}
            value={request.headers}
            onChange={(e) => update("headers", e.target.value)}
          />
        </label>
        <label>
          Body / gRPC message (JSON)
          <textarea
            aria-label="Request body"
            className={field + " w-full h-28 font-mono"}
            value={request.body}
            onChange={(e) => update("body", e.target.value)}
          />
        </label>
      </div>
      {request.mode === "graphql" && (
        <>
          <textarea
            aria-label="GraphQL query"
            className={field + " w-full h-28"}
            value={request.query}
            onChange={(e) => update("query", e.target.value)}
          />
          <textarea
            aria-label="GraphQL variables"
            className={field + " w-full h-20"}
            value={request.graphqlVariables}
            onChange={(e) => update("graphqlVariables", e.target.value)}
          />
        </>
      )}
      {request.mode === "grpc" && (
        <>
          <textarea
            aria-label="Proto definition"
            className={field + " w-full h-40 font-mono"}
            value={request.proto}
            onChange={(e) => update("proto", e.target.value)}
          />
          <div className="flex gap-2">
            <input
              aria-label="gRPC target"
              className={field}
              value={request.target}
              onChange={(e) => update("target", e.target.value)}
            />
            <input
              aria-label="gRPC service"
              className={field}
              value={request.service}
              onChange={(e) => update("service", e.target.value)}
            />
            <input
              aria-label="gRPC method"
              className={field}
              value={request.grpcMethod}
              onChange={(e) => update("grpcMethod", e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={request.tls}
                onChange={(e) => update("tls", e.target.checked)}
              />
              TLS
            </label>
          </div>
          <p>
            Provide a self-contained .proto definition. For client streaming,
            body is a JSON array of messages.
          </p>
        </>
      )}
      <label>
        Authentication{" "}
        <select
          className={field}
          value={request.tokenName}
          onChange={(e) => update("tokenName", e.target.value)}
        >
          <option value="">No vault token</option>
          {tokens.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <details>
        <summary>Encrypted authentication token manager</summary>
        <input
          aria-label="Token name"
          className={field}
          value={tokenName}
          onChange={(e) => setTokenName(e.target.value)}
        />
        <input
          aria-label="Token value"
          type="password"
          className={field}
          value={tokenValue}
          onChange={(e) => setTokenValue(e.target.value)}
        />
        <button
          className={button}
          onClick={() =>
            run(async () => {
              await invoke("token-save", {
                name: tokenName,
                value: tokenValue,
              });
              setTokenValue("");
              setTokens(await invoke("token-list"));
            })
          }
        >
          Store token securely
        </button>
        <button
          className={button}
          onClick={() =>
            run(async () => {
              await invoke("token-delete", { name: tokenName });
              setTokens(await invoke("token-list"));
            })
          }
        >
          Delete named token
        </button>
      </details>
      <div className="flex gap-2 flex-wrap">
        {request.mode === "websocket" ? (
          <>
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (wsId.current)
                    await invoke("ws-close", { id: wsId.current });
                  wsId.current = crypto.randomUUID();
                  await invoke("ws-open", {
                    id: wsId.current,
                    url: request.url,
                    variables: JSON.parse(environment),
                    tokenName: request.tokenName,
                  });
                })
              }
            >
              Connect WebSocket
            </button>
            <input
              aria-label="WebSocket message"
              className={field}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button
              className={button}
              onClick={() =>
                run(() => invoke("ws-send", { id: wsId.current, message }))
              }
            >
              Send message
            </button>
            <button
              className={button}
              onClick={() =>
                run(() => invoke("ws-close", { id: wsId.current }))
              }
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            className={button}
            disabled={busy}
            onClick={() => run(() => send())}
          >
            {busy ? "Sending…" : "Send request"}
          </button>
        )}
        <button
          className={button}
          onClick={() => {
            running.current = false;
            void invoke("cancel", { id: activeId.current });
          }}
        >
          Cancel
        </button>
        <button className={button} onClick={saveCollection}>
          Save to collection
        </button>
      </div>
      <details>
        <summary>
          Request collections and API test runner ({collections.length})
        </summary>
        <p>
          Saved headers with recognized authentication names are cleared; review
          URLs and bodies before saving.
        </p>
        <label>
          Collection name{" "}
          <input
            aria-label="Collection name"
            className={field}
            value={request.collection || "Default"}
            onChange={(e) => update("collection", e.target.value)}
          />
        </label>
        <label>
          Expected HTTP status{" "}
          <input
            aria-label="Expected status"
            type="number"
            className={field}
            value={request.expected}
            onChange={(e) => update("expected", Number(e.target.value))}
          />
        </label>
        <label>
          Maximum response time (ms)
          <input
            type="number"
            className={field}
            value={request.maxMs}
            onChange={(e) => update("maxMs", Number(e.target.value))}
          />
        </label>
        <label className="block">
          JSON pointer assertion{" "}
          <input
            aria-label="Assertion JSON pointer"
            className={field}
            placeholder="/data/id"
            value={request.assertionPath || ""}
            onChange={(e) => update("assertionPath", e.target.value)}
          />
          <input
            aria-label="Assertion expected JSON"
            className={field}
            placeholder="Expected JSON value"
            value={request.assertionValue || ""}
            onChange={(e) => update("assertionValue", e.target.value)}
          />
        </label>
        {collections.map((item, index) => (
          <div className="flex gap-2 p-2" key={index}>
            <button className={button} onClick={() => setRequest(item)}>
              {item.collection || "Default"} / {item.name}
            </button>
            <span>
              {item.method} {item.url}
            </span>
            <button
              onClick={() => {
                const next = collections.filter((_, i) => i !== index);
                setCollections(next);
                localStorage.setItem(key, JSON.stringify(next));
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            run(async () => {
              running.current = true;
              const next = [];
              for (const item of collections) {
                if (!running.current) break;
                if (
                  item.mode === "websocket" ||
                  (item.collection || "Default") !==
                    (request.collection || "Default")
                )
                  continue;
                try {
                  const result = await send(item);
                  next.push({
                    name: item.name,
                    ...apiAssertions(item, result),
                    status: result.status,
                    durationMs: result.durationMs,
                  });
                } catch (e) {
                  next.push({
                    name: item.name,
                    passed: false,
                    error: String(e),
                  });
                }
                setResults([...next]);
              }
              running.current = false;
            })
          }
        >
          Run selected collection tests
        </button>
        <pre>{JSON.stringify(results, null, 2)}</pre>
      </details>
      {history.length > 1 && (
        <div className="grid grid-cols-4 gap-2 text-xs border border-slate-600 rounded p-3">
          {(() => {
            const values = history
              .map((item) => Number(item.durationMs))
              .sort((a, b) => a - b);
            return [
              ["Minimum", values[0]],
              ["Median", values[Math.floor(values.length / 2)]],
              [
                "p95",
                values[
                  Math.min(
                    values.length - 1,
                    Math.ceil(values.length * 0.95) - 1,
                  )
                ],
              ],
              ["Maximum", values[values.length - 1]],
            ].map(([label, value]) => (
              <p key={label}>
                {" "}
                {label}
                <strong className="block text-sky-200">
                  {Number(value).toFixed(2)} ms
                </strong>
              </p>
            ));
          })()}
        </div>
      )}
      {response && (
        <article className="border border-gray-600 rounded p-3">
          <h4>
            Response {response.status} ·{" "}
            {Number(response.durationMs).toFixed(2)} ms ·{" "}
            {response.bytes ?? "—"} bytes
          </h4>
          <details>
            <summary>Headers</summary>
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(response.headers, null, 2)}
            </pre>
          </details>
          <details open>
            <summary>JSON visualizer / raw response</summary>
            {response.json !== undefined ? (
              <JsonTree value={response.json} />
            ) : (
              <pre className="whitespace-pre-wrap break-all">
                {response.body}
              </pre>
            )}
          </details>
        </article>
      )}
      <details>
        <summary>
          Request history and response comparison ({history.length}, session
          only)
        </summary>
        {history.map((item, index) => (
          <button
            className={button + " m-1"}
            key={index}
            onClick={() => {
              setComparison(index);
              setRequest(item.request || initial);
            }}
          >
            {item.time} {item.name} · {Number(item.durationMs).toFixed(1)} ms
          </button>
        ))}
        {response && history[comparison] && (
          <div className="h-96">
            <ReadOnlyDiff
              original={history[comparison].body}
              modified={response.body}
            />
          </div>
        )}
      </details>
      {events.length > 0 && (
        <pre className="whitespace-pre-wrap break-all">
          {events
            .map((event) => `${event.time} ${event.kind}: ${event.data}`)
            .join("\n")}
        </pre>
      )}
    </section>
  );
}
