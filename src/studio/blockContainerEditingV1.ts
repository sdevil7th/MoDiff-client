import {
  blockGraphSubtreeNodeIdsV2,
  canonicalBlockStringifyV2,
  normalizeBlockContainerInterfaceV1,
  normalizeBlockInstanceV2,
  type BlockContainerInterfaceV1,
  type BlockControlV2,
  type BlockInstanceV2,
  type BlockJsonValue,
} from './blockSchemaV2';
import {
  blockContainerControlTargetsV1,
  blockContainerFieldV1,
  blockContainerFieldValueV1,
  blockContainerInterfaceV1,
  blockContainerPortTargetsV1,
} from './blockContainerInterfaceV1';
import {
  blockOperationGraphV2,
  blockProjectionNodeIdV2,
  replaceBlockEffectiveGraphV2,
  setBlockInstanceValueV2,
} from './blockRuntimeV2';
import { sharedOperationInput } from '../workflow/operationSharedInputs';

function sameBindings(
  a: { binding: unknown; mirrorBindings?: unknown },
  b: { binding: unknown; mirrorBindings?: unknown },
) {
  return (
    canonicalBlockStringifyV2([a.binding, a.mirrorBindings ?? []]) ===
    canonicalBlockStringifyV2([b.binding, b.mirrorBindings ?? []])
  );
}

/** Return real edge impacts even while their leaves are hidden by disclosure. */
export function blockContainerInterfaceEdgeImpactsV1(
  instance: BlockInstanceV2,
  ownerNodeId: string,
  value: BlockContainerInterfaceV1,
) {
  const previous = blockContainerInterfaceV1(instance, ownerNodeId);
  const included = blockGraphSubtreeNodeIdsV2(instance.effectiveGraph, ownerNodeId);
  return instance.effectiveGraph.edges.filter((edge) => {
    for (const direction of ['input', 'output'] as const) {
      const nodeId = direction === 'input' ? edge.targetNodeId : edge.sourceNodeId;
      const fieldId = direction === 'input' ? edge.targetPortId : edge.sourcePortId;
      const opposite = direction === 'input' ? edge.sourceNodeId : edge.targetNodeId;
      if (!included.has(nodeId) || (nodeId !== ownerNodeId && included.has(opposite))) continue;
      const side = direction === 'input' ? 'inputs' : 'outputs';
      const prior = previous.boundary[side].find((port) =>
        blockContainerPortTargetsV1(port).some((b) => b.nodeId === nodeId && b.fieldOrPortId === fieldId),
      );
      const candidate = prior && value.boundary[side].find(({ portId }) => portId === prior.portId);
      if (!candidate || !sameBindings(prior!, candidate)) return true;
    }
    return false;
  });
}

export function configureBlockContainerInterfaceV1(
  instanceValue: BlockInstanceV2,
  ownerNodeId: string,
  draft: Pick<BlockContainerInterfaceV1, 'boundary' | 'controls' | 'previews'>,
) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const previous = blockContainerInterfaceV1(instance, ownerNodeId);
  const previews = draft.previews ?? previous.previews;
  const controls = draft.controls.map((control) => {
    const view: BlockControlV2 = structuredClone(control);
    delete view.defaultValue;
    return view;
  });
  const nextInterface = normalizeBlockContainerInterfaceV1(
    {
      schemaVersion: 1,
      boundary: draft.boundary,
      controls,
      ...(previews === undefined ? {} : { previews }),
    },
    instance.effectiveGraph,
    ownerNodeId,
  );
  for (const sealed of previous.controls.filter(({ sealed }) => sealed)) {
    const next = nextInterface.controls.find(({ controlId }) => controlId === sealed.controlId);
    if (!next || !next.sealed || next.valueType !== sealed.valueType || !sameBindings(sealed, next))
      throw new Error(`Cannot remove or rebind sealed internal control ${sealed.label}.`);
  }
  const impacts = blockContainerInterfaceEdgeImpactsV1(instance, ownerNodeId, nextInterface);
  if (impacts.length)
    throw new Error(
      `This internal interface would change ${impacts.length} connected edge(s). Disconnect them before removing or rebinding their ports.`,
    );
  const graph = structuredClone(instance.effectiveGraph);
  const owner = graph.nodes.find(({ nodeId }) => nodeId === ownerNodeId)!;
  if (canonicalBlockStringifyV2(owner.containerInterface ?? null) === canonicalBlockStringifyV2(nextInterface))
    return instance;
  owner.containerInterface = nextInterface;
  return replaceBlockEffectiveGraphV2(instance, graph);
}

