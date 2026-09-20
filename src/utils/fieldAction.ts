// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import type { FieldProps } from '../components/NodeContent';
import { useFlowStore } from '../stores/useFlowStore';
import { type NodeParamSignal, type NodeParams, useNodesStore } from '../stores/useNodeStore';
import {
  captureWorkflowOperationContext,
  useStudioStore,
  workflowOperationContextIsCurrent,
} from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { enqueueSnackbar } from '../ui/snackbar';
import config from '../../app.config';
import { beginManagedGraphSchemaMutation, finishManagedGraphSchemaMutation } from './managedGraphSchemaMutation';
import { formatRequestError, requestJson, RequestError } from './requestJson';
import { nodeConnectorParam } from '../studio/nodeConnectorResolution';

type FieldActionDescriptor = {
  action?: string;
  data?: unknown;
  target?: string;
  prop?: keyof NodeParams;
  condition?: Record<string, unknown>;
};

const automaticSignalActionSuppressions = new Map<string, NodeParamSignal>();

function signalActionKey(nodeId: string, fieldKey: string) {
  return `${nodeId}\0${fieldKey}`;
}

/**
 * Prevent HandleField's effect from duplicating a signal action that a managed
 * graph finalizer is about to dispatch and await itself. The exact signal
 * object is used as the token, so a later edge/user signal is never skipped.
 */
export function suppressNextAutomaticSignalFieldAction(nodeId: string, fieldKey: string, signal: NodeParamSignal) {
  automaticSignalActionSuppressions.set(signalActionKey(nodeId, fieldKey), signal);
}

export function consumeAutomaticSignalFieldActionSuppression(
  nodeId: string,
  fieldKey: string,
  signal: NodeParamSignal | undefined,
) {
  const key = signalActionKey(nodeId, fieldKey);
  const expected = automaticSignalActionSuppressions.get(key);
  if (expected !== signal) {
    if (expected !== undefined) automaticSignalActionSuppressions.delete(key);
    return false;
  }
  automaticSignalActionSuppressions.delete(key);
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeCreatedParams(value: unknown): Record<string, NodeParams> {
  if (!isRecord(value)) return {};

  const params: Record<string, NodeParams> = {};
  Object.entries(value).forEach(([key, param]) => {
    if (isRecord(param)) {
      params[key] = { ...param } as NodeParams;
    }
  });
  return params;
}

function fieldTypeForParam(param: NodeParams) {
  const display = param.isInput ? 'input' : param.display || '';
  const type = Array.isArray(param.type) ? (param.type[0] ?? 'string') : (param.type ?? 'string');
  const dataType = String(type).toLowerCase();

  if (display === 'input' || display === 'output') return display;
  if (dataType.startsWith('bool')) return display === 'checkbox' || display === 'icontoggle' ? display : 'switch';
  if (display.startsWith('ui_')) return display;
  if (dataType === 'text' || display.startsWith('text')) return 'textarea';
  if (display) return display;
  if (param.options && typeof param.options === 'object') return 'select';
  if (dataType.startsWith('int') || dataType === 'float' || dataType === 'number')
    return display === 'slider' ? 'slider' : 'number';
  return 'text';
}

/** Build the generic field-action adapter for any node in the visible graph. */
export function buildFieldActionProps(nodeId: string, fieldKey: string): FieldProps | null {
  const node = useFlowStore.getState().nodes.find((candidate) => candidate.id === nodeId);
  const param = nodeConnectorParam(node, fieldKey);
  if (!node || !param) return null;

  const display = param.isInput ? 'input' : param.display || '';
  const dataType = String(Array.isArray(param.type) ? (param.type[0] ?? 'string') : (param.type ?? 'string'));
  return {
    nodeId,
    workflowContext: captureWorkflowOperationContext(),
    fieldKey,
    label: param.label ?? fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1),
    display,
    disabled: param.disabled || false,
    hidden: param.hidden || false,
    style: param.style || {},
    value: param.value ?? param.default,
    default: param.default,
    options: param.options || [],
    optionsSource: param.optionsSource || {},
    dataType,
    fieldType: fieldTypeForParam(param),
    updateStore: (paramKey, value, key) => useFlowStore.getState().setParam(nodeId, paramKey, value, key),
    module: node.data.module,
    action: node.data.action,
    isConnected: display === 'input' || display === 'output' ? param.isConnected || false : undefined,
    onChange: param.onChange,
    min: param.min,
    max: param.max,
    step: param.step,
    fieldOptions: param.fieldOptions || {},
    onSignal: param.onSignal,
    signal: param.signal,
  };
}

export type FieldActionWorkflowScope = 'form' | 'canvas';

