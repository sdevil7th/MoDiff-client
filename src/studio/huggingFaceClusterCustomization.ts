import { useFlowStore } from '../stores/useFlowStore';
import { useHuggingFaceClusterRuntimeStore } from '../stores/useHuggingFaceClusterRuntimeStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useNodesStore } from '../stores/useNodeStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  type WorkflowOperationContext,
  useStudioStore,
} from '../stores/useStudioStore';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { finalizeHuggingFaceClusterDynamicFieldsInFlow } from './huggingFaceClusterFinalization';
import { createHuggingFaceClusterUserNodeFork, replaceHuggingFaceClusterWithUserNode } from './huggingFaceClusterFork';
import { materializeHuggingFaceClusterExecutionSkeleton } from './huggingFaceClusterMaterializer';
import { provisionalHuggingFaceClusterExecutionParameterValues } from './huggingFaceClusterRuntime';
import { createUserBlockNode } from './userBlocks';
import type { UserBlockDefinition } from './types';
import type { CustomNodeType } from '../stores/useFlowStore';

function activeWorkflowTitle() {
  const studio = useStudioStore.getState();
  return studio.workflowTabs.find((tab) => tab.id === studio.activeWorkflowTabId)?.title.trim() || 'Workflow';
}

export function contextualUserNodeName(label: string, workflowTitle = activeWorkflowTitle()) {
  const normalizedLabel = label.trim() || 'User Node';
  const normalizedWorkflow = workflowTitle.trim() || 'Workflow';
  return normalizedLabel.endsWith(`— ${normalizedWorkflow}`)
    ? normalizedLabel
    : `${normalizedLabel} — ${normalizedWorkflow}`;
}

