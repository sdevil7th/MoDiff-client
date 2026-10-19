import type { NodeData } from '../stores/useNodeStore';
import type { OperationGraph } from './operationAuthoring';
import { operationOwnsModel, type OperationContract } from './operationContracts';

type ImagePipelineStageContractNode = {
  id: string;
  operation?: OperationContract;
  params: NodeData['params'];
};
type ImagePipelineStageContractEdge = Pick<
  OperationGraph['edges'][number],
  'source' | 'sourceHandle' | 'target' | 'targetHandle'
>;

/** Validate the same declared ports and sole suppliers before creating a graph.
 * Starter rows and existing flat nodes share this structural contract check. */
export function declaredImagePipelineStageContracts(
  nodes: readonly ImagePipelineStageContractNode[],
  ownerId: string,
  allEdges: readonly ImagePipelineStageContractEdge[],
  edges: readonly ImagePipelineStageContractEdge[],
): string[] | null {
  const owner = nodes.find((node) => node.id === ownerId);
  const owning = owner && owner.operation;
  if (!operationOwnsModel(owning) || edges.length !== 3 || new Set(edges.map((edge) => edge.target)).size !== 3)
    return null;
  const source = edges[0]!;
  const output = nodes.find((node) => node.id === source.source)?.params[source.sourceHandle ?? ''];
  if (
    output?.display !== 'output' ||
    output.type !== 'image_diffusion_pipeline' ||
    edges.some((edge) => edge.source !== source.source || edge.sourceHandle !== source.sourceHandle)
  )
    return null;
  const scope = owning.binding?.pipelineClass ?? owning.pipelineClass;
  const stages: ImagePipelineStageContractNode[] = [];
  for (const edge of edges) {
    const node = nodes.find((candidate) => candidate.id === edge.target);
    const operation = node && node.operation;
    const input = node?.params[edge.targetHandle ?? ''];
    const ports = operation?.ports.filter((port) => port.direction === 'input' && port.name === edge.targetHandle);
    const port = ports?.[0];
    if (
      !node ||
      !operation ||
      operation.decomposition !== 'bundle' ||
      operation.pipelineClass !== owning.pipelineClass ||
      operation.task !== owning.task ||
      !['image_encoder', 'denoise', 'decoder'].includes(operation.nodeType) ||
      ports?.length !== 1 ||
      port?.types.length !== 1 ||
      port.types[0] !== 'image_diffusion_pipeline' ||
      port.roles.length !== 1 ||
      !['component', 'pipeline'].includes(port.roles[0]!) ||
      port.semantics?.kind !== 'pipeline' ||
      port.semantics.owner !== 'same_loader' ||
      port.semantics.scope !== scope ||
      input?.type !== 'image_diffusion_pipeline' ||
      !(input.display === 'input' || input.isInput) ||
      allEdges.filter((candidate) => candidate.target === node.id && candidate.targetHandle === edge.targetHandle)
        .length !== 1
    )
      return null;
    stages.push(node);
  }
  const operations = stages.map((node) => node.operation!);
  if (
    new Set(operations.map((operation) => operation.nodeType)).size !== 3 ||
    new Set(operations.map((operation) => operation.operationId)).size !== 3
  )
    return null;
  const stage = (kind: string) => stages.find((node) => node.operation!.nodeType === kind)!;
  const encoder = stage('image_encoder'),
    denoiser = stage('denoise'),
    decoder = stage('decoder');
  const bound = (
    source: ImagePipelineStageContractNode,
    target: ImagePipelineStageContractNode,
    kind: string,
    type: string,
    sourceName?: string,
    targetName?: string,
  ) => {
    const semanticOwner = kind === 'value' ? 'none' : 'same_loader';
    const semanticScope = kind === 'value' ? null : scope;
    const output = source.operation!.ports.filter(
      (port) =>
        port.direction === 'output' &&
        port.types.length === 1 &&
        port.types[0] === type &&
        port.semantics?.kind === kind &&
        port.semantics.owner === semanticOwner &&
        port.semantics.scope === semanticScope &&
        (sourceName === undefined || port.semanticName === sourceName),
    );
    const input = target.operation!.ports.filter(
      (port) =>
        port.direction === 'input' &&
        port.types.length === 1 &&
        port.types[0] === type &&
        port.semantics?.kind === kind &&
        port.semantics.owner === semanticOwner &&
        port.semantics.scope === semanticScope &&
        (targetName === undefined || port.semanticName === targetName),
    );
    if (output.length !== 1 || input.length !== 1) return false;
    const producing = source.params[output[0]!.name],
      consuming = target.params[input[0]!.name];
    const suppliers = allEdges.filter((edge) => edge.target === target.id && edge.targetHandle === input[0]!.name);
    const consumers = allEdges.filter((edge) => edge.source === source.id && edge.sourceHandle === output[0]!.name);
    return (
      producing?.display === 'output' &&
      producing.type === type &&
      consuming?.type === type &&
      (consuming.display === 'input' || consuming.isInput) &&
      suppliers.length === 1 &&
      consumers.length === 1 &&
      suppliers[0]!.source === source.id &&
      suppliers[0]!.sourceHandle === output[0]!.name
    );
  };
  if (
    !bound(encoder, denoiser, 'conditioning', 'image_conditioning') ||
    !bound(denoiser, decoder, 'latents', 'tensor') ||
    !bound(denoiser, decoder, 'state', 'image_latent_binding') ||
    !bound(denoiser, decoder, 'value', 'int', 'width_out', 'width') ||
    !bound(denoiser, decoder, 'value', 'int', 'height_out', 'height') ||
    !decoder.operation!.ports.some(
      (port) => port.direction === 'output' && port.types.includes('image') && port.semantics?.kind === 'media',
    )
  )
    return null;
  return stages.map((node) => node.id);
}
