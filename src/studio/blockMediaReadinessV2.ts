import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import { blockInputPortBindingsV2, blockProjectionNodeIdV2 } from './blockRuntimeV2';
import { blockMediaFileBoundaryIsCompatibleV2 } from './blockValueTypeCompatibilityV2';
import type { RunReadinessIssue } from './types';
import { parseOperationContracts, type OperationContract } from '../workflow/operationContracts';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';

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
  operations: OperationContract[] = [],
  registry: Record<string, NodeData> = {},
): RunReadinessIssue[] {
  const enabled = new Map(
    execution.nodes.filter((node) => !node.data.uiState?.disabled).map((node) => [node.id, node]),
  );
  const connected = new Set(
    execution.edges.filter((edge) => enabled.has(edge.source)).map((edge) => `${edge.target}\0${edge.targetHandle}`),
  );
  const visible = new Set(visibleNodes.filter((node) => !node.hidden).map((node) => node.id));
  const seen = new Set<string>();
  const owners = new Map<string, string>();
  const issues: RunReadinessIssue[] = [];
  for (const root of visibleNodes) {
    const instance = root.data.blockInstanceV2;
    if (!instance || root.data.blockProjectionOwnerId || root.data.uiState?.disabled) continue;
    for (const node of instance.effectiveGraph.nodes)
      owners.set(blockProjectionNodeIdV2(instance.instanceId, node.nodeId), root.id);
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
  const requireFile = (node: CustomNodeType, field: string) => {
    const param = node.data.params?.[field];
    const key = `${node.id}\0${field}`;
    if (
      !param ||
      param.disabled ||
      seen.has(key) ||
      connected.has(key) ||
      !emptyPickerValue(param.value ?? param.default)
    )
      return;
    seen.add(key);
    const ownerId = owners.get(node.id);
    const leafVisible = visible.has(node.id) || !ownerId;
    issues.push({
      id: `media-file-input-missing:${node.id}:${field}`,
      code: 'media_file_input_missing',
      category: 'asset',
      severity: 'error',
      blocking: true,
      action: 'inspect_node',
      nodeId: leafVisible ? node.id : ownerId,
      fieldId: leafVisible ? field : undefined,
      message: `${node.data.label || node.data.action} needs a file before running.`,
      details:
        'Select a file in the loader or connect an enabled source to its file input. Your other settings are unchanged.',
    });
  };
  // A wire from a loader is not evidence that its required file was selected.
  // Consult current declarations for historical snapshots, without rewriting
  // their saved fields. Only inspect the selected executable closure.
  for (const node of enabled.values()) {
    const declared = registry[`${node.data.module}.${node.data.action}`]?.params;
    for (const [field, param] of Object.entries(node.data.params ?? {})) {
      const contract = declared?.[field] ?? param;
      if (contract.display === 'filebrowser' && contract.required) requireFile(node, field);
    }
  }
  // Generic operations can require media without exposing a reusable Block
  // boundary. Their backend declarations apply to the same execution closure.
  // Do not infer required inputs from names, labels, model families or tensors.
  for (const node of enabled.values()) {
    const hint = node.data.operationAuthoring;
    if (hint?.schemaVersion !== 1) continue;
    let operation;
    try {
      [operation] = parseOperationContracts([hint.operation], 3);
    } catch {
      continue;
    }
    if (operation?.nodeKey !== `${node.data.module}.${node.data.action}`) continue;
    // Refresh declarations for saved nodes without rewriting their snapshots.
    operation =
      operations.find(
        (current) =>
          current.nodeKey === operation!.nodeKey &&
          current.pipelineClass === operation!.pipelineClass &&
          current.task === operation!.task &&
          current.operationId === operation!.operationId,
      ) ?? operation;
    for (const port of operation.ports) {
      if (port.direction !== 'input' || !port.required || port.hidden || port.semantics?.kind !== 'media') continue;
      const key = `${node.id}\0${port.name}`;
      const param = node.data.params?.[port.name];
      if (seen.has(key) || !param || param.disabled || !emptyPickerValue(param.value ?? param.default)) continue;
      const supplied = execution.edges.find((edge) => {
        if (edge.target !== node.id || edge.targetHandle !== port.name) return false;
        const source = enabled.get(edge.source)?.data.params?.[edge.sourceHandle ?? ''];
        return source?.display === 'output' && !source.hidden && connectionTypesAreCompatible(source.type, param.type);
      });
      if (supplied) {
        const source = enabled.get(supplied.source)!;
        // These ordinary loaders predate required-picker metadata. An empty
        // Load Image can intentionally supply an optional branch, so only
        // require its file when supplying a declared required media input.
        // Do not revise immutable registered Block schemas or guess the output
        // behavior of arbitrary custom sources from their file-picker fields.
        if (
          source.data.action === 'Load' &&
          ['modules.Image', 'modules.Audio'].includes(source.data.module) &&
          source.data.params?.file?.display === 'filebrowser'
        )
          requireFile(source, 'file');
        continue;
      }
      seen.add(key);
      const ownerId = owners.get(node.id);
      const leafVisible = visible.has(node.id) || !ownerId;
      issues.push({
        id: `operation-media-input-missing:${node.id}:${port.name}`,
        code: 'operation_media_input_missing',
        category: 'asset',
        severity: 'error',
        blocking: true,
        action: 'inspect_node',
        nodeId: leafVisible ? node.id : ownerId,
        fieldId: leafVisible ? port.name : undefined,
        message: `${node.data.label || node.data.action} needs ${port.name.replace(/_/gu, ' ')} before running.`,
        details: `Required media input ${node.id}.${port.name} has no value or enabled compatible source. Expand the Block if needed and connect this input. The saved workflow is unchanged.`,
      });
    }
  }
  return issues;
}
