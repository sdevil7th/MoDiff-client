import { nanoid } from 'nanoid';
import type { NodeParams } from '../stores/useNodeStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { captureWorkflowOperationContext } from '../stores/useStudioStore';
import { blockOperationGraphV2, blockControlParamsV2 } from '../studio/blockRuntimeV2';
import type { BlockInstanceV2 } from '../studio/blockSchemaV2';
import { isFocusedGuidance } from './encodingNodePresentation';
import { unpackVisualOperationGroups, restoreVisualOperationGroups } from './visualOperationGroups';
import { operationGraphSignature, commitOperationGraph } from './operationGraphTransaction';
import { requestJson } from '../utils/requestJson';
import config from '../../app.config';

// Only explicitly requested metadata replies are accepted. Unique request IDs
// prevent a cancelled/late schema response from targeting a newer edit.
const pending = new Map<string, (params: Record<string, NodeParams>) => void>();
export function receiveGuidanceDefinition(id: string, params: unknown) {
  const receive = pending.get(id);
  if (!receive || !params || typeof params !== 'object' || Array.isArray(params)) return false;
  if (!Object.values(params).every((p) => p && typeof p === 'object' && !Array.isArray(p))) return false;
  receive(params as Record<string, NodeParams>);
  return true;
}

/** Read-only projection also exposes fields missing from older group interfaces.
 * Opening a saved node never rewrites its graph or reusable definition. */
export function guidanceFields(instance: BlockInstanceV2) {
  const declared = blockControlParamsV2(instance);
  return blockOperationGraphV2(instance).nodes.flatMap((stage) =>
    Object.entries(stage.data.params).flatMap(([field, param]) => {
      if (
        param.hidden ||
        param.isInput ||
        ['input', 'output'].includes(param.display ?? '') ||
        param.display?.startsWith('ui_')
      )
        return [];
      const semantic = stage.data.blockProjectionNodeId!;
      const control = instance.effectiveInterface.controls.find(
        (c) => c.binding.nodeId === semantic && c.binding.fieldId === field,
      );
      if (
        !control &&
        (instance.definitionSnapshot.controls.some(
          (c) => c.binding.nodeId === semantic && c.binding.fieldId === field,
        ) ||
          instance.presentation.removedControlBindings?.some((b) => b.nodeId === semantic && b.fieldId === field))
      )
        return []; // Deliberately removed through Configure interface.
      const id = control?.controlId ?? `${semantic}:${field}`;
      return [
        {
          id,
          field,
          stage,
          param: { ...(control ? declared[id] : param), onChange: undefined, onSignal: undefined } as NodeParams,
        },
      ];
    }),
  );
}

/** User edits use the existing graph planner and metadata endpoint, atomically. */
export async function updateGuidanceField(rootId: string, logicalId: string, value: unknown) {
  const graph = useFlowStore.getState().toObject();
  const root = graph.nodes.find((n) => n.id === rootId);
  const instance = root?.data.blockInstanceV2;
  if (!instance || !isFocusedGuidance(instance)) throw new Error('Guidance node is no longer available.');
  const control = guidanceFields(instance).find((f) => f.id === logicalId);
  if (!control || control.param.disabled) throw new Error('This Guidance control is unavailable or sealed.');
  const original = control.stage.data.params[control.field]!;
  // A dynamic node_definition can omit action hooks from its replacement fields.
  // Resolve the same registered hook used by ordinary nodes after schema refresh.
  const registered =
    useNodesStore.getState().nodesRegistry[`${control.stage.data.module}.${control.stage.data.action}`];
  const onChange = original.onChange ?? registered?.params[control.field]?.onChange;
  const callbacks = (Array.isArray(onChange) ? onChange : [onChange]).filter(
    (fn): fn is string => typeof fn === 'string',
  );
  if (!callbacks.length && instance.effectiveInterface.controls.some((c) => c.controlId === logicalId)) {
    useFlowStore
      .getState()
      .setBlockInstanceValueV2(rootId, logicalId, value as import('../studio/blockSchemaV2').BlockJsonValue);
    return;
  }
  const context = captureWorkflowOperationContext();
  const signature = operationGraphSignature(graph);
  const unpacked = unpackVisualOperationGroups(graph, new Set([rootId]));
  const next = structuredClone(unpacked.graph);
  const stage = next.nodes.find((n) => n.id === `${rootId}/${control.stage.data.blockProjectionNodeId}`)!;
  stage.data.params[control.field] = { ...original, value: value as NodeParams['value'] };
  for (const fn of callbacks) {
    const id = `guidance-schema-${nanoid()}`;
    let timer: ReturnType<typeof setTimeout>;
    const schema = new Promise<Record<string, NodeParams>>((resolve, reject) => {
      pending.set(id, resolve);
      timer = setTimeout(() => reject(new Error('Guidance metadata timed out. Nothing changed.')), 30_000);
    });
    try {
      const [, fields] = await Promise.all([
        requestJson(`${config.serverAddress}/fields/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeoutMs: 30_000,
          body: JSON.stringify({
            node: id,
            sid: useWebsocketStore.getState().sid,
            module: stage.data.module,
            action: stage.data.action,
            fn,
            fieldKey: control.field,
            values: Object.fromEntries(
              Object.entries(stage.data.params)
                .filter(([, p]) => !['input', 'output'].includes(p.display ?? ''))
                .map(([key, p]) => [key, p.value ?? p.default]),
            ),
            workflowTabId: context.workflowTabId,
            workflowCanvasEpoch: context.canvasEpoch,
          }),
          parse: (response) => {
            if (!response || typeof response !== 'object' || ('error' in response && response.error))
              throw new Error('Guidance metadata was rejected. Nothing changed.');
            return response;
          },
        }),
        schema,
      ]);
      const base = useNodesStore.getState().nodesRegistry[`${stage.data.module}.${stage.data.action}`];
      if (!base) throw new Error('Guidance registry definition is unavailable.');
      stage.data.params = Object.fromEntries(
        Object.entries({ ...base.params, ...fields }).map(([key, param]) => {
          const current = stage.data.params[key];
          // Retain the exact model's static selectors and signal contracts. Only
          // backend-returned dynamic controls adopt the replacement schema.
          return [
            key,
            {
              ...(!fields[key] && current ? current : param),
              ...(current && Object.prototype.hasOwnProperty.call(current, 'value') ? { value: current.value } : {}),
            },
          ];
        }),
      );
    } finally {
      clearTimeout(timer!);
      pending.delete(id);
    }
  }
  const restored = restoreVisualOperationGroups(next, unpacked);
  commitOperationGraph(restored, context, signature, 'Edit Guidance');
}
