import dagre from "@dagrejs/dagre";
self.onmessage = (
  event: MessageEvent<{
    nodes: { id: string }[];
    edges: { source: string; target: string }[];
  }>,
) => {
  try {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: "LR", nodesep: 35, ranksep: 110 });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const node of event.data.nodes)
      graph.setNode(node.id, { width: 230, height: 76 });
    for (const edge of event.data.edges)
      graph.setEdge(edge.source, edge.target);
    dagre.layout(graph);
    self.postMessage({
      positions: Object.fromEntries(
        event.data.nodes.map((node) => [
          node.id,
          { x: graph.node(node.id).x - 115, y: graph.node(node.id).y - 38 },
        ]),
      ),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Layout failed",
    });
  }
};
