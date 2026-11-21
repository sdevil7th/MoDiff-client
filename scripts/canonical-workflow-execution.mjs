/** Use Run's shared Block compiler, including effective-graph and boundary
 * validation. Persisted graph bytes remain the canonical identity authority. */
export async function loadCanonicalWorkflowExpander(moduleServer) {
  const { expandBlockGraphV2ForExecution } = await moduleServer.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  return (graph) => expandBlockGraphV2ForExecution(graph.nodes ?? [], graph.edges ?? []);
}

export function canonicalExecutableWorkflowGraph(graph, expandBlocks) {
  if (typeof expandBlocks !== 'function') throw new Error('Canonical export requires the shared Block compiler.');
  const snapshot = structuredClone(graph);
  const executable = expandBlocks(snapshot);
  const containers = new Set(executable.nodes.filter((node) => node.data.type === 'group').map((node) => node.id));
  for (const node of executable.nodes) {
    if (containers.has(node.id) && node.data.uiState?.disabled)
      throw new Error('Canonical export cannot flatten a disabled container.');
  }
  if (executable.edges.some((edge) => containers.has(edge.source) || containers.has(edge.target)))
    throw new Error('Canonical export contains an unresolved container boundary.');
  executable.nodes = executable.nodes.filter((node) => !containers.has(node.id));
  // These are compilation receipts for the removed canvas owner, not backend
  // controls. A portable leaf graph must not claim a now-absent Block root.
  for (const node of executable.nodes) {
    if (containers.has(node.parentId)) delete node.parentId;
    for (const key of Object.keys(node.data)) if (key.startsWith('blockProjection')) delete node.data[key];
    for (const field of Object.values(node.data.params ?? {})) {
      if (field.fieldOptions) delete field.fieldOptions.blockBindingV2;
    }
  }
  for (const edge of executable.edges) {
    for (const key of Object.keys(edge.data ?? {})) if (key.startsWith('blockProjection')) delete edge.data[key];
  }
  return { ...snapshot, ...executable };
}
