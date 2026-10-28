import type { Edge } from '@xyflow/react';
import type { FieldProps } from '../components/NodeContent';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import type { useNodesStore } from '../stores/useNodeStore';
import { workflowOperationContextIsCurrent } from '../stores/useStudioStore';
import { blockConnectionTargetsV2 } from '../studio/blockCrossingConnectionsV2';
import {
  blockContainerControlTargetsV1,
  blockContainerFieldV1,
  blockContainerInterfaceV1,
} from '../studio/blockContainerInterfaceV1';
import { blockGraphParentIdsV2, type BlockControlV2 } from '../studio/blockSchemaV2';
import { getRepoCacheStatus } from '../studio/modelCache';
import { indexedHubModelIsInstalled } from '../studio/modelSelection';
import { fieldActionSource } from './fieldAction';

type InstallField = Pick<FieldProps, 'nodeId' | 'fieldKey' | 'module' | 'action' | 'workflowContext'>;
type Installer = ReturnType<typeof useNodesStore.getState>['installHfModel'];
type FieldGraph = { nodes: CustomNodeType[]; edges: Edge[] };

function connectedField(node: CustomNodeType, field: string, graph: FieldGraph) {
  const param = node.data.params[field];
  if (param?.isConnected || param?.signal?.direction === 'input') return true;
  if (param && ('sourceId' in param || 'sourceKey' in param)) return true;
  if (graph.edges.some((edge) => edge.target === node.id && edge.targetHandle === field)) return true;
  const semanticId = node.data.blockProjectionNodeId;
  const owner = graph.nodes.find((candidate) => candidate.id === node.data.blockProjectionOwnerId);
  const instance = owner?.data.blockInstanceV2;
  if (!semanticId || !owner || !instance) return false;
  if (instance.effectiveGraph.edges.some((edge) => edge.targetNodeId === semanticId && edge.targetPortId === field))
    return true;
  return graph.edges.some(
    (edge) =>
      edge.target === owner.id &&
      edge.targetHandle &&
      blockConnectionTargetsV2(owner, edge.targetHandle, 'input').some(
        (target) => target.nodeId === semanticId && target.fieldOrPortId === field,
      ),
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function expandRequired(): never {
  throw new Error('Expand this Block to verify its component revision before installing.');
}

function modelControlTargets(control: Pick<BlockControlV2, 'binding' | 'mirrorBindings'>) {
  if (!record(control.binding) || (control.mirrorBindings !== undefined && !Array.isArray(control.mirrorBindings)))
    expandRequired();
  const targets = blockContainerControlTargetsV1(control);
  if (
    !targets.length ||
    targets.some(
      (target) =>
        !record(target) ||
        typeof target.nodeId !== 'string' ||
        !target.nodeId ||
        typeof target.fieldId !== 'string' ||
        !target.fieldId,
    )
  )
    expandRequired();
  return targets;
}

/** Classify only declared control targets; aliased component pins require their expanded owner. */
function ordinaryBlockModelControl(props: InstallField, graph: FieldGraph) {
  const node = graph.nodes.find((entry) => entry.id === props.nodeId);
  if (!node || node.data.module !== props.module || node.data.action !== props.action) return false;
  const param = node.data.params[props.fieldKey];
  const local = param?.fieldOptions?.blockContainerControlV1;
  const binding = param?.fieldOptions?.blockBindingV2;
  const owner = node.data.blockInstanceV2
    ? node
    : graph.nodes.find((entry) => entry.id === node.data.blockProjectionOwnerId);
  const instance = owner?.data.blockInstanceV2;
  const roots = instance?.effectiveInterface.controls.filter((entry) => entry.controlId === props.fieldKey) ?? [];
  const ownField =
    record(binding) && binding.nodeId === node.data.blockProjectionNodeId && binding.fieldOrPortId === props.fieldKey;
  const aliased =
    local !== undefined || (binding !== undefined && !ownField) || /^block-(?:local-)?control:/u.test(props.fieldKey);
  if (!roots.length && !aliased) return false;
  if (!instance || (aliased && (!param || param.display !== 'modelselect'))) expandRequired();
  // Validate parent ownership before the existing inherited-interface resolver traverses it.
  blockGraphParentIdsV2(instance.effectiveGraph);
  const nodes = new Map(instance.effectiveGraph.nodes.map((entry) => [entry.nodeId, entry]));
  if (nodes.size !== instance.effectiveGraph.nodes.length) expandRequired();
  let controls: Pick<BlockControlV2, 'binding' | 'mirrorBindings'>[];
  if (local !== undefined) {
    if (
      !record(local) ||
      local.schemaVersion !== 1 ||
      local.ownerId !== instance.instanceId ||
      local.containerNodeId !== node.data.blockProjectionNodeId ||
      typeof local.controlId !== 'string'
    )
      expandRequired();
    controls = blockContainerInterfaceV1(instance, String(local.containerNodeId)).controls.filter(
      (entry) => entry.controlId === local.controlId,
    );
  } else if (binding !== undefined) {
    if (
      !record(binding) ||
      binding.schemaVersion !== 2 ||
      binding.ownerId !== instance.instanceId ||
      binding.direction !== 'control' ||
      typeof binding.logicalId !== 'string'
    )
      expandRequired();
    controls = instance.effectiveInterface.controls.filter((entry) => entry.controlId === binding.logicalId);
    if (
      controls.length !== 1 ||
      !controls[0] ||
      controls[0].binding.nodeId !== binding.nodeId ||
      controls[0].binding.fieldId !== binding.fieldOrPortId
    )
      expandRequired();
  } else {
    if (node.id !== instance.instanceId) expandRequired();
    controls = roots;
  }
  const control = controls.length === 1 ? controls[0] : undefined;
  if (!control) expandRequired();
  const pending = modelControlTargets(control).map((target) => ({ target, path: new Set<string>() }));
  const visited = new Set<string>();
  let count = 0;
  while (pending.length) {
    const { target, path } = pending.pop()!;
    const key = `${target.nodeId}\0${target.fieldId}`;
    // Aliases are untrusted persisted metadata. Refuse ambiguous/cyclic or excessive traversal.
    if (path.has(key) || path.size >= 64 || ++count > 1024) expandRequired();
    if (visited.has(key)) continue;
    visited.add(key);
    const source = nodes.get(target.nodeId);
    if (!source) expandRequired();
    if (
      typeof source.data.module === 'string' &&
      source.data.module.startsWith('custom.') &&
      source.data.action === 'LoadModels' &&
      target.fieldId.startsWith('source__')
    )
      expandRequired();
    if (source.containerInterface || source.nodeType === 'group') {
      const nested = blockContainerInterfaceV1(instance, source.nodeId).controls.filter(
        (entry) => entry.controlId === target.fieldId,
      );
      const child = nested.length === 1 ? nested[0] : undefined;
      if (!child) expandRequired();
      const nextPath = new Set([...path, key]);
      pending.push(...modelControlTargets(child).map((next) => ({ target: next, path: nextPath })));
      continue;
    }
    const field = blockContainerFieldV1(source, target.fieldId);
    if (
      !field ||
      field.display !== 'modelselect' ||
      typeof source.data.module !== 'string' ||
      typeof source.data.action !== 'string' ||
      source.data.userBlockSnapshot ||
      source.data.blockInstanceV2
    )
      expandRequired();
  }
  return true;
}

function componentRevision(props: InstallField, repo: string, graph: FieldGraph) {
  if (ordinaryBlockModelControl(props, graph)) return undefined;
  const source = fieldActionSource(props, graph.nodes);
  if (!source?.param || typeof source.node.data.module !== 'string' || typeof source.node.data.action !== 'string')
    throw new Error('This model field changed. Reopen its controls before installing.');
  if (source.node.data.userBlockSnapshot || source.node.data.blockInstanceV2) expandRequired();
  if (source.node.data.module.startsWith('custom.') && source.node.data.action === 'LoadModels') {
    // The approved generic component supplier owns these sibling source fields.
    // A base/catalog revision or another component's pin is never a fallback.
    const component = /^source__([A-Za-z_][A-Za-z0-9_]{0,127})__repo$/u.exec(source.fieldKey);
    if (component) {
      if (!graph.nodes.some((node) => node.id === source.node.id))
        throw new Error('Expand this Block to verify its component revision before installing.');
      const revisionField = source.fieldKey.slice(0, -'repo'.length) + 'revision';
      const pin = source.node.data.params[revisionField];
      if (connectedField(source.node, source.fieldKey, graph) || connectedField(source.node, revisionField, graph))
        throw new Error(
          'Model installation requires a literal component repository and revision. Disconnect their input wires first.',
        );
      const choice = source.param.value ?? source.param.default;
      if (
        !choice ||
        typeof choice !== 'object' ||
        !('source' in choice) ||
        choice.source !== 'hub' ||
        !('value' in choice) ||
        choice.value !== repo
      )
        throw new Error('This component repository changed. Reopen its controls before installing.');
      if (!pin || typeof pin.value !== 'string' || !/^[a-f0-9]{40}$/u.test(pin.value))
        throw new Error(`Select an exact lowercase 40-character revision for ${component[1]} before installing.`);
      return pin.value;
    }
    if (source.fieldKey.startsWith('source__'))
      throw new Error('This component source field is invalid. Reload its approved node definition.');
  }
  return undefined;
}

/** Explicit Install resolves the current owning field, never a rendered stale pin. */
export function installModelField(props: InstallField, repo: string, sid: string | null, install: Installer) {
  if (props.workflowContext && !workflowOperationContextIsCurrent(props.workflowContext, { includeForm: false }))
    throw new Error('This workflow changed. Reopen its model controls before installing.');
  const revision = componentRevision(props, repo, useFlowStore.getState());
  return revision ? install(repo, sid, { revision }) : install(repo, sid);
}

/** Missing exact cache evidence leaves the explicit pinned Install action available. */
export function modelFieldIsInstalled(
  props: InstallField,
  repo: string,
  cache: unknown[],
  graph: FieldGraph = useFlowStore.getState(),
) {
  try {
    const revision = componentRevision(props, repo, graph);
    if (revision) {
      const entry = cache.find((item) => item && typeof item === 'object' && 'id' in item && item.id === repo);
      if (
        !entry ||
        typeof entry !== 'object' ||
        !(('complete' in entry && entry.complete === true) || ('installed' in entry && entry.installed === true))
      )
        return false;
      return getRepoCacheStatus(repo, cache, [], null, { revision }).installed;
    }
    return cache.some(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        'id' in item &&
        item.id === repo &&
        indexedHubModelIsInstalled(item),
    );
  } catch {
    // The click reports the pin/ownership error; an unproved selection is never installed.
    return false;
  }
}