export type FieldActionOptions = {
  /**
   * Dynamic actions normally belong to the exact Studio form revision that
   * dispatched them. The registered Block compiler is different: it runs on
   * an isolated, unique transient graph while Studio may legitimately rebase
   * its form from the first published schema. That compiler explicitly opts
   * into canvas scope while retaining session, workflow-tab, and canvas-epoch
   * ownership.
   */
  workflowScope?: FieldActionWorkflowScope;
  /** Propagate backend failures to an enclosing managed transaction. */
  propagateErrors?: boolean;
  /**
   * Bound one backend field-action request when the caller owns a shorter
   * transaction deadline. Interactive Modular actions retain the generous
   * default; the isolated registered Block compiler supplies its own bounded
   * deadline so a hidden compiler node cannot leave insertion pending for two
   * minutes with no visible node or actionable error.
   */
  timeoutMs?: number;
};

export default async function fieldAction(
  props: FieldProps,
  value: unknown,
  event: string = 'onChange',
  options: FieldActionOptions = {},
) {
  const workflowContext = props.workflowContext ?? captureWorkflowOperationContext();
  const isCurrent = () => workflowOperationContextIsCurrent(workflowContext, { includeForm: false });
  if (!isCurrent()) return;
  const updateStore = props.updateFieldActionStore ?? props.updateStore;
  props = {
    ...props,
    workflowContext,
    updateStore: (...args) => {
      if (isCurrent()) updateStore(...args);
    },
  };
  const onEvent = event === 'onChange' ? props.onChange : event === 'onSignal' ? props.onSignal : null;
  if (!onEvent) {
    return;
  }

  if (Array.isArray(onEvent)) {
    await Promise.all(
      onEvent.map((evnt) => {
        const newProps = { ...props, [event]: evnt };
        return fieldAction(newProps, value, event, options);
      }),
    );
    return;
  }

  let action = 'show';
  let data: unknown = onEvent;
  const eventData = isRecord(onEvent) ? (onEvent as FieldActionDescriptor) : {};
  const targetField = eventData.target;

  const flowState = useFlowStore.getState();

  if (typeof data === 'string') {
    action = 'exec';
  } else if (eventData.action && ['show', 'hide', 'create', 'value', 'exec', 'signal'].includes(eventData.action)) {
    action = eventData.action;
    if (eventData.data !== undefined) {
      data = eventData.data;
    }
  }

  function getSourceHandleType() {
    // follow the edge connection to get the output type
    const edge = flowState.edges.find((e) => e.target === props.nodeId && e.targetHandle === props.fieldKey);
    if (edge && edge.sourceHandle) {
      const sourceNode = flowState.nodes.find((n) => n.id === edge.source);
      if (sourceNode) {
        const sourceField = nodeConnectorParam(sourceNode, edge.sourceHandle);
        if (sourceField) {
          return sourceField.type;
        }
      }
    }

    return null;
  }

  if (action === 'exec') {
    // React can flush a departing canvas's passive effects after the new graph
    // is installed. Never turn an absent/replaced node into an empty request.
    const node = flowState.nodes.find((candidate) => candidate.id === props.nodeId);
    if (
      !node ||
      node.data.module !== props.module ||
      node.data.action !== props.action ||
      !nodeConnectorParam(node, props.fieldKey)
    )
      return;
    props.updateStore(props.fieldKey, true, 'disabled');
    try {
      await execAction(
        props.nodeId,
        props.module,
        props.action,
        String(data),
        props.fieldKey,
        Boolean(props.fieldOptions?.queue),
        options.workflowScope,
        options.timeoutMs,
      );
    } catch (error) {
      props.updateStore(props.fieldKey, false, 'disabled');
      if (options.propagateErrors) throw error;
    } finally {
      if (!props.fieldOptions?.queue) {
        props.updateStore(props.fieldKey, false, 'disabled');
      }
    }
  } else if (action === 'show' || action === 'hide') {
    const schemaPending = beginManagedGraphSchemaMutation(props.nodeId, ['hidden']);
    // This logic should be outside the loop as it should only be evaluated once.
    let valuesToCheck = value;

    // handle special case when a node is created with the input already connected
    if (
      event === 'onChange' &&
      props.fieldType === 'input' &&
      props.isConnected &&
      eventData.condition &&
      eventData.condition.type !== getSourceHandleType()
    ) {
      valuesToCheck = valuesToCheck === 'true' ? 'false' : 'true';
    }

    const valuesToCheckList = Array.isArray(valuesToCheck) ? valuesToCheck : [valuesToCheck];

    const fieldVisibilityMap = new Map<string, boolean>();
    const visibilityData = isRecord(data) ? data : {};

    for (const [key, fieldsData] of Object.entries(visibilityData)) {
      const fields = Array.isArray(fieldsData) ? fieldsData : [fieldsData];
      const matches = valuesToCheckList.includes(key);

      for (const field of fields) {
        if (typeof field !== 'string') continue;
        fieldVisibilityMap.set(field, Boolean(fieldVisibilityMap.get(field) || matches));
      }
    }

    for (const [field, matches] of fieldVisibilityMap) {
      const shouldShow = action === 'show' ? matches : !matches;
      props.updateStore(field, !shouldShow, 'hidden');
    }
    if (schemaPending) finishManagedGraphSchemaMutation();
  } else if (action === 'create') {
    const node = flowState.nodes.find((n) => n.id === props.nodeId);
    const defaultDef = useNodesStore.getState().nodesRegistry[`${props.module}.${props.action}`];
    if (!node || !defaultDef) {
      return;
    }
    const schemaPending = beginManagedGraphSchemaMutation(props.nodeId);

    const createData = isRecord(data) ? data : {};
    const currData = normalizeCreatedParams(createData[String(value ?? '')]);

    Object.values(currData).forEach((param) => {
      param.value = param.value ?? param.default;
    });

    const newParams = Object.fromEntries(
      Object.entries({ ...defaultDef.params, ...currData }).map(([key, param]) => [
        key,
        { ...param, signal: param.signal ? { ...param.signal } : undefined },
      ]),
    );
    // Keep runtime values while accepting the authoritative created schema.
    Object.keys(defaultDef.params).forEach((key) => {
      const currentParam = node.data.params[key];
      const nextParam = newParams[key];
      if (!currentParam || !nextParam) return;
      if (Object.prototype.hasOwnProperty.call(currentParam, 'value')) nextParam.value = currentParam.value;
      if (Object.prototype.hasOwnProperty.call(currentParam, 'artifacts')) nextParam.artifacts = currentParam.artifacts;
      if (currentParam.signal && nextParam.signal) {
        nextParam.signal = { ...nextParam.signal, value: currentParam.signal.value };
      }
    });
    flowState.replaceNodeParams(props.nodeId, newParams);
    if (schemaPending) finishManagedGraphSchemaMutation();
  } else if (action === 'value') {
    if (!targetField) {
      return;
    }
    const propKey = eventData.prop || 'value';
    // A value action without an explicit mapping is a generic passthrough.
    // Do not mistake the action descriptor itself for a model/value map.
    value = isRecord(eventData.data) ? eventData.data[String(value ?? '')] : (value ?? '');

    if (!['value', 'hidden', 'disabled', 'options', 'fieldOptions', 'display'].includes(propKey)) {
      return;
    }

    const schemaPending = ['hidden', 'fieldOptions', 'display'].includes(propKey)
      ? beginManagedGraphSchemaMutation(props.nodeId, [propKey])
      : false;

    if (propKey === 'fieldOptions' && isRecord(value)) {
      const currentFieldOptions = flowState.getParam(props.nodeId, targetField, 'fieldOptions') || {};
      props.updateStore(targetField, { ...currentFieldOptions, ...value }, propKey);
    } else {
      props.updateStore(targetField, value as NodeParams[typeof propKey], propKey);
    }

    if (propKey === 'options') {
      props.updateStore(targetField, true, 'disabled');
      const targetValue = flowState.getParam(props.nodeId, targetField, 'value');
      const targetIsMultiple = !!flowState.getParam(props.nodeId, targetField, 'fieldOptions')?.multiple;
      const normTargetValue = targetValue ? (Array.isArray(targetValue) ? targetValue : [targetValue]) : [];
      const validOptions = Array.isArray(value) ? value.map(String) : isRecord(value) ? Object.keys(value) : [];
      const filterValue = normTargetValue.filter((opt) => validOptions.includes(String(opt)));

      queueMicrotask(() => {
        if (!isCurrent()) return;
        props.updateStore(targetField, targetIsMultiple ? filterValue : (filterValue[0] ?? ''), 'value');
        // force a refresh by triggering the disabled state
        props.updateStore(targetField, false, 'disabled');
      });
    }
    if (schemaPending) finishManagedGraphSchemaMutation();
  } else if (action === 'signal') {
    // check if the target field is an input or output field
    if (!targetField) {
      return;
    }

    const targetFieldType = flowState.getParam(props.nodeId, targetField, 'display');
    if (!targetFieldType || (targetFieldType !== 'input' && targetFieldType !== 'output')) {
      return;
    }

    const signal: NodeParamSignal = {
      direction: targetFieldType,
      origin: props.fieldKey,
      value: value,
    };

    props.updateStore(targetField, signal, 'signal');
  }
}

