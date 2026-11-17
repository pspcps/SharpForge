import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import GraphLayoutWorker from "../utils/dependency-layout.worker?worker&inline";
import "@xyflow/react/dist/style.css";
import type { SolutionFile } from "../types/minirider";
import {
  dependencyGraph,
  impactedNodes,
  type DependencyGraph,
} from "../utils/dependencyGraph";
const palette: Record<string, string> = {
  webapi: "#38bdf8",
  console: "#a78bfa",
  classlib: "#2dd4bf",
  test: "#fbbf24",
  package: "#fb923c",
  interface: "#c084fc",
  class: "#2dd4bf",
  struct: "#60a5fa",
  record: "#67e8f9",
  enum: "#facc15",
  method: "#fda4af",
};
const tool =
  "px-3 py-1.5 bg-[#202733] border border-[#354151] text-slate-200 text-xs rounded-md hover:bg-[#293449]";
function layout(
  graph: DependencyGraph,
  positions: Record<string, { x: number; y: number }>,
) {
  return graph.nodes.map((node) => {
    const pos = positions[node.id] || { x: 0, y: 0 };
    return {
      id: node.id,
      position: pos,
      data: {
        label: (
          <div className="text-left">
            <div
              style={{ color: palette[node.kind] || "#94a3b8" }}
              className="text-[10px] uppercase tracking-wider mb-1"
            >
              {node.kind}
            </div>
            <div className="font-semibold truncate max-w-48" title={node.label}>
              {node.label}
            </div>
            <div className="text-slate-400 text-[10px] mt-1 truncate">
              {node.detail}
            </div>
          </div>
        ),
      },
      sourcePosition: "right",
      targetPosition: "left",
      style: {
        width: 230,
        height: 76,
        background: "#171e29",
        color: "#e2e8f0",
        border: "1px solid " + (palette[node.kind] || "#475569"),
        borderRadius: 10,
      },
    } as Node;
  });
}
export function DependencyCanvas({
  solution,
  onNavigate,
}: {
  solution: SolutionFile;
  onNavigate: (file: string, line: number) => void;
}) {
  const [mode, setMode] = useState<"projects" | "packages" | "types" | "calls">(
      "types",
    ),
    [assets, setAssets] = useState<any>(undefined),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [direction, setDirection] = useState<"dependents" | "dependencies">(
      "dependents",
    ),
    [focus, setFocus] = useState(false),
    [error, setError] = useState(""),
    [relayout, setRelayout] = useState(0);
  const [resolved, setResolved] = useState<any>(null),
    [resolving, setResolving] = useState(false);
  const graph = useMemo(() => {
    if (resolved && mode !== "packages") {
      const nodes = resolved.nodes.filter((node: any) =>
        mode === "projects" ? ["webapi","classlib","console","test","project"].includes(node.kind) : mode === "calls"
          ? [
              "method",
              "webapi",
              "classlib",
              "console",
              "test",
              "project",
            ].includes(node.kind)
          : node.kind !== "method",
      );
      const ids = new Set(nodes.map((node: any) => node.id));
      return {
        nodes,
        edges: resolved.edges.filter(
          (edge: any) => ids.has(edge.source) && ids.has(edge.target),
        ),
      } as DependencyGraph;
    }
    return dependencyGraph(solution, mode, assets);
  }, [solution, mode, assets, resolved]);
  const flowRef=useRef<any>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const related = useMemo(
    () =>
      selected
        ? impactedNodes(graph, selected, direction)
        : new Set(graph.nodes.map((node) => node.id)),
    [graph, selected, direction],
  );
  const visible = useMemo(
    () => ({
      nodes: graph.nodes.filter(
        (node) =>
          (!focus || related.has(node.id)) &&
          (!query || node.label.toLowerCase().includes(query.toLowerCase())),
      ),
      edges: graph.edges,
    }),
    [graph, focus, related, query],
  );
  const [layingOut, setLayingOut] = useState(false);
  const layoutSignature = visible.nodes.map((node) => node.id).join("|");
  useEffect(() => {
    const worker = new GraphLayoutWorker();
    let fitTimer:ReturnType<typeof setTimeout>|undefined;
    setLayingOut(true);
    const ids = new Set(visible.nodes.map((node) => node.id));
    const timer = setTimeout(() => {
      worker.terminate();
      setLayingOut(false);
      setError(
        "Graph layout exceeded 10 seconds. Search or focus a smaller portion of the graph.",
      );
    }, 10000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      setLayingOut(false);
      if (event.data.error) setError(event.data.error);
      else { setNodes(layout(visible, event.data.positions)); fitTimer=setTimeout(()=>flowRef.current?.fitView({padding:0.15,maxZoom:1}),80); }
      worker.terminate();
    };
    worker.onerror = () => {
      clearTimeout(timer);
      setLayingOut(false);
      setError("Could not arrange graph");
      worker.terminate();
    };
    worker.postMessage({
      nodes: visible.nodes.map((node) => ({ id: node.id })),
      edges: visible.edges.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
    });
    return () => {
      clearTimeout(timer);
      clearTimeout(fitTimer);
      worker.terminate();
    };
  }, [graph, layoutSignature, relayout]);
  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );
  const chosen = graph.nodes.find((node) => node.id === selected);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      ...edge,
      label: edge.kind,
      animated:
        selected && (edge.source === selected || edge.target === selected)
          ? true
          : false,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#647d9e" },
      style: {
        stroke:
          selected && related.has(edge.source) && related.has(edge.target)
            ? "#38bdf8"
            : "#40536e",
        strokeWidth: 1.5,
      },
      labelStyle: { fill: "#94a3b8", fontSize: 9 },
      labelBgStyle: { fill: "#111722" },
    }));
  function exportGraph() {
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ solution: solution.name, mode, ...graph }, null, 2)],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "cairn-dependency-map.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      className="flex flex-col flex-1 min-h-0 bg-[#111722]"
      aria-label="Interactive dependency explorer"
    >
      <div className="p-4 border-b border-[#2a3546]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">
              Dependency explorer
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {layingOut ? "Arranging graph… · " : ""}
              {graph.nodes.length} nodes · {graph.edges.length} connections ·
              select a node to trace impact
            </p>
          </div>
          <button
            className={tool}
            disabled={resolving}
            onClick={async () => {
              setError("");
              setResolving(true);
              try {
                const result = await window.electronAPI?.advancedInvoke?.(
                  "dependencies",
                  "semantic",
                  {
                    solution: solution.path,
                    projects: solution.projects.map((project) => ({
                      id: project.id,
                      path: project.path,
                      projectType: project.projectType,
                    })),
                  },
                );
                if (!result)
                  throw new Error(
                    "Compiler resolution requires desktop mode and .NET SDK 8+",
                  );
                setResolved(result);
                if (mode === "projects" || mode === "packages")
                  setMode("types");
              } catch (error) {
                setError(String(error));
              } finally {
                setResolving(false);
              }
            }}
          >
            {resolving
              ? "Resolving with Roslyn…"
              : resolved
                ? "Refresh Roslyn graph"
                : "Resolve with Roslyn"}
          </button>
          <button className={tool} onClick={exportGraph}>
            Export graph
          </button>
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {(["projects", "packages", "types", "calls"] as const).map(
            (value) => (
              <button
                key={value}
                aria-pressed={mode === value}
                className={
                  tool + (mode === value ? " border-sky-400 text-sky-200" : "")
                }
                onClick={() => {
                  setMode(value);
                  setSelected("");
                }}
              >
                {value === "calls"
                  ? "Method calls"
                  : value === "types"
                    ? "Types & interfaces"
                    : value === "packages"
                      ? "Packages & transitive"
                      : "Projects"}
              </button>
            ),
          )}
          <input
            aria-label="Search dependency map"
            className={tool + " flex-1 min-w-36"}
            placeholder="Search nodes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className={tool}
            onClick={() => setRelayout((value) => value + 1)}
          >
            Auto-layout
          </button>
          {mode === "packages" && (
            <button
              className={tool}
              onClick={async () => {
                try {
                  const result = await window.electronAPI?.advancedInvoke?.(
                    "dependencies",
                    "assets",
                    {
                      projects: solution.projects.map((p) => ({
                        id: p.id,
                        path: p.path,
                      })),
                    },
                  );
                  if (!result)
                    throw new Error(
                      "Use desktop mode to load project.assets.json",
                    );
                  setAssets(result);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Load restored dependencies
            </button>
          )}
        </div>
        {mode === "packages" && assets?.missing?.length > 0 && (
          <p className="text-amber-200 text-xs mt-2">
            {assets.missing.length} project assets files were unavailable.
            Restore those projects to include their resolved dependencies.
          </p>
        )}
        {resolved && (
          <details className="text-xs text-slate-400 mt-2">
            <summary>
              Roslyn resolved · {resolved.diagnostics.length} compiler errors ·{" "}
              {resolved.loadDiagnostics.length} load diagnostics
            </summary>
            <pre className="whitespace-pre-wrap">
              {JSON.stringify(
                [...resolved.loadDiagnostics, ...resolved.diagnostics],
                null,
                2,
              )}
            </pre>
            <p>{resolved.scope}</p>
          </details>
        )}
        {error && (
          <p role="alert" className="text-red-300 text-xs mt-2">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 relative" style={{ minHeight: 380 }}>
          <ReactFlow
            onInit={instance=>{flowRef.current=instance;}}
            key={mode + relayout}
            nodes={nodes.map((node) => ({
              ...node,
              selected: node.id === selected,
              style: {
                ...node.style,
                opacity: selected && !related.has(node.id) ? 0.3 : 1,
              },
            }))}
            edges={edges}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => setSelected(node.id)}
            onPaneClick={() => setSelected("")}
            fitView
            onlyRenderVisibleElements
            minZoom={0.05}
            maxZoom={2}
            colorMode="dark"
            proOptions={{ hideAttribution: false }}
          >
            <Background color="#263247" gap={22} />
            <Controls />
            <MiniMap
              nodeColor={(node) =>
                palette[
                  graph.nodes.find((item) => item.id === node.id)?.kind || ""
                ] || "#64748b"
              }
              pannable
              zoomable
              style={{ background: "#151d2a", border: "1px solid #2a3546" }}
            />
          </ReactFlow>
        </div>
        <aside className="w-64 shrink-0 border-l border-[#2a3546] p-4 overflow-auto text-xs">
          <h4 className="text-slate-400 uppercase tracking-wider text-[10px] mb-3">
            Inspector
          </h4>
          {chosen ? (
            <>
              <strong className="text-base break-all text-slate-100">
                {chosen.label}
              </strong>
              <p className="text-slate-400 my-2">
                {chosen.kind} · {chosen.detail}
              </p>
              {chosen.file && (
                <button
                  className={tool + " w-full"}
                  onClick={() => onNavigate(chosen.file!, chosen.line || 1)}
                >
                  Open source
                </button>
              )}
              <select
                aria-label="Impact direction"
                className={tool + " w-full mt-3"}
                value={direction}
                onChange={(e) =>
                  setDirection(e.target.value as typeof direction)
                }
              >
                <option value="dependents">What depends on this?</option>
                <option value="dependencies">What does this depend on?</option>
              </select>
              <label className="block my-3">
                <input
                  type="checkbox"
                  checked={focus}
                  onChange={(e) => setFocus(e.target.checked)}
                />
                Focus related nodes
              </label>
              <p className="text-sky-300 mb-3">
                {related.size - 1} transitively related nodes
              </p>
              {graph.edges
                .filter(
                  (edge) =>
                    edge.source === selected || edge.target === selected,
                )
                .map((edge) => (
                  <button
                    className="block text-left py-2 border-t border-[#293447] w-full break-all"
                    key={edge.id}
                    onClick={() =>
                      setSelected(
                        edge.source === selected ? edge.target : edge.source,
                      )
                    }
                  >
                    <span className="text-slate-500">{edge.kind}</span>
                    <br />
                    {edge.source === selected ? "→" : "←"}{" "}
                    {
                      graph.nodes.find(
                        (node) =>
                          node.id ===
                          (edge.source === selected
                            ? edge.target
                            : edge.source),
                      )?.label
                    }
                  </button>
                ))}
            </>
          ) : (
            <>
              <p className="text-slate-300 leading-relaxed">
                Click a node to inspect references and follow dependencies in
                either direction.
              </p>
              <div className="mt-5 space-y-2">
                {Object.entries(palette).map(([kind, color]) => (
                  <div key={kind}>
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2"
                      style={{ background: color }}
                    />
                    {kind}
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
      <footer className="text-[10px] text-slate-500 px-4 py-2 border-t border-[#293447]">
        {resolved && mode !== 'packages' ? resolved.scope : 'Project references use the loaded model. Transitive packages come from restored assets. Type links are parsed inheritance/signatures; method links are unique-name candidates. Use Resolve with Roslyn for compiler binding.'}
      </footer>
    </section>
  );
}
