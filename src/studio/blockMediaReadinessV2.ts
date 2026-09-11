import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { blockInputPortBindingsV2, blockProjectionNodeIdV2 } from './blockRuntimeV2';
import { blockMediaFileBoundaryIsCompatibleV2 } from './blockValueTypeCompatibilityV2';
import type { RunReadinessIssue } from './types';

function emptyPickerValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return !value.trim();
  return Array.isArray(value) && value.every(emptyPickerValue);
}

/**
 * Check declared required media/file bindings against the resolved executable
 * graph, not collapsed-card values. Incoming wires can legitimately replace a
 * picker, and the compiler has already applied instance/control/default values.
 * This does not speculate about conditional tensor/state requirements, file
 * existence, or backend shape compatibility, and never repairs a saved draft.
 */
export function inspectBlockMediaInputsV2(
  visibleNodes: CustomNodeType[],
  execution: { nodes: CustomNodeType[]; edges: Edge[] },
): RunReadinessIssue[] {
  const enabled = new Map(
    execution.nodes.filter((node) => !node.data.uiState?.disabled).map((node) => [node.id, node]),
  );
  const connected = new Set(
    execution.edges.filter((edge) => enabled.has(edge.source)).map((edge) => `${edge.target}\0${edge.targetHandle}`),
  );
  const visible = new Set(visibleNodes.filter((node) => !node.hidden).map((node) => node.id));
  const seen = new Set<string>();
  const issues: RunReadinessIssue[] = [];
  for (const root of visibleNodes) {
    const instance = root.data.blockInstanceV2;
    if (!instance || root.data.blockProjectionOwnerId || root.data.uiState?.disabled) continue;
    const inputs = [
      ...instance.effectiveInterface.boundary.inputs.map((port) => ({ port, ownerId: root.id })),
      ...instance.effectiveGraph.nodes.flatMap((node) =>
        (node.containerInterface?.boundary.inputs ?? []).map((port) => ({
          port,
          ownerId: blockProjectionNodeIdV2(instance.instanceId, node.nodeId),
        })),
      ),
    ];
    for (const { port, ownerId } of inputs) {
      if (!port.required) continue;
      for (const binding of blockInputPortBindingsV2(port)) {
        const projectedId = blockProjectionNodeIdV2(instance.instanceId, binding.nodeId);
        const key = `${projectedId}\0${binding.fieldOrPortId}`;
        if (seen.has(key) || connected.has(key)) continue;
        const param = enabled.get(projectedId)?.data.params?.[binding.fieldOrPortId];
        if (!param || !blockMediaFileBoundaryIsCompatibleV2(port.valueType, param)) continue;
        // Match flowGraphExport: null/undefined use the declared default;
        // an explicitly empty string does not.
        const value = param.value ?? param.default;
        if (!emptyPickerValue(value)) continue;
        seen.add(key);
        const leafVisible = visible.has(projectedId);
        const ownerVisible = visible.has(ownerId);
        const label = port.label || port.portId;
        issues.push({
          id: `block-media-input-missing:${projectedId}:${binding.fieldOrPortId}`,
          code: 'block_media_input_missing',
          category: 'asset',
          severity: 'error',
          blocking: true,
          action: 'inspect_node',
          nodeId: leafVisible ? projectedId : ownerVisible ? ownerId : root.id,
          fieldId: leafVisible ? binding.fieldOrPortId : ownerVisible ? port.portId : undefined,
          message: `Choose ${label} before running.`,
          details: `Required media input ${port.portId} binds ${binding.nodeId}.${binding.fieldOrPortId}, but no file or enabled incoming connection supplies it. Select a file in the Block's inputs, or expand it and connect a compatible source. Your other settings are unchanged.`,
        });
      }
    }
  }
  return issues;
}