export function relaySignal(nodeId: string, fieldKey: string, signal: NodeParamSignal | undefined) {
  if (!signal) {
    return;
  }

  const flowState = useFlowStore.getState();

  if (signal.direction === 'output') {
    const outgoers = flowState.edges.filter((e) => e.source === nodeId && e.sourceHandle === fieldKey);
    if (outgoers.length > 0) {
      outgoers.forEach((edge) => {
        const targetNodeId = edge.target;
        const targetFieldKey = edge.targetHandle;
        if (targetNodeId && targetFieldKey) {
          const targetSignal = flowState.getParam(targetNodeId, targetFieldKey, 'signal');
          if (!targetSignal || targetSignal.origin === undefined) {
            flowState.setParam(
              targetNodeId,
              targetFieldKey,
              { ...(targetSignal ?? signal), origin: undefined, value: signal.value },
              'signal',
            );
          }
        }
      });
      return;
    }
  }

  if (signal.direction === 'input') {
    const incomer = flowState.edges.find((e) => e.target === nodeId && e.targetHandle === fieldKey);
    if (incomer) {
      const sourceNodeId = incomer.source;
      const sourceFieldKey = incomer.sourceHandle;
      if (sourceNodeId && sourceFieldKey) {
        const sourceSignal = flowState.getParam(sourceNodeId, sourceFieldKey, 'signal');
        if (!sourceSignal || sourceSignal.origin === undefined) {
          flowState.setParam(
            sourceNodeId,
            sourceFieldKey,
            { ...(sourceSignal ?? signal), origin: undefined, value: signal.value },
            'signal',
          );
        }
      }
    }
  }
}