export function clusterCustomizationSourceSignature(instanceId: string) {
  const flow = useFlowStore.getState();
  const ownedIds = new Set(
    flow.nodes
      .filter((node) => node.id === instanceId || node.data.huggingFaceClusterInstanceId === instanceId)
      .map((node) => node.id),
  );
  return JSON.stringify({
    nodes: flow.nodes
      .filter((node) => ownedIds.has(node.id))
      .map((node) => [
        node.id,
        node.data.huggingFaceClusterRole,
        // The root instance is the canonical semantic state for definition,
        // workflow, model, artifact revision, and every parameter override.
        // Child params also contain derived availability, signal, connection,
        // and rendered-output metadata that may legitimately refresh while
        // the backend save is in flight.
        node.data.huggingFaceClusterRole === 'root' ? node.data.huggingFaceClusterInstance : null,
        Object.fromEntries(
          Object.entries(node.data.params)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([field, param]) => [field, param.value]),
        ),
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
    edges: flow.edges
      .filter((edge) => ownedIds.has(edge.source) || ownedIds.has(edge.target))
      .map((edge) => [edge.id, edge.source, edge.sourceHandle, edge.target, edge.targetHandle])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  });
}

export async function commitHuggingFaceClusterCustomization(
  {
    instanceId,
    block,
    blockNode,
    context,
    sourceSignature,
  }: {
    instanceId: string;
    block: UserBlockDefinition;
    blockNode: CustomNodeType;
    context: WorkflowOperationContext;
    sourceSignature: string;
  },
  saveBlock: (block: UserBlockDefinition) => Promise<UserBlockDefinition> = (definition) =>
    useUserBlockStore.getState().saveBlock(definition),
) {
  // Persistence is deliberately first. A rejected User Node save must leave
  // the first-party Cluster in the canvas and in its workflow snapshot.
  const saved = await saveBlock(block);
  assertWorkflowOperationContext(context, { includeForm: false });
  if (clusterCustomizationSourceSignature(instanceId) !== sourceSignature) {
    throw new Error('The Cluster changed while its User Node definition was saving. Retry the customization.');
  }
  const savedNode = createUserBlockNode(saved, blockNode.position, blockNode.id);
  const current = useFlowStore.getState();
  const replacement = replaceHuggingFaceClusterWithUserNode(
    { nodes: current.nodes, edges: current.edges },
    instanceId,
    savedNode,
  );
  current.replaceGraph(replacement, { historyLabel: 'Customize Cluster as User Node' });
  current.updateHandleConnectionStatus();
  current.updateSignalValues(replacement.edges);
  useHuggingFaceClusterRuntimeStore.getState().clearAuthority(instanceId);
  useStudioStore.getState().saveActiveWorkflowTab(true);
  return { block: saved, blockNodeId: savedNode.id };
}

export async function customizeHuggingFaceClusterInstance(instanceId: string) {
  const context = captureWorkflowOperationContext();
  const root = useFlowStore
    .getState()
    .nodes.find((node) => node.id === instanceId && node.data.huggingFaceClusterRole === 'root');
  const instance = root?.data.huggingFaceClusterInstance;
  if (!root || !instance) throw new Error('The Cluster instance is unavailable.');

  const definition = useHuggingFaceNodeLibraryStore
    .getState()
    .library?.definitions.find(
      (candidate) =>
        candidate.id === instance.definition.id &&
        candidate.libraryRevision === instance.definition.libraryRevision &&
        candidate.contentHash === instance.definition.contentHash,
    );
  if (!definition) throw new Error('The exact reviewed Cluster definition is unavailable. Reload the node library.');
  const admissionId = instance.execution?.admissionId;
  const admission = definition.executionAdmissions.find(
    (candidate) =>
      candidate.id === admissionId &&
      candidate.status === 'admitted' &&
      candidate.publication.readiness === 'graph_qualified',
  );
  if (!admission) throw new Error('Select a graph-qualified Cluster workflow before customizing its structure.');
  const resolveSpec = () =>
    useNodesStore
      .getState()
      .studioModelCapabilities.find((capability) => capability.modelType === definition.pipelineClass)
      ?.studioExecutionSpecs?.find(
        (candidate) =>
          candidate.id === admission.studioExecutionSpec?.id &&
          candidate.contentHash === admission.studioExecutionSpec.contentHash &&
          candidate.executionProfileId === admission.studioExecutionSpec.executionProfileId,
      );
  let spec = resolveSpec();
  if (!spec) {
    await useNodesStore.getState().fetchStudioModelCapabilities();
    spec = resolveSpec();
  }
  if (!spec)
    throw new Error('The exact reviewed execution specification is unavailable after refreshing runtime data.');

  const bindingValues = provisionalHuggingFaceClusterExecutionParameterValues(definition, instance, admission);
  const skeleton = await materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance,
    admission,
    executionSpec: spec,
    nodesRegistry: useNodesStore.getState().nodesRegistry,
    bindingValues,
    expanded: instance.presentation.expanded,
  });
  const finalized = await finalizeHuggingFaceClusterDynamicFieldsInFlow({
    definition,
    instance,
    admission,
    executionSpec: spec,
    skeleton,
    bindingValues,
  });
  if (!finalized.studioExecutionSpec) {
    const missing = [
      ...finalized.skeleton.missingBindingSources,
      ...finalized.skeleton.pendingFields.map(({ role, field }) => `${role}.${field}`),
    ];
    throw new Error(`Execution fields are incomplete${missing.length ? `: ${missing.join(', ')}` : '.'}`);
  }

  const flow = useFlowStore.getState();
  const customized = createHuggingFaceClusterUserNodeFork({
    graph: { nodes: flow.nodes, edges: flow.edges },
    instanceId,
    definition,
    admission,
    skeleton: finalized.skeleton,
    existingBlocks: useUserBlockStore.getState().blocks,
    name: contextualUserNodeName(root.data.label || definition.label),
  });
  assertWorkflowOperationContext(context, { includeForm: false });
  const sourceSignature = clusterCustomizationSourceSignature(instanceId);
  return commitHuggingFaceClusterCustomization({
    instanceId,
    block: customized.block,
    blockNode: customized.blockNode,
    context,
    sourceSignature,
  });
}
