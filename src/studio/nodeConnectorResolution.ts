import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import { blockConnectorParamsV2 } from './blockRuntimeV2';

// BlockInstanceV2 is an immutable, copy-on-write document. Registered route
// sets can contain several complete inactive definition drafts, so validating
// and cloning that document for every handle lookup is needlessly expensive.
// Graph readiness and Fix planning call this resolver in nested candidate
// loops; without an identity cache a saved three-route Block can spend minutes
// repeatedly normalizing the same multi-megabyte instance while a transient
// route compiler is trying to publish its fields.
const blockConnectorParamsByInstance = new WeakMap<object, Record<string, NodeParams>>();

/**
 * Resolve the public connection surface for every canvas node generation.
 *
 * A Block V2 root derives its sockets from its embedded BlockInstanceV2. It
 * must never mirror connector schema or runtime connection state into
 * `NodeData.params`. Legacy User Nodes, legacy Clusters, and ordinary nodes
 * retain their existing `NodeData.params` authority until they are migrated.
 */
export function nodeConnectorParams(node: Pick<CustomNodeType, 'data'>): Record<string, NodeParams> {
  if (!node.data.blockInstanceV2) return node.data.params;
  const cached = blockConnectorParamsByInstance.get(node.data.blockInstanceV2);
  if (cached) return cached;
  const { inputs, outputs } = blockConnectorParamsV2(node.data.blockInstanceV2);
  const params = { ...inputs, ...outputs };
  blockConnectorParamsByInstance.set(node.data.blockInstanceV2, params);
  return params;
}

export function nodeConnectorParam(
  node: Pick<CustomNodeType, 'data'> | undefined,
  handleId: string | null | undefined,
) {
  if (!node || !handleId) return undefined;
  return nodeConnectorParams(node)[handleId];
}

export function isBlockRootV2Node(node: Pick<CustomNodeType, 'data'> | undefined) {
  return Boolean(node?.data.blockInstanceV2);
}

/**
 * Projection children are implementation details of one Block V2 instance.
 * They may connect to siblings owned by that same instance, but external
 * workflow edges must use the durable root's explicit public sockets.
 */
export function blockV2ConnectionScopeIsAllowed(
  nodes: CustomNodeType[],
  sourceId: string | null | undefined,
  targetId: string | null | undefined,
) {
  if (!sourceId || !targetId) return false;
  const sourceOwner = nodes.find((node) => node.id === sourceId)?.data.blockProjectionOwnerId;
  const targetOwner = nodes.find((node) => node.id === targetId)?.data.blockProjectionOwnerId;
  if (!sourceOwner && !targetOwner) return true;
  return Boolean(sourceOwner && targetOwner && sourceOwner === targetOwner);
}
