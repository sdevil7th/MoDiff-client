const OUTPUT_NODE_KEYS = new Set([
  'modules.Audio.Export',
  'modules.Image.Preview',
  'modules.Primitive.DataViewer',
  'modules.Video.Export',
  'modules.Video.ExportWithAudio',
]);

function nodeKey(node) {
  return `${node?.data?.module}.${node?.data?.action}`;
}

function intentionalDisabledManagedFallbackNodeIds(graph) {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const roleNodes = new Map();
  const duplicateRoles = new Set();
  for (const node of nodes) {
    const role = node?.data?.studioRole;
    if (typeof role !== 'string') continue;
    if (roleNodes.has(role)) duplicateRoles.add(role);
    roleNodes.set(role, node);
  }

  const soundtrackRoles = {
    soundtrackQuantization: 'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
    soundtrackRecipe: 'modules.DiffusersRuntime.DiffusersExecutionRecipe',
    soundtrackPipeline: 'modules.DiffusersAudio.LoadPipeline',
    soundtrackGenerate: 'modules.DiffusersAudio.Generate',
    soundtrackAudioFit: 'modules.Audio.FitDuration',
    exportWithAudio: 'modules.Video.ExportWithAudio',
  };
  if (
    Object.entries(soundtrackRoles).some(
      ([role, key]) =>
        duplicateRoles.has(role) ||
        nodeKey(roleNodes.get(role)) !== key ||
        roleNodes.get(role)?.data?.studioOwned !== true ||
        roleNodes.get(role)?.data?.uiState?.disabled === true,
    )
  ) {
    return new Set();
  }

  const fallback = roleNodes.get('videoExport');
  if (
    duplicateRoles.has('videoExport') ||
    nodeKey(fallback) !== 'modules.Video.Export' ||
    fallback?.data?.studioOwned !== true ||
    fallback?.data?.uiState?.disabled !== true ||
    edges.some((edge) => edge.source === fallback.id || edge.target === fallback.id)
  ) {
    return new Set();
  }

  const ids = Object.fromEntries(Object.keys(soundtrackRoles).map((role) => [role, roleNodes.get(role).id]));
  const hasEdge = (sourceRole, sourceHandle, targetRole, targetHandle) =>
    edges.some(
      (edge) =>
        edge.source === ids[sourceRole] &&
        edge.sourceHandle === sourceHandle &&
        edge.target === ids[targetRole] &&
        edge.targetHandle === targetHandle,
    );
  const exactSoundtrackRoute =
    hasEdge('soundtrackQuantization', 'quantization_config', 'soundtrackRecipe', 'quantization_config') &&
    hasEdge('soundtrackRecipe', 'execution_recipe', 'soundtrackPipeline', 'execution_recipe') &&
    hasEdge('soundtrackPipeline', 'pipeline', 'soundtrackGenerate', 'pipeline') &&
    hasEdge('soundtrackGenerate', 'audio', 'soundtrackAudioFit', 'audio') &&
    hasEdge('soundtrackAudioFit', 'output', 'exportWithAudio', 'audio');
  const exporterEdges = edges.filter((edge) => edge.target === ids.exportWithAudio);
  const videoEdge = exporterEdges.find((edge) => edge.targetHandle === 'video');
  const videoSource = nodes.find((node) => node.id === videoEdge?.source);
  const allowedVideoSources = {
    wanGenerate: { key: 'modules.DiffusersVideo.Generate', handles: ['video_out'] },
    videoCompose: { key: 'modules.Video.Compose', handles: ['video'] },
    upscaler: { key: 'modules.Spandrel.Upscaler', handles: ['output', 'image'] },
  };
  const videoSourceContract = allowedVideoSources[videoSource?.data?.studioRole];
  if (
    !exactSoundtrackRoute ||
    exporterEdges.length !== 2 ||
    !videoSource ||
    !videoSourceContract ||
    nodeKey(videoSource) !== videoSourceContract.key ||
    !videoSourceContract.handles.includes(videoEdge?.sourceHandle) ||
    videoSource.data?.studioOwned !== true ||
    videoSource.data?.uiState?.disabled === true ||
    edges.some((edge) => edge.source === ids.exportWithAudio)
  ) {
    return new Set();
  }
  return new Set([fallback.id]);
}

export function verifyNoDeadWorkflowNodes(workflow, graph) {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const incident = new Set();
  for (const edge of edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    incoming.get(edge.target)?.push(edge.source);
    incident.add(edge.source);
    incident.add(edge.target);
  }

  const intentionalFallbacks = intentionalDisabledManagedFallbackNodeIds(graph);
  const outputNodes = nodes.filter((node) => OUTPUT_NODE_KEYS.has(nodeKey(node)) && !intentionalFallbacks.has(node.id));
  if (outputNodes.length === 0) {
    throw new Error(`${workflow.id} has no preview, export, or data-viewer output node.`);
  }

  const used = new Set(outputNodes.map((node) => node.id));
  const pending = [...used];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    for (const sourceId of incoming.get(nodeId) ?? []) {
      if (used.has(sourceId)) continue;
      used.add(sourceId);
      pending.push(sourceId);
    }
  }

  const disabled = nodes.filter((node) => node?.data?.uiState?.disabled === true && !intentionalFallbacks.has(node.id));
  if (disabled.length > 0) {
    throw new Error(
      `${workflow.id} contains disabled nodes that cannot contribute to execution: ${disabled
        .map((node) => node.id)
        .join(', ')}.`,
    );
  }
  const isolated = nodes.filter((node) => !intentionalFallbacks.has(node.id) && !incident.has(node.id));
  if (isolated.length > 0) {
    throw new Error(`${workflow.id} contains isolated nodes: ${isolated.map((node) => node.id).join(', ')}.`);
  }
  const unreachable = nodes.filter((node) => !intentionalFallbacks.has(node.id) && !used.has(node.id));
  if (unreachable.length > 0) {
    throw new Error(
      `${workflow.id} contains nodes outside every output dependency path: ${unreachable
        .map((node) => node.id)
        .join(', ')}.`,
    );
  }
}
