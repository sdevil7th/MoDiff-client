import { useFlowStore } from '../stores/useFlowStore';
import { useHuggingFaceClusterRuntimeStore } from '../stores/useHuggingFaceClusterRuntimeStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import { finalizeHuggingFaceClusterDynamicFieldsInFlow } from './huggingFaceClusterFinalization';
import { attachHuggingFaceClusterExecutableGraph } from './huggingFaceClusterGraph';
import {
  authorizeHuggingFaceClusterExecutionSkeleton,
  authorizeHuggingFaceClusterManualExecutionSkeleton,
  materializeHuggingFaceClusterExecutionSkeleton,
} from './huggingFaceClusterMaterializer';
import {
  prepareHuggingFaceClusterRuntimeAuthority,
  provisionalHuggingFaceClusterExecutionParameterValues,
} from './huggingFaceClusterRuntime';
import { prepareRegisteredBlockAutoAuthoritiesV2 } from './blockAutoAuthorityV2';

const inFlight = new Map<string, Promise<void>>();

function incompleteMessage(result: Awaited<ReturnType<typeof finalizeHuggingFaceClusterDynamicFieldsInFlow>>) {
  const missing = [
    ...result.skeleton.missingBindingSources,
    ...result.skeleton.pendingFields.map(({ role, field }) => `${role}.${field}`),
  ];
  return `Cluster execution fields are incomplete${missing.length ? `: ${missing.join(', ')}` : '.'}`;
}

async function prepareOne(instanceId: string) {
  let root = useFlowStore
    .getState()
    .nodes.find((node) => node.id === instanceId && node.data.huggingFaceClusterRole === 'root');
  const reference = root?.data.huggingFaceClusterInstance?.definition;
  let library = useHuggingFaceNodeLibraryStore.getState().library;
  if (!library) {
    await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
    library = useHuggingFaceNodeLibraryStore.getState().library;
  }
  const definition = library?.definitions.find(
    (candidate) =>
      candidate.id === reference?.id &&
      candidate.libraryRevision === reference.libraryRevision &&
      candidate.contentHash === reference.contentHash,
  );
  const instance = root?.data.huggingFaceClusterInstance;
  if (!root || !definition || !instance?.execution) {
    throw new Error('The Cluster has no exact executable workflow definition selected.');
  }
  const admission = definition.executionAdmissions.find(
    (candidate) => candidate.id === instance.execution?.admissionId,
  );
  if (!admission?.studioExecutionSpec) {
    throw new Error('The selected Cluster workflow has no executable graph admission.');
  }
  const executionNodes = useFlowStore
    .getState()
    .nodes.filter(
      (node) =>
        node.data.huggingFaceClusterRole === 'execution' && node.data.huggingFaceClusterInstanceId === instanceId,
    );
  const allEnabled = executionNodes.length > 0 && executionNodes.every((node) => !node.data.uiState?.disabled);
  const manualMode = useStudioStore.getState().form.resourceMode === 'expert';
  if (manualMode && allEnabled && !useHuggingFaceClusterRuntimeStore.getState().authorities[instanceId]) return;
  const authority = useHuggingFaceClusterRuntimeStore.getState().authorities[instanceId];
  if (
    !manualMode &&
    allEnabled &&
    authority &&
    authority.runtimeFingerprint === useNodesStore.getState().runtimeStatus?.runtime_fingerprint &&
    JSON.stringify([...authority.nodeIds].sort()) === JSON.stringify(executionNodes.map((node) => node.id).sort())
  )
    return;

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
  if (!spec) throw new Error('The backend no longer exposes this Cluster workflow graph.');

  root = useFlowStore.getState().nodes.find((node) => node.id === instanceId);
  const currentInstance = root?.data.huggingFaceClusterInstance;
  if (!currentInstance?.execution || currentInstance.execution.admissionId !== admission.id) {
    throw new Error('The Cluster workflow changed while its graph was being prepared.');
  }
  const bindingValues = provisionalHuggingFaceClusterExecutionParameterValues(definition, currentInstance, admission);
  const skeleton = materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance: currentInstance,
    admission,
    executionSpec: spec,
    nodesRegistry: useNodesStore.getState().nodesRegistry,
    bindingValues,
    expanded: currentInstance.presentation.expanded,
  });
  const finalized = await finalizeHuggingFaceClusterDynamicFieldsInFlow({
    definition,
    instance: currentInstance,
    admission,
    executionSpec: spec,
    skeleton,
    bindingValues,
  });
  if (!finalized.studioExecutionSpec) throw new Error(incompleteMessage(finalized));

  if (manualMode) {
    useHuggingFaceClusterRuntimeStore.getState().clearAuthority(instanceId);
    const executable = authorizeHuggingFaceClusterManualExecutionSkeleton(finalized.skeleton);
    const flow = useFlowStore.getState();
    const graph = attachHuggingFaceClusterExecutableGraph(flow, instanceId, definition, executable);
    useFlowStore.setState({ nodes: graph.nodes, edges: graph.edges });
    useFlowStore.getState().updateHandleConnectionStatus();
    useFlowStore.getState().updateSignalValues(executable.edges);
    return;
  }

  const prepared = await prepareHuggingFaceClusterRuntimeAuthority({
    definition,
    instance: currentInstance,
    admission,
    executionSpec: spec,
    skeleton: finalized.skeleton,
  });
  const executable = authorizeHuggingFaceClusterExecutionSkeleton(prepared.skeleton, prepared.authority);
  const flow = useFlowStore.getState();
  const graph = attachHuggingFaceClusterExecutableGraph(flow, instanceId, definition, executable);
  useFlowStore.setState({ nodes: graph.nodes, edges: graph.edges });
  useFlowStore.getState().updateHandleConnectionStatus();
  useFlowStore.getState().updateSignalValues(executable.edges);
  useHuggingFaceClusterRuntimeStore.getState().setAuthority(prepared.authority);
}

export function prepareHuggingFaceClusterForRun(instanceId: string) {
  const pending = inFlight.get(instanceId);
  if (pending) return pending;
  const next = prepareOne(instanceId).finally(() => inFlight.delete(instanceId));
  inFlight.set(instanceId, next);
  return next;
}

/** Run preparation is automatic. Cluster cards never expose qualification or
 * resource-admission controls; Auto remains fail-closed and Expert submits the
 * concrete graph so backend errors are reported as run results. */
export async function prepareHuggingFaceClustersForRun(instanceIds?: readonly string[]) {
  const requested = instanceIds ? new Set(instanceIds) : null;
  const ids = useFlowStore
    .getState()
    .nodes.filter(
      (node) =>
        node.data.huggingFaceClusterRole === 'root' &&
        !node.data.blockCompilationTransientV2 &&
        node.data.huggingFaceClusterInstance?.execution &&
        (!requested || requested.has(node.id)),
    )
    .map((node) => node.id);
  // Dynamic-field actions update one shared workflow graph. Prepare roots in
  // canvas order so two Clusters cannot overwrite each other's reconciled
  // node state while their backend field actions resolve.
  for (const id of ids) await prepareHuggingFaceClusterForRun(id);
  await prepareRegisteredBlockAutoAuthoritiesV2(instanceIds);
}
