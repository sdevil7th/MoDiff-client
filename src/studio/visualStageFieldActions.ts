import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import { blockControlBindingV2 } from './blockControlConnectionsV2';
import { blockConnectionTargetsV2 } from './blockCrossingConnectionsV2';
import {
  blockControlParamsV2,
  blockOperationGraphV2,
  blockProjectionNodeIdV2,
  replaceBlockEffectiveInterfaceV2,
} from './blockRuntimeV2';
import type { BlockInstanceV2 } from './blockSchemaV2';
import { hasInlineScalarControl } from './inlineScalarControl';
import { nodeConnectorParam } from './nodeConnectorResolution';

type VisualStageFieldSource = { node: CustomNodeType; fieldKey: string; param: NodeParams };
type VisualStageFieldRequest = { nodeId: string; fieldKey: string; module: string; action: string };

/** Dynamic native contracts can make a previously hidden editor applicable.
 * Add its ordinary-stage exposure without changing values, wires or the
 * reusable definition. Explicit interface removals remain the user's choice. */
export function exposeVisualStageControl(instance: BlockInstanceV2, nodeId: string, fieldId: string) {
  if (
    instance.definitionSnapshot.ownership.kind !== 'user' ||
    !instance.definitionSnapshot.source.provider?.startsWith('modiff.visual-stages.')
  )
    return instance;
  const member = instance.effectiveGraph.nodes.find((node) => node.nodeId === nodeId);
  const param = (member?.data.params as Record<string, NodeParams> | undefined)?.[fieldId];
  if (
    !param ||
    param.hidden ||
    param.signal ||
    param.display?.startsWith('ui_') ||
    ['input', 'output'].includes(param.display ?? '') ||
    (param.isInput && !hasInlineScalarControl(param)) ||
    instance.effectiveGraph.edges.some((edge) => edge.targetNodeId === nodeId && edge.targetPortId === fieldId) ||
    instance.effectiveInterface.controls.some((control) =>
      [control.binding, ...(control.mirrorBindings ?? [])].some(
        (binding) => binding.nodeId === nodeId && binding.fieldId === fieldId,
      ),
    ) ||
    instance.definitionSnapshot.controls.some(
      (control) => control.binding.nodeId === nodeId && control.binding.fieldId === fieldId,
    ) ||
    instance.presentation.removedControlBindings?.some(
      (binding) => binding.nodeId === nodeId && binding.fieldId === fieldId,
    )
  )
    return instance;
  const valueType = Array.isArray(param.type) ? param.type.join('|') : param.type;
  if (!valueType) return instance;
  const controlId = `${nodeId}:${fieldId}`;
  if (instance.effectiveInterface.controls.some((control) => control.controlId === controlId)) return instance;
  const value = param.value ?? param.default;
  return replaceBlockEffectiveInterfaceV2(instance, {
    boundary: instance.effectiveInterface.boundary,
    controls: [
      ...instance.effectiveInterface.controls,
      {
        controlId,
        label: param.label?.trim() || fieldId,
        valueType,
        order: instance.effectiveInterface.controls.length,
        binding: { nodeId, fieldId },
        ...(value === undefined ? {} : { defaultValue: JSON.parse(JSON.stringify(value)) }),
        group: String(member?.data.label || 'Settings'),
      },
    ],
  });
}

/** Ordinary visual stages keep the native field-action owner even while hidden.
 * Registered, sealed Blocks retain their separate reviewed editing policy. */
export function visualStageRuntimeNode(nodes: CustomNodeType[], id: string) {
  const matches = nodes.flatMap((root) => {
    const instance = root.data.blockInstanceV2;
    if (
      !instance ||
      root.id !== instance.instanceId ||
      instance.definitionSnapshot.ownership.kind !== 'user' ||
      !instance.definitionSnapshot.source.provider?.startsWith('modiff.visual-stages.')
    )
      return [];
    const stage = instance.effectiveGraph.nodes.find(
      (candidate) => blockProjectionNodeIdV2(instance.instanceId, candidate.nodeId) === id,
    );
    return stage ? [{ root, instance, stage }] : [];
  });
  return matches.length === 1 ? matches[0]! : null;
}

