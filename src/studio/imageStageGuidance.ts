import type { NodeData } from '../stores/useNodeStore';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { Edge } from '@xyflow/react';
import { matchingNodeHandleForDrop, nodeConnectionSemanticsAreCompatible } from '../workflow/nodeConnectionMatching';
import { acceptsOperationValue } from '../workflow/operationFieldValue';
import { isRecord } from '../utils/isRecord';
import { visualStageForNode, type VisualCatalog } from './visualNodeCatalog';
type Context = { label: string; reason?: string; next?: NodeData };

/** An explicit edit to a manually wired image stage. Bound workflow recipes use
 * their existing task/model switch, which also updates the loader and branches. */
export function imageStageGuidance(
  node: CustomNodeType,
  nodes: CustomNodeType[],
  edges: Edge[],
  registry: Record<string, NodeData>,
  catalog: VisualCatalog | null,
): Context | null {
  const data = node.data;
  if (data.operationAuthoring || data.blockProjectionOwnerId || data.studioRole || data.blockInstanceV2) return null;
  const active = visualStageForNode(catalog, data);
  if (!active?.mode.guidance) return null;
  const alternate = active.stage.modes.find((m) => m.guidance && m.guidance !== active.mode.guidance);
  const other = alternate && registry[alternate.node];
  if (!other || other.module !== data.module) return null;
  const controlled = Boolean(data.params.control_image);
  const label = controlled ? 'Remove control guidance' : 'Add control guidance';
  const ownerEdge = edges.find((edge) => edge.target === node.id && edge.targetHandle === 'pipeline');
  const owner = nodes.find((peer) => peer.id === ownerEdge?.source);
  if (ownerEdge) {
    const port = ownerEdge.sourceHandle;
    const signal = port && owner?.data.params[port]?.signal?.value;
    if (!owner || !port || !isRecord(signal))
      return { label, reason: 'Waiting for the connected model’s supported actions.' };
    if (!nodeConnectionSemanticsAreCompatible(owner.data, port, data, 'pipeline'))
      return { label, reason: 'The connected model does not support this action. Check the model or its task.' };
    if (!nodeConnectionSemanticsAreCompatible(owner.data, port, other, 'pipeline'))
      return controlled ? { label, reason: 'The selected model requires a control guide.' } : null;
  }
  for (const edge of edges) {
    const key = edge.target === node.id ? edge.targetHandle : edge.source === node.id ? edge.sourceHandle : null;
    if (key && !other.params[key])
      return { label, reason: 'Disconnect ' + (data.params[key]?.label ?? key) + ' to change guidance.' };
  }
  const params = { ...other.params };
  const retained: Record<string, unknown> = { ...data.uiState?.inactiveGuidance };
  for (const [key, p] of Object.entries(data.params)) {
    if (p.value !== undefined && !other.params[key] && p.display !== 'output' && !p.display?.startsWith('ui_'))
      retained[key] = p.value;
  }
  for (const [key, p] of Object.entries(params)) {
    const previous = data.params[key];
    const value = previous?.value ?? retained[key];
    if (value !== undefined && p.display !== 'output' && !p.display?.startsWith('ui_')) {
      if (!acceptsOperationValue(p, value))
        return { label, reason: 'The saved ' + (p.label ?? key) + ' value is incompatible with this action.' };
      params[key] = { ...p, value, isInput: previous?.isInput ?? p.isInput };
      delete retained[key];
    }
  }
  const registered = registry[data.module + '.' + data.action];
  const title = data.label === registered?.label ? other.label : data.label;
  const target = { ...other, params };
  for (const edge of edges.filter((e) => e.source === node.id || e.target === node.id)) {
    const upstream = edge.target === node.id;
    const peer = nodes.find((n) => n.id === (upstream ? edge.source : edge.target));
    const field = upstream ? edge.targetHandle : edge.sourceHandle;
    const peerField = upstream ? edge.sourceHandle : edge.targetHandle;
    if (
      !peer ||
      !field ||
      !peerField ||
      !matchingNodeHandleForDrop(
        target,
        peer.data.params[peerField]?.type,
        upstream ? 'source' : 'target',
        { node: peer.data, handleId: peerField },
        true,
        field,
      )
    )
      return {
        label,
        reason:
          'Check the existing ' +
          (data.params[field ?? '']?.label ?? field ?? 'stage') +
          ' connection before changing guidance.',
      };
  }
  return {
    label,
    next: {
      ...data,
      action: other.action,
      description: other.description,
      label: title,
      params,
      uiState: { ...data.uiState, inactiveGuidance: retained },
    },
  };
}
