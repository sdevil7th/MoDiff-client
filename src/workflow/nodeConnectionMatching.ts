import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { nodeConnectorParams } from '../studio/nodeConnectorResolution';

export type HandleDirection = 'source' | 'target' | null | undefined;

export type ConnectionSearchOrigin = {
  handleId: string;
  node: NodeData;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function populatedOption(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : isRecord(value) && Object.keys(value).length > 0;
}

function signalActionDescriptors(onSignal: unknown) {
  return Array.isArray(onSignal) ? onSignal : [onSignal];
}

/**
 * Some component inputs use a signal-driven options map as their executable
 * compatibility contract. A source is incompatible when its declared signal
 * value has no selectable target option. This remains generic for custom
 * nodes: they opt in by publishing the same declarative onSignal metadata.
 */
function declaredSignalOptionsAreCompatible(
  signalParam: NodeParams | undefined,
  contractParam: NodeParams | undefined,
) {
  const signalValue = signalParam?.signal?.value;
  if (signalValue === undefined || signalValue === null || signalValue === '') return true;

  return signalActionDescriptors(contractParam?.onSignal).every((descriptor) => {
    if (
      !isRecord(descriptor) ||
      descriptor.action !== 'value' ||
      descriptor.prop !== 'options' ||
      !isRecord(descriptor.data)
    )
      return true;
    return populatedOption(descriptor.data[String(signalValue)]);
  });
}

/**
 * Evaluate the backend's connector-level semantic contract. String-valued
 * signals use an exact allowlist; structured pipeline contracts expose action
 * names and the modes supported by each action. An empty declared signal is a
 * pending model selection, while a connector with no signal declaration is not
 * a valid source for a contract that explicitly requires one.
 */
function declaredSignalCompatibilityIsSatisfied(
  signalParam: NodeParams | undefined,
  contractParam: NodeParams | undefined,
  contractNode: NodeData,
) {
  const declaration = contractParam?.signalCompatibility;
  if (!declaration) return true;
  if (declaration.role) {
    const acceptedRoles = Array.isArray(declaration.role) ? declaration.role : [declaration.role];
    if (!signalParam?.connectionRole || !acceptedRoles.includes(signalParam.connectionRole)) return false;
  }
  const signal = signalParam?.signal;
  if (!signal) return declaration.required !== true;
  const signalValue = signal.value;
  if (signalValue === undefined || signalValue === null || signalValue === '') return true;

  if (declaration.values) {
    if (typeof signalValue !== 'string') return true;
    return populatedOption(declaration.values[signalValue]);
  }

  if (declaration.action) {
    if (!isRecord(signalValue)) return false;
    const actions = isRecord(signalValue.connectionActions) ? signalValue.connectionActions : signalValue.actions;
    if (!isRecord(actions)) return false;
    const action = declaration.action === '$node' ? contractNode.action : declaration.action;
    const modes = actions[action];
    if (!Array.isArray(modes) || modes.length === 0) return false;
    return typeof signalValue.mode !== 'string' || modes.includes(signalValue.mode);
  }

  return true;
}

/**
 * A pipeline port's nominal type describes its transport object. The loader's
 * signal additionally declares which task actions that selected object can
 * perform. Use that capability when both endpoints expose enough metadata,
 * while leaving opaque/custom contracts to their normal runtime validation.
 */
export function nodeConnectionSemanticsAreCompatible(
  sourceNode: NodeData,
  sourceHandleId: string,
  targetNode: NodeData,
  targetHandleId: string,
) {
  const sourceParam = nodeConnectorParams({ data: sourceNode })[sourceHandleId];
  const targetParam = nodeConnectorParams({ data: targetNode })[targetHandleId];
  if (
    !declaredSignalOptionsAreCompatible(sourceParam, targetParam) ||
    !declaredSignalOptionsAreCompatible(targetParam, sourceParam) ||
    !declaredSignalCompatibilityIsSatisfied(sourceParam, targetParam, targetNode) ||
    !declaredSignalCompatibilityIsSatisfied(targetParam, sourceParam, sourceNode)
  )
    return false;
  return true;
}

/** Use the same endpoint and type rules for suggestions and the inserted wire. */
export function matchingNodeHandleForDrop(
  node: NodeData,
  dataType: NodeParams['type'] | null,
  handleType: HandleDirection,
  origin?: ConnectionSearchOrigin | null,
) {
  if (handleType !== 'source' && handleType !== 'target') return undefined;
  return Object.entries(nodeConnectorParams({ data: node })).find(([handleId, param]) => {
    if (handleType === 'source') {
      return (
        (param.display === 'input' || param.isInput) &&
        param.display !== 'output' &&
        connectionTypesAreCompatible(dataType, param.type) &&
        (!origin || nodeConnectionSemanticsAreCompatible(origin.node, origin.handleId, node, handleId))
      );
    }
    return (
      param.display === 'output' &&
      connectionTypesAreCompatible(param.type, dataType) &&
      (!origin || nodeConnectionSemanticsAreCompatible(node, handleId, origin.node, origin.handleId))
    );
  });
}
