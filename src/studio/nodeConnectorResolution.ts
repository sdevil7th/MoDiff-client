import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import { blockConnectorParamsV2 } from './blockRuntimeV2';
import { normalizeBlockValueTypeV2 } from './blockValueTypeCompatibilityV2';
import { blockCrossingParamV2, parseBlockCrossingHandleV2 } from './blockCrossingConnectionsV2';
import { currentOptionalEncodingPorts } from '../workflow/encodingOptionalInput';

// BlockInstanceV2 is an immutable, copy-on-write document. Registered route
// sets can contain several complete inactive definition drafts, so validating
// and cloning that document for every handle lookup is needlessly expensive.
// Graph readiness and Fix planning call this resolver in nested candidate
// loops; without an identity cache a saved three-route Block can spend minutes
// repeatedly normalizing the same multi-megabyte instance while a transient
// route compiler is trying to publish its fields.
const blockConnectorParamsByInstance = new WeakMap<object, Record<string, NodeParams>>();
const projectedConnectorParamsBySchema = new WeakMap<object, Record<string, NodeParams>>();

/**
 * Resolve the public connection surface for every canvas node generation.
 *
 * A Block V2 root derives its sockets from its embedded BlockInstanceV2. It
 * must never mirror connector schema or runtime connection state into
 * `NodeData.params`. Legacy User Nodes, legacy Clusters, and ordinary nodes
 * retain their existing `NodeData.params` authority until they are migrated.
 */
export function nodeConnectorParams(node: Pick<CustomNodeType, 'data'>): Record<string, NodeParams> {
  if (!node.data.blockInstanceV2) {
    if (!node.data.blockProjectionOwnerId) return node.data.params;
    // The V2 compiler accepts scalar aliases on leaf sockets as well as public
    // sockets. Native drag validation and edge commits must use that same type
    // authority; otherwise a Text Value cannot reach an internal `text` input.
    // Keep the authored schema and ordinary non-V2 connectors unchanged.
    const cached = projectedConnectorParamsBySchema.get(node.data.params);
    if (cached) return cached;
    const params = Object.fromEntries(
      Object.entries(node.data.params).map(([key, param]) => [
        key,
        { ...param, type: normalizeBlockValueTypeV2(param.type) as NodeParams['type'] },
      ]),
    );
    projectedConnectorParamsBySchema.set(node.data.params, params);
    return params;
  }
  const cached = blockConnectorParamsByInstance.get(node.data.blockInstanceV2);
  const params =
    cached ??
    (() => {
      const { inputs, outputs } = blockConnectorParamsV2(node.data.blockInstanceV2);
      const result = { ...inputs, ...outputs };
      blockConnectorParamsByInstance.set(node.data.blockInstanceV2, result);
      return result;
    })();
  const optional = currentOptionalEncodingPorts(node.data.blockInstanceV2);
  return Object.keys(optional).length ? { ...params, ...optional } : params;
}

export function nodeConnectorParam(
  node: Pick<CustomNodeType, 'data'> | undefined,
  handleId: string | null | undefined,
) {
  if (!node || !handleId) return undefined;
  const crossing = parseBlockCrossingHandleV2(handleId);
  if (crossing && node.data.blockInstanceV2) return blockCrossingParamV2(node.data.blockInstanceV2, crossing);
  return nodeConnectorParams(node)[handleId];
}

export function isBlockRootV2Node(node: Pick<CustomNodeType, 'data'> | undefined) {
  return Boolean(node?.data.blockInstanceV2);
}

/**
 * Native connections may cross ownership boundaries. Commits translate their
 * exact internal endpoints to durable root handles and validate their types.
 */
export function blockV2ConnectionScopeIsAllowed(
  nodes: CustomNodeType[],
  sourceId: string | null | undefined,
  targetId: string | null | undefined,
) {
  if (!sourceId || !targetId) return false;
  return nodes.some((node) => node.id === sourceId) && nodes.some((node) => node.id === targetId);
}