export function visualStageFieldSources(
  nodes: CustomNodeType[],
  props: VisualStageFieldRequest,
): VisualStageFieldSource[] | null {
  return resolveVisualStageFieldSources(nodes, props, new Set());
}

function resolveVisualStageFieldSources(
  nodes: CustomNodeType[],
  props: VisualStageFieldRequest,
  ancestors: ReadonlySet<string>,
): VisualStageFieldSource[] | null {
  const identity = JSON.stringify([props.nodeId, props.fieldKey]);
  if (ancestors.has(identity)) return null;
  const path = new Set(ancestors).add(identity);
  const visible = nodes.find((node) => node.id === props.nodeId);
  const runtime = visualStageRuntimeNode(nodes, props.nodeId);
  const fieldKey = props.fieldKey;
  const renderedParam = visible?.data.params[fieldKey];
  const declaredControl =
    renderedParam?.fieldOptions?.blockContainerControlV1 !== undefined ||
    (renderedParam?.fieldOptions?.blockBindingV2 as { direction?: unknown } | undefined)?.direction === 'control';
  // A projected container is an interface, not a native callback owner. Its
  // declared local controls must resolve through the owning Block just like
  // controls on a collapsed root, including another nested visual stage.
  if (
    ((!runtime && (visible?.data.blockInstanceV2 || visible?.data.blockProjectionContainer === true)) ||
      (visible?.data.blockProjectionContainer === true && declaredControl)) &&
    visible?.data.module === props.module &&
    visible.data.action === props.action
  ) {
    const param =
      (visible.data.blockInstanceV2 ? blockControlParamsV2(visible.data.blockInstanceV2)[fieldKey] : undefined) ??
      nodeConnectorParam(visible, fieldKey);
    if (!param) return null;
    const bound = blockControlBindingV2(visible, fieldKey, param, nodes);
    const owner = visible.data.blockInstanceV2
      ? visible
      : nodes.find((node) => node.id === visible.data.blockProjectionOwnerId);
    const instance = owner?.data.blockInstanceV2;
    const targets = bound
      ? [bound.control.binding, ...(bound.control.mirrorBindings ?? [])].map((binding) => ({
          nodeId: binding.nodeId,
          fieldOrPortId: binding.fieldId,
        }))
      : param.display === 'input' || param.display === 'output'
        ? blockConnectionTargetsV2(visible, fieldKey, param.display)
        : [];
    if (!instance || !targets.length) return null;
    const sources = targets.map(
      (target) =>
        resolveVisualStageFieldSources(
          nodes,
          {
            nodeId: blockProjectionNodeIdV2(instance.instanceId, target.nodeId),
            fieldKey: target.fieldOrPortId,
            module: String(instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === target.nodeId)?.data.module),
            action: String(instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === target.nodeId)?.data.action),
          },
          path,
        )?.[0],
    );
    return sources.every((source) => source !== undefined) ? sources.filter((source) => source !== undefined) : null;
  }
  if (!runtime) return null;
  const node = blockOperationGraphV2(runtime.instance).nodes.find(
    (candidate) => candidate.data.blockProjectionNodeId === runtime!.stage.nodeId,
  );
  const param: NodeParams | undefined = node?.data.params[fieldKey];
  if (!node || !param) return null;
  // A stale native renderer cannot invoke a replacement node's callback.
  if (props.nodeId === node.id && (props.module !== node.data.module || props.action !== node.data.action)) return null;
  return [{ node, fieldKey, param }];
}

export function visualStageFieldSource(
  nodes: CustomNodeType[],
  props: { nodeId: string; fieldKey: string; module: string; action: string },
) {
  return visualStageFieldSources(nodes, props)?.[0] ?? null;
}
