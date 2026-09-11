import {
  blockGraphHashV2,
  blockInterfaceHashV2,
  normalizeBlockInstanceV2,
  type BlockGraphNodeV2,
  type BlockInstanceV2,
} from './blockSchemaV2';
import type { HuggingFaceNodeLibraryBlockDefinition } from './huggingFaceNodeLibrary';
import {
  reviewedStateParamsV2 as params,
  exactReviewedStateContractV2 as exactContract,
} from './reviewedStateContractV2';

export type BlockSeedBindingIssueV2 = {
  nodeId: string;
  consumerNodeId?: string;
  canRepair: boolean;
  reason: string;
};

function bindingMatches(binding: { nodeId: string; fieldId?: string; fieldOrPortId?: string }, nodeId: string) {
  return binding.nodeId === nodeId && (binding.fieldId ?? binding.fieldOrPortId) === 'seed';
}

function seedRepairCandidate(
  instance: BlockInstanceV2,
  source: BlockGraphNodeV2,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
): BlockSeedBindingIssueV2 {
  const fail = (reason: string): BlockSeedBindingIssueV2 => ({ nodeId: source.nodeId, canRepair: false, reason });
  const controls = [
    ...instance.effectiveInterface.controls,
    ...instance.effectiveGraph.nodes.flatMap((node) => node.containerInterface?.controls ?? []),
  ];
  for (const control of controls) {
    const bindings = [control.binding, ...(control.mirrorBindings ?? [])];
    if (!bindings.some((binding) => bindingMatches(binding, source.nodeId))) continue;
    if (control.sealed) return fail('The seed is owned by a sealed control. Its binding cannot be changed.');
    if (bindings.some((binding) => !bindingMatches(binding, source.nodeId)))
      return fail('The seed control has other mirrored targets. Configure one unambiguous seed initializer first.');
  }
  const publicInputs = [
    ...instance.effectiveInterface.boundary.inputs,
    ...instance.effectiveGraph.nodes.flatMap((node) => node.containerInterface?.boundary.inputs ?? []),
  ];
  if (
    publicInputs.some((port) => {
      const bindings = [port.binding, ...(port.mirrorBindings ?? [])];
      return (
        bindings.some((binding) => bindingMatches(binding, source.nodeId)) &&
        bindings.some((binding) => !bindingMatches(binding, source.nodeId))
      );
    })
  )
    return fail('The public seed input has other mirrored targets. Configure one unambiguous initializer first.');
  const byId = new Map(instance.effectiveGraph.nodes.map((node) => [node.nodeId, node]));
  const visited = new Set([source.nodeId]);
  let current = source;
  let consumer: BlockGraphNodeV2 | undefined;
  // Follow the concrete state chain, not canvas order, class-name heuristics,
  // or a different pipeline elsewhere in the workflow. The furthest upstream
  // Generator consumer initializes the shared sequence exactly once.
  while (true) {
    const incoming = instance.effectiveGraph.edges.filter(
      (edge) => edge.targetNodeId === current.nodeId && edge.targetPortId === 'state_in',
    );
    if (!incoming.length) break;
    if (incoming.length !== 1 || incoming[0]!.sourcePortId !== 'state_out')
      return fail(
        'The Pipeline State ancestry is ambiguous. Configure the state connections before repairing the seed.',
      );
    const previous = byId.get(incoming[0]!.sourceNodeId);
    if (!previous || visited.has(previous.nodeId)) return fail('The Pipeline State ancestry is missing or cyclic.');
    visited.add(previous.nodeId);
    const contract = exactContract(previous, definitions);
    if (
      !contract ||
      previous.modularDiffusers?.libraryRevision !== source.modularDiffusers?.libraryRevision ||
      previous.modularDiffusers?.pipelineClass !== source.modularDiffusers?.pipelineClass
    )
      return fail(
        'The upstream state consumer does not match the exact reviewed contract. No seed target was guessed.',
      );
    if (contract.inputs.some((input) => input.name === 'generator')) consumer = previous;
    current = previous;
  }
  if (!consumer) return fail('No verified Generator consumer exists in this node’s connected Pipeline State ancestry.');
  if (
    params(consumer).seed !== undefined ||
    instance.effectiveGraph.edges.some((edge) => edge.targetNodeId === consumer.nodeId && edge.targetPortId === 'seed')
  )
    return fail('The Generator consumer already has a seed. Its existing initializer will not be overwritten.');
  return {
    nodeId: source.nodeId,
    consumerNodeId: consumer.nodeId,
    canRepair: true,
    reason: `Move this seed binding to ${String(consumer.data.label ?? consumer.nodeId)}, which consumes the upstream Generator. Prompts, values and unrelated nodes stay unchanged.`,
  };
}

