import {
  blockGraphHashV2,
  blockInterfaceHashV2,
  normalizeBlockInstanceV2,
  type BlockGraphNodeV2,
  type BlockInstanceV2,
} from './blockSchemaV2';
import type { HuggingFaceNodeLibraryBlockDefinition } from './huggingFaceNodeLibrary';
import {
  inspectBlockDerivedControlsV2,
  assertDerivedControlRepairOwnershipV2,
  field,
  type BlockDerivedControlIssueV2,
} from './blockDerivedControlRepairV2';
import { reviewedStateParamsV2 as params } from './reviewedStateContractV2';

type Binding = { nodeId: string; fieldId?: string; fieldOrPortId?: string };
export function repairBlockDerivedControlV2(
  instanceValue: BlockInstanceV2,
  nodeId: string,
  fieldId: string,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const issue = inspectBlockDerivedControlsV2(instance, definitions).find(
    (candidate) => candidate.nodeId === nodeId && candidate.fieldId === fieldId,
  );
  if (!issue?.canRepair) throw new Error(issue?.reason ?? 'Shared binding no longer verified.');
  return applyRepair(instance, issue);
}

function applyRepair(instance: BlockInstanceV2, issue: BlockDerivedControlIssueV2): BlockInstanceV2 {
  assertDerivedControlRepairOwnershipV2(instance, issue);
  const matches = (binding: Binding) => binding.nodeId === issue.nodeId && field(binding) === issue.fieldId;
  const retargetBindings = <T extends Binding>(bindings: T[]): T[] => {
    const [primary, ...mirrors] = bindings
      .map((binding) => (matches(binding) ? { ...binding, nodeId: issue.writerNodeId } : binding))
      .filter(
        (binding, index, all) =>
          all.findIndex((other) => other.nodeId === binding.nodeId && field(other) === field(binding)) === index,
      );
    mirrors.sort((left, right) => {
      const a = `${left.nodeId}\0${field(left)}`,
        b = `${right.nodeId}\0${field(right)}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return primary ? [primary, ...mirrors] : [];
  };
  const retargetEntry = <B extends Binding, T extends { binding: B; mirrorBindings?: B[] }>(entry: T): T => {
    const bindings = retargetBindings([entry.binding, ...(entry.mirrorBindings ?? [])]);
    const next = { ...entry, binding: bindings[0]! };
    delete next.mirrorBindings;
    if (bindings.length > 1) next.mirrorBindings = bindings.slice(1);
    return next;
  };
  const retargetSurface = <
    T extends BlockInstanceV2['effectiveInterface'] | NonNullable<BlockGraphNodeV2['containerInterface']>,
  >(
    surface: T,
  ): T => ({
    ...surface,
    boundary: {
      ...surface.boundary,
      inputs: surface.boundary.inputs.map(retargetEntry),
    },
    controls: surface.controls.map(retargetEntry),
  });
  const graph = structuredClone(instance.effectiveGraph);
  delete params(graph.nodes.find((node) => node.nodeId === issue.nodeId)!)[issue.fieldId];
  for (const node of graph.nodes)
    if (node.containerInterface) node.containerInterface = retargetSurface(node.containerInterface);
  graph.graphHash = blockGraphHashV2(graph);
  const effectiveInterface = retargetSurface(instance.effectiveInterface);
  effectiveInterface.effectiveInterfaceHash = blockInterfaceHashV2(effectiveInterface);
  return normalizeBlockInstanceV2({
    ...instance,
    effectiveGraph: graph,
    effectiveInterface,
    authorities: [],
    customization: { ...instance.customization, state: 'structure_changed', effectiveGraphHash: graph.graphHash },
  });
}
