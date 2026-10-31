import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { connectionTypes, connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { operationAuthoring } from './operationAuthoringHint';
import { operationOwnsModel } from './operationContracts';

/** Declared graph supply only. The backend still verifies sealed roles and generation. */
export function operationInputIsSuppliedByBundle(
  node: CustomNodeType,
  field: string,
  graph: { nodes: CustomNodeType[]; edges: Edge[] },
) {
  const operation = operationAuthoring(node)?.operation;
  const port = operation?.ports.find((p) => p.name === field && p.direction === 'input');
  const alternative = port?.semantics?.suppliedBy;
  if (!alternative || node.data.uiState?.disabled) return false;
  const input = operation!.ports.find((p) => p.name === alternative.input && p.direction === 'input');
  const target = node.data.params[alternative.input];
  if (!input || !target || target.disabled || !(target.isInput || target.display === 'input')) return false;
  const incoming = graph.edges.filter((e) => e.target === node.id && e.targetHandle === alternative.input);
  if (incoming.length !== 1) return false;
  const edge = incoming[0]!;
  const source = graph.nodes.find((n) => n.id === edge.source && !n.data.uiState?.disabled);
  if (!source) return false;
  const output = source.data.params[edge.sourceHandle ?? ''];
  const owner = operationAuthoring(source)?.operation;
  const declared = owner?.ports.find((p) => p.name === edge.sourceHandle && p.direction === 'output');
  const transport = 'diffusers_modular_pipeline_components';
  if (
    !output ||
    output.display !== 'output' ||
    output.disabled ||
    !operationOwnsModel(owner) ||
    !declared?.roles.includes('component') ||
    declared.types.length !== 1 ||
    declared.types[0] !== transport ||
    connectionTypes(output.type).length !== 1 ||
    connectionTypes(output.type)[0] !== transport ||
    connectionTypes(target.type).length !== 1 ||
    connectionTypes(target.type)[0] !== transport ||
    declared.semantics?.kind !== 'component' ||
    declared.semantics.scope !== input.semantics?.scope ||
    !connectionTypesAreCompatible(output.type, target.type)
  )
    return false;
  return alternative.members.every((name) => {
    const required = input.semantics!.members.find((m) => m.name === name);
    return required && declared.semantics!.members.some((m) => m.name === name && m.type === required.type);
  });
}