/** A diagnostic only; opening/loading an old graph never rewrites it. */
export function inspectBlockSeedBindingsV2(
  instance: BlockInstanceV2,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
): BlockSeedBindingIssueV2[] {
  return instance.effectiveGraph.nodes.flatMap((node) => {
    if (params(node).seed === undefined) return [];
    const contract = exactContract(node, definitions);
    if (!contract || contract.inputs.some((input) => input.name === 'generator')) return [];
    const candidate = seedRepairCandidate(instance, node, definitions);
    if (candidate.canRepair && candidate.consumerNodeId) {
      try {
        applySeedRepair(instance, node.nodeId, candidate.consumerNodeId);
      } catch (error) {
        return [
          {
            nodeId: node.nodeId,
            canRepair: false,
            reason: `The seed cannot move without changing the local interface: ${error instanceof Error ? error.message : String(error)}`,
          },
        ];
      }
    }
    return [candidate];
  });
}

/** Explicit copy-on-write repair; immutable definition and logical value IDs survive. */
export function repairBlockSeedBindingV2(
  instanceValue: BlockInstanceV2,
  sourceNodeId: string,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const issue = inspectBlockSeedBindingsV2(instance, definitions).find(({ nodeId }) => nodeId === sourceNodeId);
  if (!issue?.canRepair || !issue.consumerNodeId)
    throw new Error(issue?.reason ?? 'The seed repair no longer matches an exact reviewed unused seed binding.');
  return applySeedRepair(instance, sourceNodeId, issue.consumerNodeId);
}

function applySeedRepair(instance: BlockInstanceV2, sourceNodeId: string, targetNodeId: string): BlockInstanceV2 {
  const graph = structuredClone(instance.effectiveGraph);
  const source = graph.nodes.find(({ nodeId }) => nodeId === sourceNodeId)!;
  const target = graph.nodes.find(({ nodeId }) => nodeId === targetNodeId)!;
  const targetParams = params(target);
  targetParams.seed = structuredClone(params(source).seed!);
  target.data.params = targetParams;
  delete params(source).seed;
  const retarget = <T extends { nodeId: string; fieldId?: string; fieldOrPortId?: string }>(binding: T): T =>
    bindingMatches(binding, sourceNodeId) ? { ...binding, nodeId: targetNodeId } : binding;
  const retargetSurface = <
    T extends BlockInstanceV2['effectiveInterface'] | NonNullable<BlockGraphNodeV2['containerInterface']>,
  >(
    surface: T,
  ): T => ({
    ...surface,
    boundary: {
      ...surface.boundary,
      inputs: surface.boundary.inputs.map((port) => ({
        ...port,
        binding: retarget(port.binding),
        ...(port.mirrorBindings ? { mirrorBindings: port.mirrorBindings.map(retarget) } : {}),
      })),
    },
    controls: surface.controls.map((control) => ({
      ...control,
      binding: retarget(control.binding),
      ...(control.mirrorBindings ? { mirrorBindings: control.mirrorBindings.map(retarget) } : {}),
    })),
  });
  for (const node of graph.nodes)
    if (node.containerInterface) node.containerInterface = retargetSurface(node.containerInterface);
  graph.edges = graph.edges.map((edge) =>
    edge.targetNodeId === sourceNodeId && edge.targetPortId === 'seed' ? { ...edge, targetNodeId } : edge,
  );
  graph.graphHash = blockGraphHashV2(graph);
  const effectiveInterface = retargetSurface(instance.effectiveInterface);
  effectiveInterface.effectiveInterfaceHash = blockInterfaceHashV2(effectiveInterface);
  // Validate the atomic candidate after both graph and interface move together.
  // In particular, a local surface cannot be rebound outside its subtree.
  return normalizeBlockInstanceV2({
    ...instance,
    effectiveGraph: graph,
    effectiveInterface,
    authorities: [],
    customization: { ...instance.customization, state: 'structure_changed', effectiveGraphHash: graph.graphHash },
  });
}
