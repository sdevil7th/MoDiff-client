import { canonicalJsonHash } from './canonical-json.mjs';

const OUTPUT_NODE_KEYS = new Set([
  'modules.Audio.Export',
  'modules.Image.Preview',
  'modules.Primitive.DataViewer',
  'modules.Primitive.ExportData',
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

/** Bind an auxiliary terminal to independently supplied backend source
 * declarations. Manifest metadata alone can never declare an output root. */
export function canonicalAuxiliaryTerminalBinding(workflow, graph, source) {
  const spec = source?.executionSpec;
  if (
    !spec ||
    spec.schemaVersion !== 1 ||
    spec.modelType !== workflow.modelType ||
    spec.mode !== workflow.mode ||
    !Array.isArray(spec.auxiliaryTerminalRoles) ||
    spec.auxiliaryTerminalRoles.length === 0 ||
    !Array.isArray(source.operationContracts)
  )
    throw new Error(`${workflow.id} has no matching authoritative auxiliary-terminal source contract.`);
  const nodes = graph.nodes ?? [],
    edges = graph.edges ?? [];
  const roles = new Map();
  for (const [role, key] of spec.roles) {
    const candidates = nodes.filter((node) => nodeKey(node) === key);
    if (candidates.length !== 1)
      throw new Error(`${workflow.id} auxiliary source role ${role} is missing or ambiguous.`);
    roles.set(role, candidates[0]);
  }
  const owner = nodes.find((node) => nodeKey(node) === `${spec.loaderModule}.${spec.loaderAction}`);
  const ownerClass = owner?.data?.params?.model_type ?? owner?.data?.params?.pipeline_class;
  if (
    ownerClass?.value !== spec.pipelineClass ||
    owner?.data?.operationAuthoring?.operation?.pipelineClass !== spec.pipelineClass
  )
    throw new Error(`${workflow.id} auxiliary workflow changes its declared model owner.`);
  for (const [from, sourceHandle, to, targetHandle] of spec.edges)
    if (
      edges.filter((edge) => edge.target === roles.get(to)?.id && edge.targetHandle === targetHandle).length !== 1 ||
      !edges.some(
        (edge) =>
          edge.source === roles.get(from)?.id &&
          edge.sourceHandle === sourceHandle &&
          edge.target === roles.get(to)?.id &&
          edge.targetHandle === targetHandle,
      )
    )
      throw new Error(`${workflow.id} is missing an authoritative auxiliary-workflow dependency.`);
  const terminals = spec.auxiliaryTerminalRoles.map((role) => {
    const node = roles.get(role),
      key = nodeKey(node);
    const contracts = source.operationContracts.filter(
      (contract) =>
        contract.nodeKey === key &&
        contract.pipelineClass === spec.pipelineClass &&
        contract.task === spec.mode &&
        contract.support === 'declared',
    );
    if (contracts.length !== 1)
      throw new Error(`${workflow.id} auxiliary stage has no unique authoritative operation contract.`);
    const contract = contracts[0],
      actual = node.data?.operationAuthoring?.operation;
    for (const field of [
      'operationId',
      'nodeKey',
      'nodeType',
      'blockName',
      'decomposition',
      'pipelineClass',
      'task',
      'support',
    ])
      if (actual?.[field] !== contract[field])
        throw new Error(`${workflow.id} auxiliary stage differs from its authoritative operation.`);
    const statePort = contract.ports.find(
      (port) =>
        port.direction === 'input' &&
        port.required &&
        port.semantics?.kind === 'state' &&
        port.semantics.owner === 'same_loader',
    );
    const componentPort = contract.ports.find(
      (port) =>
        port.direction === 'input' &&
        port.required &&
        port.semantics?.kind === 'component' &&
        port.semantics.owner === 'same_loader',
    );
    const prefix = `${spec.pipelineClass}:`;
    if (
      !statePort?.semantics.scope?.startsWith(prefix) ||
      componentPort?.semantics.scope !== spec.pipelineClass ||
      contract.decomposition !== 'block'
    )
      throw new Error(`${workflow.id} auxiliary stage has no declared owned SDK state dependency.`);
    const workflowId = statePort.semantics.scope.slice(prefix.length);
    const expected = { pipeline_class: spec.pipelineClass, workflow_id: workflowId, block_path: contract.blockName };
    if (
      actual.workflowId !== workflowId ||
      actual.binding?.pipelineClass !== spec.pipelineClass ||
      owner.data.params?.workflow_id?.value !== workflowId
    )
      throw new Error(`${workflow.id} auxiliary stage changes its SDK workflow context.`);
    for (const [field, value] of Object.entries(expected))
      if (node.data.params?.[field]?.value !== value || actual.binding?.values?.[field] !== value)
        throw new Error(`${workflow.id} auxiliary stage changes a declared SDK binding.`);
    const expectedIncoming = spec.edges
      .filter(([, , target]) => target === role)
      .map(([from, sourceHandle, , targetHandle]) => `${roles.get(from).id}\0${sourceHandle}\0${targetHandle}`)
      .sort();
    const actualIncoming = edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => `${edge.source}\0${edge.sourceHandle}\0${edge.targetHandle}`)
      .sort();
    if (
      canonicalJsonHash(actualIncoming) !== canonicalJsonHash(expectedIncoming) ||
      edges.some((edge) => edge.source === node.id)
    )
      throw new Error(`${workflow.id} auxiliary stage is not its exact declared terminal.`);
    return {
      role,
      nodeId: node.id,
      nodeKey: key,
      operationId: contract.operationId,
      pipelineClass: spec.pipelineClass,
      task: spec.mode,
      workflowId,
      blockName: contract.blockName,
    };
  });
  return { schemaVersion: 1, executionSpecId: spec.id, executionSpecContentHash: spec.contentHash, terminals };
}

export function verifyNoDeadWorkflowNodes(workflow, graph, authoritativeSource) {
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
    throw new Error(`${workflow.id} has no preview, export, or data output node.`);
  }

  let auxiliaryIds = [];
  if (Object.prototype.hasOwnProperty.call(workflow, 'auxiliaryTerminalBinding')) {
    const expected = canonicalAuxiliaryTerminalBinding(workflow, graph, authoritativeSource);
    if (canonicalJsonHash(workflow.auxiliaryTerminalBinding) !== canonicalJsonHash(expected))
      throw new Error(`${workflow.id} auxiliary-terminal metadata differs from its authoritative source binding.`);
    auxiliaryIds = expected.terminals.map((terminal) => terminal.nodeId);
  }
  const used = new Set([...outputNodes.map((node) => node.id), ...auxiliaryIds]);
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
