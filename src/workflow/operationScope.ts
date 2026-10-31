import type { CustomNodeType } from '../stores/useFlowStore';
import type { OperationGraph } from './operationAuthoring';
import { operationAuthoring } from './operationAuthoringHint';
import { operationOwnsModel } from './operationContracts';
import { declaredImagePipelineStageContracts } from './imagePipelineStageContracts';

/** Structural recognition only; adapter editing still requires current authority. */
export function declaredImagePipelineStageTail(
  graph: OperationGraph,
  ownerId: string,
  edges: OperationGraph['edges'],
): CustomNodeType[] | null {
  const ids = declaredImagePipelineStageContracts(
    graph.nodes.map((node) => ({
      id: node.id,
      params: node.data.params,
      operation:
        node.id === ownerId || (!node.parentId && !node.data.blockInstanceV2 && !node.data.blockProjectionOwnerId)
          ? operationAuthoring(node)?.operation
          : undefined,
    })),
    ownerId,
    graph.edges,
    edges,
  );
  return ids?.map((id) => graph.nodes.find((node) => node.id === id)!) ?? null;
}

export function operationScope(graph: OperationGraph, loaderId: string): CustomNodeType[] {
  const root = graph.nodes.find((n) => n.id === loaderId);
  const hint = root && operationAuthoring(root);
  if (
    !root ||
    !hint ||
    !operationOwnsModel(hint.operation) ||
    root.parentId ||
    root.data.blockInstanceV2 ||
    root.data.blockProjectionOwnerId
  )
    throw new Error('Choose a top-level operation loader. Use the existing Block inspector for nested Blocks.');
  const candidates = new Map(
    graph.nodes
      .filter((n) => {
        const h = operationAuthoring(n);
        return (
          h &&
          !n.parentId &&
          !n.data.blockInstanceV2 &&
          !n.data.blockProjectionOwnerId &&
          h.operation.pipelineClass === hint.operation.pipelineClass &&
          h.operation.task === hint.operation.task &&
          (!operationOwnsModel(h.operation) || n.id === loaderId)
        );
      })
      .map((n) => [n.id, n]),
  );
  const ids = new Set([loaderId]);
  // The reviewed image adapter transports the same owner's pipeline; it is
  // not an operation stage. Follow its actual sockets to the declared stages.
  const pipelineType =
    root.data.params.pipeline?.type === 'audio_diffusion_pipeline'
      ? 'audio_diffusion_pipeline'
      : 'image_diffusion_pipeline';
  const pipelineSocket = (id: string, handle: string | null | undefined, direction: 'input' | 'output') => {
    const field = graph.nodes.find((node) => node.id === id)?.data.params[handle ?? ''];
    return field?.type === pipelineType && (field.display === direction || (direction === 'input' && field.isInput));
  };
  const bridges = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.data.module ===
            (pipelineType === 'audio_diffusion_pipeline' ? 'modules.DiffusersAudio' : 'modules.DiffusersImage') &&
          node.data.action === 'LoadAdapter' &&
          !node.parentId &&
          !node.data.blockInstanceV2 &&
          !node.data.blockProjectionOwnerId &&
          node.data.params.pipeline?.display === 'input' &&
          node.data.params.pipeline.type === pipelineType &&
          node.data.params.output?.display === 'output' &&
          node.data.params.output.type === pipelineType &&
          graph.edges.filter((edge) => edge.target === node.id && edge.targetHandle === 'pipeline').length === 1 &&
          (graph.edges.filter((edge) => edge.source === node.id && edge.sourceHandle === 'output').length === 1 ||
            Boolean(
              declaredImagePipelineStageTail(
                graph,
                loaderId,
                graph.edges.filter((edge) => edge.source === node.id && edge.sourceHandle === 'output'),
              ),
            )) &&
          graph.edges
            .filter((edge) => edge.target === node.id && edge.targetHandle === 'pipeline')
            .every((edge) => pipelineSocket(edge.source, edge.sourceHandle, 'output')) &&
          graph.edges
            .filter((edge) => edge.source === node.id && edge.sourceHandle === 'output')
            .every((edge) => pipelineSocket(edge.target, edge.targetHandle, 'input')),
      )
      .map((node) => node.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      for (const [source, target] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ]) {
        const validBridge =
          (!bridges.has(edge.source) || edge.sourceHandle === 'output') &&
          (!bridges.has(edge.target) || edge.targetHandle === 'pipeline');
        if (
          source &&
          target &&
          validBridge &&
          ids.has(source) &&
          (candidates.has(target) || bridges.has(target)) &&
          !ids.has(target)
        ) {
          ids.add(target);
          changed = true;
        }
      }
    }
  }
  const result = [...ids].flatMap((id) => (candidates.has(id) ? [candidates.get(id)!] : []));
  if (new Set(result.map((n) => operationAuthoring(n)!.operation.operationId)).size !== result.length)
    throw new Error(
      'This graph has several instances of one stage. Change a separate branch or reconnect it to its own loader first.',
    );
  // A shared stage belongs to neither loader exclusively.
  for (const edge of graph.edges) {
    if (!ids.has(edge.target) || ids.has(edge.source)) continue;
    const source = graph.nodes.find((n) => n.id === edge.source);
    const h = source && operationAuthoring(source);
    if (operationOwnsModel(h?.operation))
      throw new Error(
        'A stage uses another loader too. Separate the shared component connection before changing this graph.',
      );
  }
  return result;
}
