import type { BlockGraphNodeV2, BlockInstanceV2 } from './blockSchemaV2';
import type { HuggingFaceNodeLibraryBlockDefinition } from './huggingFaceNodeLibrary';
import { reviewedStateParamsV2 as params, exactReviewedStateContractV2 as contract } from './reviewedStateContractV2';

export type BlockDerivedControlIssueV2 = {
  nodeId: string;
  writerNodeId: string;
  fieldId: string;
  canRepair: boolean;
  reason: string;
};
type Binding = { nodeId: string; fieldId?: string; fieldOrPortId?: string };
export function field(binding: Binding) {
  return binding.fieldId ?? binding.fieldOrPortId;
}
function surfaces(instance: BlockInstanceV2) {
  return [
    instance.effectiveInterface,
    ...instance.effectiveGraph.nodes.flatMap((node) => (node.containerInterface ? [node.containerInterface] : [])),
  ];
}
function connectedWriter(
  instance: BlockInstanceV2,
  source: BlockGraphNodeV2,
  name: string,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
) {
  const visited = new Set([source.nodeId]);
  let current = source;
  let writer: BlockGraphNodeV2 | undefined;
  while (true) {
    const incoming = instance.effectiveGraph.edges.filter(
      (edge) => edge.targetNodeId === current.nodeId && edge.targetPortId === 'state_in',
    );
    if (!incoming.length) return writer;
    if (incoming.length !== 1 || incoming[0]!.sourcePortId !== 'state_out') return;
    const previous = instance.effectiveGraph.nodes.find((node) => node.nodeId === incoming[0]!.sourceNodeId);
    if (!previous || visited.has(previous.nodeId)) return;
    visited.add(previous.nodeId);
    const exact = contract(previous, definitions);
    if (
      !exact ||
      previous.modularDiffusers?.pipelineClass !== source.modularDiffusers?.pipelineClass ||
      previous.modularDiffusers?.libraryRevision !== source.modularDiffusers?.libraryRevision ||
      previous.modularDiffusers?.workflowId !== source.modularDiffusers?.workflowId
    )
      return;
    if (exact.outputs.some((output) => output.name === name)) {
      if (!exact.inputs.some((input) => input.name === name)) return;
      writer = previous;
    }
    current = previous;
  }
}

/** Only duplicated caller bindings are diagnosed. An independently authored
 * downstream override is not assumed to be a mistake. Loading is read-only.
 */
export function inspectBlockDerivedControlsV2(
  instance: BlockInstanceV2,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
): BlockDerivedControlIssueV2[] {
  const result = new Map<string, BlockDerivedControlIssueV2>();
  for (const surface of surfaces(instance)) {
    for (const control of [...surface.controls, ...surface.boundary.inputs]) {
      const bindings: Binding[] = [control.binding, ...(control.mirrorBindings ?? [])];
      for (const binding of bindings) {
        const name = field(binding);
        const source = instance.effectiveGraph.nodes.find((node) => node.nodeId === binding.nodeId);
        if (
          !name ||
          !source ||
          !params(source)[name] ||
          !contract(source, definitions)?.inputs.some((input) => input.name === name)
        )
          continue;
        const writer = connectedWriter(instance, source, name, definitions);
        if (!writer || !bindings.some((candidate) => candidate.nodeId === writer.nodeId && field(candidate) === name))
          continue;
        const key = `${source.nodeId}\0${name}`;
        if (result.has(key)) continue;
        const issue: BlockDerivedControlIssueV2 = {
          nodeId: source.nodeId,
          writerNodeId: writer.nodeId,
          fieldId: name,
          canRepair: true,
          reason: `Inherit ${name} from ${writer.nodeId}.`,
        };
        try {
          // Readiness runs during ordinary editing. Check ownership without
          // cloning/hashing a candidate graph on every render. Apply still
          // revalidates the exact contracts and the complete atomic result.
          assertDerivedControlRepairOwnershipV2(instance, issue);
        } catch (error) {
          issue.canRepair = false;
          issue.reason = error instanceof Error ? error.message : String(error);
        }
        result.set(key, issue);
      }
    }
  }
  return [...result.values()];
}

export function assertDerivedControlRepairOwnershipV2(instance: BlockInstanceV2, issue: BlockDerivedControlIssueV2) {
  const matches = (binding: Binding) => binding.nodeId === issue.nodeId && field(binding) === issue.fieldId;
  const ownsWriter = (binding: Binding) => binding.nodeId === issue.writerNodeId && field(binding) === issue.fieldId;
  for (const surface of surfaces(instance)) {
    for (const control of [...surface.controls, ...surface.boundary.inputs]) {
      const bindings: Binding[] = [control.binding, ...(control.mirrorBindings ?? [])];
      if (!bindings.some(matches)) continue;
      if ('sealed' in control && control.sealed) throw new Error('Sealed control.');
      if (!bindings.some(ownsWriter)) throw new Error('Independent control: use Configure Interface.');
    }
    if (surface.boundary.outputs.some((port) => matches(port.binding)))
      throw new Error('Public output: use Configure Interface.');
  }
  if (
    instance.effectiveGraph.edges.some(
      (edge) =>
        (edge.targetNodeId === issue.nodeId && edge.targetPortId === issue.fieldId) ||
        (edge.sourceNodeId === issue.nodeId && edge.sourcePortId === issue.fieldId),
    )
  ) {
    throw new Error('Disconnect this field’s internal wire first.');
  }
}
