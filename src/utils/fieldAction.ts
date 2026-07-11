import { FieldProps } from '../components/NodeContent';
import { useFlowStore } from '../stores/useFlowStore';
import { type NodeParamSignal, type NodeParams, useNodesStore } from '../stores/useNodeStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { enqueueSnackbar } from '../ui/snackbar';
import config from '../../app.config';
import { formatRequestError, requestJson, RequestError } from './requestJson';

type FieldActionDescriptor = {
  action?: string;
  data?: unknown;
  target?: string;
  prop?: keyof NodeParams;
  condition?: Record<string, unknown>;
};

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

export default async function fieldAction(props: FieldProps, value: unknown, event: string = 'onChange') {
  if (!props.onChange && event === 'onChange') {
    return;
  }
  if (!props.onSignal && event === 'onSignal') {
    return;
  }

  const onEvent = event === 'onChange' ? props.onChange : event === 'onSignal' ? props.onSignal : null;
  if (!onEvent) {
    return;
  }

  if (Array.isArray(onEvent)) {
    onEvent.forEach((evnt) => {
      const newProps = { ...props, [event]: evnt };
      void fieldAction(newProps, value, event);
    });
    return;
  }

  let action = 'show';
  let data: unknown = onEvent || {};
  const eventData = isRecord(onEvent) ? (onEvent as FieldActionDescriptor) : {};
  const targetField = eventData.target;

  const flowState = useFlowStore.getState();

  if (typeof data === 'string') {
    action = 'exec';
  } else if (eventData.action && ['show', 'hide', 'create', 'value', 'exec', 'signal'].includes(eventData.action)) {
    action = eventData.action || 'show';
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
        const sourceField = sourceNode.data.params[edge.sourceHandle];
        if (sourceField) {
          return sourceField.type;
        }
      }
    }

    return null;
  }

  if (action === 'exec') {
    props.updateStore(props.fieldKey, true, 'disabled');
    try {
      await execAction(
        props.nodeId,
        props.module,
        props.action,
        String(data),
        props.fieldKey,
        Boolean(props.fieldOptions?.queue),
      );
    } catch {
      props.updateStore(props.fieldKey, false, 'disabled');
    } finally {
      if (!props.fieldOptions?.queue) {
        props.updateStore(props.fieldKey, false, 'disabled');
      }
    }
  } else if (action === 'show' || action === 'hide') {
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

    const fieldVisibilityMap: Map<string, Set<string>> = new Map();
    const visibilityData = isRecord(data) ? data : {};

    for (const [key, fieldsData] of Object.entries(visibilityData)) {
      const fields = Array.isArray(fieldsData) ? fieldsData : [fieldsData];

      for (const field of fields) {
        if (typeof field !== 'string') continue;
        if (!fieldVisibilityMap.has(field)) {
          fieldVisibilityMap.set(field, new Set());
        }

        const requests = fieldVisibilityMap.get(field)!;
        if (valuesToCheckList.includes(key)) {
          if (action === 'show') {
            requests.add(props.fieldKey);
          } else {
            // action === 'hide'
            requests.delete(props.fieldKey);
          }
        }
      }
    }

    // Now update visibility based on aggregate requests
    for (const [field, requests] of fieldVisibilityMap.entries()) {
      const shouldShow = requests.size > 0;
      props.updateStore(field, !shouldShow, 'hidden');
    }
  } else if (action === 'create') {
    const node = flowState.nodes.find((n) => n.id === props.nodeId);
    const defaultDef = useNodesStore.getState().nodesRegistry[`${props.module}.${props.action}`];
    if (!node || !defaultDef) {
      return;
    }

    const createData = isRecord(data) ? data : {};
    const currData = normalizeCreatedParams(createData[String(value ?? '')]);

    Object.values(currData).forEach((param) => {
      param.value = param.value ?? param.default;
    });

    const newParams = { ...defaultDef.params, ...currData };
    // for the default params, use the current node's params value
    Object.keys(defaultDef.params).forEach((key) => {
      const currentParam = node.data.params[key];
      if (currentParam) {
        newParams[key] = currentParam;
      }
    });
    flowState.replaceNodeParams(props.nodeId, newParams);
  } else if (action === 'value') {
    if (!targetField) {
      return;
    }
    const propKey = eventData.prop || 'value';
    value = isRecord(data) ? data[String(value ?? '')] : (value ?? '');

    if (!['value', 'hidden', 'disabled', 'options', 'fieldOptions', 'display'].includes(propKey)) {
      return;
    }

    if (propKey === 'fieldOptions' && isRecord(value)) {
      const currentFieldOptions = flowState.getParam(props.nodeId, props.fieldKey, 'fieldOptions') || {};
      props.updateStore(targetField, { ...currentFieldOptions, ...value }, propKey);
    } else {
      props.updateStore(targetField, value as NodeParams[typeof propKey], propKey);
    }

    if (propKey === 'options') {
      props.updateStore(targetField, true, 'disabled');
      const targetValue = flowState.getParam(props.nodeId, targetField, 'value');
      const normTargetValue = targetValue ? (Array.isArray(targetValue) ? targetValue : [targetValue]) : [];
      const validOptions = value
        ? Array.isArray(value)
          ? value.map(String)
          : isRecord(value)
            ? Object.keys(value)
            : []
        : [];
      const filterValue = normTargetValue.filter((opt) => validOptions.includes(String(opt)));

      queueMicrotask(() => {
        props.updateStore(targetField, filterValue, 'value');
        // force a refresh by triggering the disabled state
        props.updateStore(targetField, false, 'disabled');
      });
    }
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
              { ...(targetSignal ?? signal), value: signal.value },
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
            { ...(sourceSignal ?? signal), value: signal.value },
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
) {
  const nodeValues = useFlowStore.getState().getNodeParamsValues(nodeId);

  try {
    const sid = useWebsocketStore.getState().sid;
    const url = `${config.serverAddress}/fields/action`;
    await requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: nodeId, sid, module, action, fn, values: nodeValues, fieldKey, queue }),
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
    const err = `Error running node action: ${formatRequestError(error, 'Request failed.')}`;
    enqueueSnackbar(err, { variant: 'error', autoHideDuration: err.length * 80 });
    throw new Error(err);
  }
}