async function execAction(
  nodeId: string,
  module: string,
  action: string,
  fn: string,
  fieldKey?: string,
  queue?: boolean,
  workflowScope: FieldActionWorkflowScope = 'form',
  timeoutMs = 120_000,
) {
  const nodeValues = useFlowStore.getState().getNodeParamsValues(nodeId);
  const workflowContext = captureWorkflowOperationContext();
  // Background schema updates belong to this document. Abort their HTTP waits
  // when it leaves, freeing browser connections for the next canvas/navigation.
  // Queued user actions keep their acknowledgement and execution ownership.
  const controller = queue ? null : new AbortController();
  const abort = () => controller?.abort();
  const unsubscribe = controller
    ? useStudioStore.subscribe(() => {
        if (!workflowOperationContextIsCurrent(workflowContext, { includeForm: workflowScope !== 'canvas' })) abort();
      })
    : undefined;
  if (controller && typeof window !== 'undefined') window.addEventListener?.('beforeunload', abort);

  try {
    const sid = useWebsocketStore.getState().sid;
    const url = `${config.serverAddress}/fields/action`;
    await requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Dynamic Modular schemas can require several browser/backend signal
      // round trips while a large graph is publishing definitions. The
      // backend remains bounded per signal; do not abort the enclosing action
      // at the generic 15-second request default.
      timeoutMs,
      signal: controller?.signal,
      body: JSON.stringify({
        node: nodeId,
        sid,
        module,
        action,
        fn,
        values: nodeValues,
        fieldKey,
        queue,
        workflowTabId: workflowContext.workflowTabId,
        workflowCanvasEpoch: workflowContext.canvasEpoch,
        // Canvas-scoped actions are reserved for the isolated registered
        // Block compiler. Omitting (rather than falsifying) this field lets
        // the backend echo an explicit tab+canvas ownership receipt while a
        // legitimate Studio-form rebase occurs during the same action batch.
        workflowFormEpoch: workflowScope === 'canvas' ? undefined : workflowContext.formEpoch,
      }),
      parse: (value) => {
        if (!isRecord(value)) throw new Error('The node action returned an invalid response.');
        if (value.error) {
          const message =
            typeof value.message === 'string'
              ? value.message
              : typeof value.error === 'string'
                ? value.error
                : 'Failed to run node action';
          throw new RequestError(message, { kind: 'application', url, payload: value });
        }
        return value;
      },
    });
  } catch (error) {
    if (controller?.signal.aborted) return;
    // The originating graph owns the result, including its error notification.
    // Backend websocket schema updates carry the same ownership receipt.
    if (!workflowOperationContextIsCurrent(workflowContext, { includeForm: workflowScope !== 'canvas' })) return;
    const err = `Error running node action: ${formatRequestError(error, 'Request failed.')}`;
    enqueueSnackbar(err, { variant: 'error', autoHideDuration: err.length * 80 });
    throw new Error(err);
  } finally {
    unsubscribe?.();
    if (controller && typeof window !== 'undefined') window.removeEventListener?.('beforeunload', abort);
  }
}
