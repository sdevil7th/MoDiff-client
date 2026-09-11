import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { BlockControlV2 } from './blockSchemaV2';
import { blockContainerInterfaceV1 } from './blockContainerInterfaceV1';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Display-only: a wire supplies execution values, never a renderer evaluation.
 * Resolve aliases against their owning instance; do not persist another value.
 */
export function blockControlConnectionNotesV2(
  node: CustomNodeType | undefined,
  params: Record<string, NodeParams>,
  nodes: CustomNodeType[],
  edges: Edge[],
): Record<string, string> {
  const owner = node?.data.blockInstanceV2
    ? node
    : nodes.find((candidate) => candidate.id === node?.data.blockProjectionOwnerId);
  const instance = owner?.data.blockInstanceV2;
  if (!instance || !node) return {};
  const notes: Record<string, string> = {};
  for (const [key, param] of Object.entries(params)) {
    if (param.hidden || param.isInput || param.display === 'input' || param.display === 'output') continue;
    const binding = param.fieldOptions?.blockBindingV2;
    const local = param.fieldOptions?.blockContainerControlV1;
    let control: Pick<BlockControlV2, 'binding' | 'mirrorBindings'> | undefined;
    if (
      record(local) &&
      local.ownerId === instance.instanceId &&
      local.containerNodeId === node.data.blockProjectionNodeId
    ) {
      control = blockContainerInterfaceV1(instance, String(local.containerNodeId)).controls.find(
        (entry) => entry.controlId === local.controlId,
      );
    } else if (record(binding) && binding.ownerId === instance.instanceId) {
      control = instance.effectiveInterface.controls.find((entry) => entry.controlId === binding.logicalId);
    } else if (node.id === instance.instanceId) {
      control = instance.effectiveInterface.controls.find((entry) => entry.controlId === key);
    }
    if (!control) continue;
    const targets = [control.binding, ...(control.mirrorBindings ?? [])];
    const driven = new Set<string>();
    const sources = new Set<string>();
    for (const target of targets) {
      const targetKey = `${target.nodeId}\0${target.fieldId}`;
      for (const edge of instance.effectiveGraph.edges) {
        if (edge.targetNodeId !== target.nodeId || edge.targetPortId !== target.fieldId) continue;
        const source = instance.effectiveGraph.nodes.find((entry) => entry.nodeId === edge.sourceNodeId);
        sources.add(
          `${typeof source?.data.label === 'string' ? source.data.label : edge.sourceNodeId}.${edge.sourcePortId}`,
        );
        driven.add(targetKey);
      }
      for (const port of instance.effectiveInterface.boundary.inputs) {
        if (
          ![port.binding, ...(port.mirrorBindings ?? [])].some(
            (entry) => entry.nodeId === target.nodeId && entry.fieldOrPortId === target.fieldId,
          )
        )
          continue;
        for (const edge of edges) {
          if (edge.target !== instance.instanceId || edge.targetHandle !== port.portId) continue;
          const source = nodes.find((entry) => entry.id === edge.source);
          sources.add(`${source?.data.label ?? edge.source}.${edge.sourceHandle ?? 'output'}`);
          driven.add(targetKey);
        }
      }
    }
    if (!driven.size) continue;
    notes[key] =
      `Connected from ${[...sources].join(', ')}. ${driven.size < targets.length ? `${driven.size} of ${targets.length} targets use connected values; the remaining targets use the saved fallback. ` : 'The shown value is the saved fallback, not the connected execution value. '}Edit the source node or disconnect to edit this control. No fallback values have been changed.`;
  }
  return notes;
}
