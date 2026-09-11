import type { BlockInstanceV2, BlockGraphNodeV2 } from './blockSchemaV2';
import type { HuggingFaceNodeLibraryBlockDefinition } from './huggingFaceNodeLibrary';
import { exactReviewedStateContractV2, reviewedStateParamsV2 } from './reviewedStateContractV2';
import { blockContainerFieldValueV1 } from './blockContainerInterfaceV1';

export type ReviewedStateIssueV2 = {
  nodeId: string;
  missing: string[];
  message: string;
  reconnectFrom: string[];
};

/** Diagnose missing upstream values without evaluating models or inventing data.
 * Unknown/ordinary state processors are opaque: do not assert their output keys.
 */
export function inspectReviewedStateV2(
  instance: BlockInstanceV2,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
): ReviewedStateIssueV2[] {
  const graph = instance.effectiveGraph;
  const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const contracts = new Map(graph.nodes.map((node) => [node.nodeId, exactReviewedStateContractV2(node, definitions)]));
  const cache = new Map<string, Set<string> | null>();
  const visiting = new Set<string>();
  const incoming = (id: string) =>
    graph.edges.filter((edge) => edge.targetNodeId === id && edge.targetPortId === 'state_in');
  const hasValue = (node: BlockGraphNodeV2, field: string) => {
    if (
      graph.edges.some(
        (edge) => edge.targetNodeId === node.nodeId && [field, `state_input__${field}`].includes(edge.targetPortId),
      )
    )
      return true;
    // External drivers are validated by the ordinary public-interface checks;
    // this local analysis cannot infer their values from an internal snapshot.
    if (
      instance.effectiveInterface.boundary.inputs.some((port) =>
        [port.binding, ...(port.mirrorBindings ?? [])].some(
          (binding) => binding.nodeId === node.nodeId && binding.fieldOrPortId === field,
        ),
      )
    )
      return true;
    const value = blockContainerFieldValueV1(instance, node.nodeId, field);
    return value !== undefined && value !== null;
  };
  const after = (id: string): Set<string> | null => {
    if (cache.has(id)) return cache.get(id)!;
    if (visiting.has(id)) return null;
    const node = nodes.get(id),
      contract = contracts.get(id);
    if (!node || !contract) return null;
    visiting.add(id);
    const edges = incoming(id);
    let known: Set<string> | null = new Set();
    if (edges.length === 1 && edges[0]!.sourcePortId === 'state_out') known = after(edges[0]!.sourceNodeId);
    else if (edges.length) known = null;
    if (known) {
      known = new Set(known);
      for (const field of contract.inputs) if (hasValue(node, field.name)) known.add(field.name);
      for (const field of contract.outputs) known.add(field.name);
    }
    visiting.delete(id);
    cache.set(id, known);
    return known;
  };
  const dependsOn = (id: string, target: string, seen = new Set<string>()): boolean => {
    if (id === target) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return graph.edges.some((edge) => edge.targetNodeId === id && dependsOn(edge.sourceNodeId, target, seen));
  };
  const issues: ReviewedStateIssueV2[] = [];
  for (const node of graph.nodes) {
    const contract = contracts.get(node.nodeId);
    if (!contract || blockContainerFieldValueV1(instance, node.nodeId, 'execution_kind') === 'loop_member') continue;
    const edges = incoming(node.nodeId);
    const inherited =
      edges.length === 0
        ? new Set<string>()
        : edges.length === 1 && edges[0]!.sourcePortId === 'state_out'
          ? after(edges[0]!.sourceNodeId)
          : null;
    if (!inherited) continue;
    const missing = contract.inputs
      .filter((field) => field.required && !inherited.has(field.name) && !hasValue(node, field.name))
      .map((field) => field.name);
    if (!missing.length) continue;
    const candidates = edges.length
      ? []
      : graph.nodes.filter((source) => {
          if (dependsOn(source.nodeId, node.nodeId) || !reviewedStateParamsV2(source).state_out) return false;
          const available = after(source.nodeId);
          return available && missing.every((field) => available.has(field));
        });
    const baseline = instance.definitionSnapshot.graph.edges.find(
      (edge) => edge.targetNodeId === node.nodeId && edge.targetPortId === 'state_in',
    );
    const preferred = candidates.find((source) => source.nodeId === baseline?.sourceNodeId);
    const reconnectFrom = (preferred ? [preferred] : candidates).map((source) => source.nodeId);
    issues.push({
      nodeId: node.nodeId,
      missing,
      reconnectFrom,
      message: `${node.data.label ?? contract.className}: missing ${missing.join(', ')}.`,
    });
  }
  return issues;
}