/** A container control writes the original fields/root values atomically, never local shadow values. */
export function setBlockContainerControlValueV1(
  instanceValue: BlockInstanceV2,
  ownerNodeId: string,
  controlId: string,
  value: BlockJsonValue | undefined,
) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const control = blockContainerInterfaceV1(instance, ownerNodeId).controls.find(
    (entry) => entry.controlId === controlId,
  );
  if (!control) throw new Error('This internal control is stale. Reopen the Block before editing it.');
  const targets = blockContainerControlTargetsV1(control);
  if (
    targets.every(({ nodeId, fieldId }) => {
      const current = blockContainerFieldValueV1(instance, nodeId, fieldId);
      return current === undefined || value === undefined
        ? current === value
        : canonicalBlockStringifyV2(current) === canonicalBlockStringifyV2(value);
    })
  )
    return instance;
  if (control.sealed) throw new Error(`Cannot change sealed internal control ${control.label}.`);
  return setBlockSharedOperationInputV2(instance, targets, value) ?? setBlockFieldValuesV1(instance, targets, value);
}

/** Shared generic inputs use the same canonical field/value writers as public controls. */
export function setBlockSharedOperationInputV2(
  instance: BlockInstanceV2,
  targets: Array<{ nodeId: string; fieldId: string }>,
  value: BlockJsonValue | undefined,
): BlockInstanceV2 | null {
  if (
    !targets.some(
      (target) => instance.effectiveGraph.nodes.find((n) => n.nodeId === target.nodeId)?.data.operationAuthoring,
    )
  )
    return null;
  const graph = blockOperationGraphV2(instance);
  const expanded = [...targets];
  let found = false;
  for (const target of targets) {
    const group = sharedOperationInput(
      graph.nodes,
      graph.edges,
      blockProjectionNodeIdV2(instance.instanceId, target.nodeId),
      target.fieldId,
    );
    if (!group) continue;
    found = true;
    for (const member of group.members) {
      const nodeId = member.node.data.blockProjectionNodeId!;
      if (!expanded.some((t) => t.nodeId === nodeId && t.fieldId === member.field))
        expanded.push({ nodeId, fieldId: member.field });
    }
  }
  return found ? setBlockFieldValuesV1(instance, expanded, value) : null;
}

function setBlockFieldValuesV1(
  instance: BlockInstanceV2,
  targets: Array<{ nodeId: string; fieldId: string }>,
  value: BlockJsonValue | undefined,
) {
  const controls = [
    ...instance.effectiveInterface.controls,
    ...instance.effectiveGraph.nodes.flatMap((n) => n.containerInterface?.controls ?? []),
  ];
  if (
    controls.some(
      (control) =>
        control.sealed &&
        blockContainerControlTargetsV1(control).some((b) =>
          targets.some((t) => t.nodeId === b.nodeId && t.fieldId === b.fieldId),
        ),
    )
  )
    throw new Error('Cannot change a shared input bound to a sealed Block control.');
  const rootIds = new Set<string>();
  const directTargets: typeof targets = [];
  for (const target of targets) {
    let rootBound = false;
    for (const rootControl of instance.effectiveInterface.controls) {
      if (
        blockContainerControlTargetsV1(rootControl).some(
          (b) => b.nodeId === target.nodeId && b.fieldId === target.fieldId,
        )
      ) {
        rootIds.add(rootControl.controlId);
        rootBound = true;
      }
    }
    for (const rootPort of instance.effectiveInterface.boundary.inputs) {
      if (
        blockContainerPortTargetsV1(rootPort).some(
          (b) => b.nodeId === target.nodeId && b.fieldOrPortId === target.fieldId,
        )
      ) {
        rootIds.add(rootPort.portId);
        rootBound = true;
      }
    }
    if (!rootBound) directTargets.push(target);
  }
  for (const rootId of rootIds) {
    if (value === undefined) throw new Error('A shared Block control requires an explicit value.');
    instance = setBlockInstanceValueV2(instance, rootId, value);
  }
  if (!directTargets.length) return instance;
  const graph = structuredClone(instance.effectiveGraph);
  for (const { nodeId, fieldId } of directTargets) {
    const field = blockContainerFieldV1(
      graph.nodes.find((node) => node.nodeId === nodeId),
      fieldId,
    );
    if (!field) throw new Error('An internal control target no longer exists.');
    if (field.disabled) throw new Error(`Cannot change disabled internal field ${nodeId}.${fieldId}.`);
    if (value === undefined) delete field.value;
    else field.value = structuredClone(value);
  }
  return replaceBlockEffectiveGraphV2(instance, graph);
}
