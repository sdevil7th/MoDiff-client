import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useStoreApi, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Maximize2, Minimize2, PackageOpen, Settings2 } from 'lucide-react';

import type { CustomNodeType } from '../stores/useFlowStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useHuggingFaceModularConditionalStore } from '../stores/useHuggingFaceModularConditionalStore';
import { useNodesStore } from '../stores/useNodeStore';
import type { NodeParams } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import { finalizeHuggingFaceClusterDynamicFieldsInFlow } from '../studio/huggingFaceClusterFinalization';
import {
  fitHuggingFaceClusterInstance,
  HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
  HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
  reconcileHuggingFaceClusterGraph,
} from '../studio/huggingFaceClusterGraph';
import { materializeHuggingFaceClusterExecutionSkeleton } from '../studio/huggingFaceClusterMaterializer';
import { provisionalHuggingFaceClusterExecutionParameterValues } from '../studio/huggingFaceClusterRuntime';
import { customizeHuggingFaceClusterInstance } from '../studio/huggingFaceClusterCustomization';
import { ModiffFieldShell, ModiffIconButton, ModiffSelect, NodeResizeGrip } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import { cx } from '../utils/classNames';
import { useNodeLayoutSync } from '../utils/useNodeLayoutSync';
import NodeContent from './NodeContent';

async function resolveReviewedExecutionSpec<T>(resolve: () => T | undefined): Promise<T | undefined> {
  const spec = resolve();
  if (spec) return spec;
  await useNodesStore.getState().fetchStudioModelCapabilities();
  return resolve();
}

const HuggingFaceClusterNode = memo((node: NodeProps<CustomNodeType>) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const isRoot = node.data.huggingFaceClusterRole === 'root';
  const expanded = Boolean(node.data.huggingFaceClusterInstance?.presentation.expanded);
  const reference = node.data.huggingFaceClusterInstance?.definition;
  const definition = useHuggingFaceNodeLibraryStore((state) =>
    state.library?.definitions.find(
      (definition) =>
        definition.id === reference?.id &&
        definition.libraryRevision === reference.libraryRevision &&
        definition.contentHash === reference.contentHash,
    ),
  );
  const libraryLoaded = useHuggingFaceNodeLibraryStore((state) => state.loaded);
  const fetchLibrary = useHuggingFaceNodeLibraryStore((state) => state.fetchLibrary);
  const conditionalSnapshot = useHuggingFaceModularConditionalStore((state) => state.snapshot);
  const conditionalSnapshotLoaded = useHuggingFaceModularConditionalStore((state) => state.loaded);
  const fetchConditionalSnapshot = useHuggingFaceModularConditionalStore((state) => state.fetchSnapshot);
  useEffect(() => {
    if (isRoot && !libraryLoaded) void fetchLibrary();
  }, [fetchLibrary, isRoot, libraryLoaded]);
  useEffect(() => {
    if (isRoot && definition?.provider === 'diffusers' && !conditionalSnapshotLoaded) void fetchConditionalSnapshot();
  }, [conditionalSnapshotLoaded, definition?.provider, fetchConditionalSnapshot, isRoot]);
  const conditionalPipelineHash =
    definition?.provider === 'diffusers'
      ? conditionalSnapshot?.pipelines.find((pipeline) => pipeline.pipelineClass === definition.pipelineClass)
          ?.contentHash
      : undefined;
  const reconciledDefinitionKey = useRef<string | null>(null);
  useEffect(() => {
    if (!isRoot || !definition || !node.data.huggingFaceClusterInstance) return;
    const instance = node.data.huggingFaceClusterInstance;
    const key = [node.id, definition.libraryRevision, definition.contentHash, conditionalPipelineHash ?? ''].join('\0');
    if (reconciledDefinitionKey.current === key) return;
    reconciledDefinitionKey.current = key;
    const flow = useFlowStore.getState();
    const graph = reconcileHuggingFaceClusterGraph(
      { nodes: flow.nodes, edges: flow.edges },
      instance.instanceId,
      definition,
    );
    useFlowStore.setState({ nodes: graph.nodes, edges: graph.edges });
    useFlowStore.getState().updateHandleConnectionStatus();
    useFlowStore.getState().updateSignalValues(graph.edges);
  }, [conditionalPipelineHash, definition, isRoot, node.data.huggingFaceClusterInstance, node.id]);
  const executionAdmissions = useMemo(
    () =>
      definition?.executionAdmissions.filter(
        (admission) =>
          admission.status === 'admitted' &&
          admission.claim === 'static_graph_contract_compatible' &&
          admission.publication.readiness === 'graph_qualified' &&
          admission.publication.insertable,
      ) ?? [],
    [definition],
  );
  const selectedAdmissionId = node.data.huggingFaceClusterInstance?.execution?.admissionId ?? '';
  const providerLabel =
    definition?.provider === 'transformers' || node.data.category === 'Transformers Nodes'
      ? 'Transformers'
      : 'Diffusers';
  const suggestedInputSource = definition?.suggestedInputs?.source;
  const hasSuggestedInputs = Boolean(definition && Object.keys(definition.suggestedInputs?.values ?? {}).length);
  const [forking, setForking] = useState(false);
  const [graphProjectionState, setGraphProjectionState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [graphProjectionMessage, setGraphProjectionMessage] = useState<string | null>(null);
  const automaticProjectionKey = useRef<string | null>(null);
  const workflowCanvasEpoch = useStudioStore((state) => state.workflowCanvasEpoch);
  const hasExecutionGraph = useFlowStore((state) =>
    state.nodes.some(
      (candidate) =>
        candidate.data.huggingFaceClusterRole === 'execution' &&
        candidate.data.huggingFaceClusterInstanceId === node.id,
    ),
  );
  const executionLayoutSignature = useFlowStore((state) =>
    state.nodes
      .filter(
        (candidate) =>
          candidate.data.huggingFaceClusterRole === 'execution' &&
          candidate.data.huggingFaceClusterInstanceId === node.id &&
          !candidate.hidden,
      )
      .map((candidate) =>
        [
          candidate.id,
          candidate.position.x,
          candidate.position.y,
          candidate.measured?.width ?? candidate.width ?? 0,
          candidate.measured?.height ?? candidate.height ?? 0,
        ].join(':'),
      )
      .join('|'),
  );
  const executionEdgesReady = node.data.uiState?.clusterExecutionEdgesReady === true;
  const toggleExpanded = useFlowStore((state) => state.toggleHuggingFaceClusterExpanded);
  const setNodeSize = useFlowStore((state) => state.setNodeSize);
  const setNodeUiState = useFlowStore((state) => state.setNodeUiState);
  const beginHistoryTransaction = useFlowStore((state) => state.beginHistoryTransaction);
  const commitHistoryTransaction = useFlowStore((state) => state.commitHistoryTransaction);
  const reactFlowStore = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  const scheduleNodeLayoutSync = useNodeLayoutSync(node.id, nodeRef);
  const setParameter = useFlowStore((state) => state.setHuggingFaceClusterParameter);
  const setExecution = useFlowStore((state) => state.setHuggingFaceClusterExecution);
  const updateStore = useCallback(
    (name: string, value: unknown, key?: keyof NodeParams) => {
      if (key && key !== 'value') return;
      setParameter(isRoot ? node.id : (node.data.huggingFaceClusterInstanceId ?? node.id), name, value);
    },
    [isRoot, node.data.huggingFaceClusterInstanceId, node.id, setParameter],
  );
  const handleToggle = useCallback(() => {
    toggleExpanded(node.id);
    useStudioStore.getState().saveActiveWorkflowTab(true);
  }, [node.id, toggleExpanded]);
  const handleExecutionChange = useCallback(
    (value: string) => {
      setExecution(node.id, value || null);
      useStudioStore.getState().saveActiveWorkflowTab(true);
    },
    [node.id, setExecution],
  );

  useEffect(() => {
    if (expanded) return;
    automaticProjectionKey.current = null;
    setGraphProjectionState('idle');
    setGraphProjectionMessage(null);
  }, [expanded]);

  useEffect(() => {
    const instance = node.data.huggingFaceClusterInstance;
    if (!isRoot || !definition || !instance || hasExecutionGraph) {
      if (hasExecutionGraph) {
        setGraphProjectionState('ready');
        setGraphProjectionMessage(null);
      }
      return;
    }
    const admission = executionAdmissions.find((candidate) => candidate.id === selectedAdmissionId);
    if (!admission) {
      setGraphProjectionState('error');
      setGraphProjectionMessage('Select a workflow mode before loading its graph.');
      return;
    }
    const key = JSON.stringify({
      // Workflow hydration/backend reconciliation replaces the visible graph
      // with its durable roots and intentionally drops derived execution
      // children. Tie an automatic projection attempt to that exact canvas
      // generation so every registered instance rematerializes after a graph
      // replacement instead of retaining a completed key from the prior graph.
      canvasEpoch: workflowCanvasEpoch,
      definition: [definition.id, definition.libraryRevision, definition.contentHash],
      admission: admission.id,
      parameters: instance.parameterOverrides,
      executionParameters: instance.execution?.parameterOverrides,
      explicitSources: instance.execution?.explicitParameterSources,
    });
    if (automaticProjectionKey.current === key) return;
    automaticProjectionKey.current = key;
    let active = true;
    setGraphProjectionState('loading');
    setGraphProjectionMessage(null);

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
    const bindingValues = provisionalHuggingFaceClusterExecutionParameterValues(definition, instance, admission);

    Promise.resolve()
      .then(async () => {
        const spec = await resolveReviewedExecutionSpec(resolveSpec);
        if (!spec) throw new Error('The exact reviewed graph specification is unavailable.');
        return {
          spec,
          skeleton: await materializeHuggingFaceClusterExecutionSkeleton({
            definition,
            instance,
            admission,
            executionSpec: spec,
            nodesRegistry: useNodesStore.getState().nodesRegistry,
            bindingValues,
            expanded: true,
          }),
        };
      })
      .then(({ spec, skeleton }) =>
        finalizeHuggingFaceClusterDynamicFieldsInFlow({
          definition,
          instance,
          admission,
          executionSpec: spec,
          skeleton,
          bindingValues,
        }),
      )
      .then(() => {
        if (!active) return;
        setGraphProjectionState('ready');
        setGraphProjectionMessage(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setGraphProjectionState('error');
        setGraphProjectionMessage(
          error instanceof Error ? error.message : 'Could not materialize the reviewed Cluster graph.',
        );
      });

    return () => {
      active = false;
    };
  }, [
    definition,
    executionAdmissions,
    expanded,
    hasExecutionGraph,
    isRoot,
    node.data.huggingFaceClusterInstance,
    selectedAdmissionId,
    workflowCanvasEpoch,
  ]);

  useEffect(() => {
    if (!expanded || !executionLayoutSignature) return undefined;
    const childIds = useFlowStore
      .getState()
      .nodes.filter(
        (candidate) =>
          candidate.data.huggingFaceClusterRole === 'execution' &&
          candidate.data.huggingFaceClusterInstanceId === node.id,
      )
      .map((candidate) => candidate.id);
    const scheduledFrames = new Set<number>();
    const scheduleFrame = (callback: () => void) => {
      const frame = window.requestAnimationFrame(() => {
        scheduledFrames.delete(frame);
        callback();
      });
      scheduledFrames.add(frame);
    };
    const childIdSet = new Set(childIds);
    const allInternalHandlesMounted = () => {
      const flow = useFlowStore.getState();
      return flow.edges
        .filter((edge) => childIdSet.has(edge.source) || childIdSet.has(edge.target))
        .every((edge) => {
          const sourceMounted =
            !edge.sourceHandle ||
            Boolean(document.querySelector(`[data-testid="node-handle-${edge.source}-${edge.sourceHandle}"]`));
          const targetMounted =
            !edge.targetHandle ||
            Boolean(document.querySelector(`[data-testid="node-handle-${edge.target}-${edge.targetHandle}"]`));
          return sourceMounted && targetMounted;
        });
    };
    const revealWhenMounted = (attempt: number) => {
      updateNodeInternals([node.id, ...childIds]);
      if (!allInternalHandlesMounted()) {
        if (attempt < 120) scheduleFrame(() => revealWhenMounted(attempt + 1));
        return;
      }
      // Registration follows the DOM mount. Give React Flow one additional
      // layout frame after refreshing internals before rendering the links.
      scheduleFrame(() => setNodeUiState(node.id, { clusterExecutionEdgesReady: true }));
    };
    if (!executionEdgesReady) scheduleFrame(() => revealWhenMounted(0));
    else updateNodeInternals([node.id, ...childIds]);
    // Measurements settle over several React Flow frames. Debounce them, fit
    // the Cluster frame, then request the same whole-graph viewport fit used by
    // the Arrange action so the connected graph is immediately legible.
    const timeout = window.setTimeout(() => {
      useFlowStore.setState((state) => {
        const graph = fitHuggingFaceClusterInstance(state, node.id);
        return {
          ...(graph === state ? {} : { nodes: graph.nodes }),
          layoutRevision: state.layoutRevision + 1,
        };
      });
    }, 100);
    return () => {
      scheduledFrames.forEach((frame) => window.cancelAnimationFrame(frame));
      window.clearTimeout(timeout);
    };
  }, [executionEdgesReady, executionLayoutSignature, expanded, node.id, setNodeUiState, updateNodeInternals]);

  const handleCustomizeAsUserNode = useCallback(() => {
    if (!definition || !node.data.huggingFaceClusterInstance || !selectedAdmissionId || forking) return;
    setForking(true);
    customizeHuggingFaceClusterInstance(node.id)
      .then(() => {
        enqueueSnackbar('Cluster is now an editable User Node for this workflow.', {
          variant: 'success',
          autoHideDuration: 2400,
        });
      })
      .catch((error: unknown) => {
        enqueueSnackbar(error instanceof Error ? error.message : 'Could not customize the Cluster as a User Node.', {
          variant: 'error',
          autoHideDuration: 4200,
        });
      })
      .finally(() => setForking(false));
  }, [definition, forking, node.data.huggingFaceClusterInstance, node.id, selectedAdmissionId]);

  const handleResizeStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (expanded) return;
      event.preventDefault();
      event.stopPropagation();
      beginHistoryTransaction('Resize Cluster Node');
      const initialWidth = nodeRef.current?.clientWidth || node.width || HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH;
      const initialHeight = nodeRef.current?.clientHeight || node.height || HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT;
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = reactFlowStore.getState().transform[2] || 1;
      let finalWidth = initialWidth;
      let finalHeight = initialHeight;

      const handleMove = (moveEvent: globalThis.MouseEvent) => {
        finalWidth = Math.min(
          720,
          Math.max(HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH, initialWidth + (moveEvent.clientX - startX) / zoom),
        );
        finalHeight = Math.max(
          HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
          initialHeight + (moveEvent.clientY - startY) / zoom,
        );
        setNodeSize(node.id, Math.round(finalWidth), Math.round(finalHeight));
        scheduleNodeLayoutSync();
      };
      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        setNodeUiState(node.id, {
          clusterCollapsedWidth: Math.round(finalWidth),
          clusterCollapsedHeight: Math.round(finalHeight),
        });
        commitHistoryTransaction();
        scheduleNodeLayoutSync();
      };
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    },
    [
      beginHistoryTransaction,
      commitHistoryTransaction,
      expanded,
      node.height,
      node.id,
      node.width,
      reactFlowStore,
      scheduleNodeLayoutSync,
      setNodeSize,
      setNodeUiState,
    ],
  );

  // Legacy hierarchy children are removed during reconciliation. Returning no
  // UI for one render keeps an old saved projection from flashing before the
  // ordinary execution nodes replace it.
  if (!isRoot) return null;

  return (
    <div
      ref={nodeRef}
      className={cx(
        'relative flex h-full w-full min-w-[260px] flex-col overflow-visible rounded-modiff-panel border-2 border-hf-yellow/60 shadow-modiff-node',
        expanded ? 'bg-hf-yellow/[0.055]' : 'bg-modiff-surface',
      )}
      data-cluster-role="root"
      data-testid={`hugging-face-cluster-${node.id}`}
    >
      <header
        className={cx(
          'drag-handle flex h-11 shrink-0 items-center gap-2 rounded-t-modiff-panel border-b border-hf-yellow/25 px-3 text-sm font-bold text-modiff-text',
          expanded ? 'bg-hf-yellow/10' : 'bg-modiff-bg',
        )}
      >
        <PackageOpen size={16} className="shrink-0 text-hf-yellow" />
        <span className="min-w-0 flex-1 truncate">{node.data.label}</span>
        {expanded && graphProjectionState === 'loading' ? (
          <span className="text-xs font-semibold text-modiff-subtle-text">Loading graph…</span>
        ) : null}
        {expanded && graphProjectionState === 'error' ? (
          <span
            className="max-w-40 truncate text-xs font-semibold text-modiff-red"
            title={graphProjectionMessage ?? undefined}
          >
            Graph unavailable
          </span>
        ) : null}
        <ModiffIconButton
          className="nodrag nowheel"
          size="compact"
          label="Customize as User Node"
          title={
            selectedAdmissionId
              ? 'Make this workflow instance structurally editable while leaving the first-party Cluster unchanged.'
              : 'Select a reviewed workflow mode before customizing.'
          }
          disabled={!definition || !selectedAdmissionId || forking}
          onClick={handleCustomizeAsUserNode}
        >
          <Settings2 size={15} />
        </ModiffIconButton>
        <ModiffIconButton
          className="nodrag nowheel"
          size="compact"
          label={expanded ? `Collapse ${providerLabel} Cluster Node` : `Expand ${providerLabel} Cluster Node`}
          title={definition ? undefined : 'The exact reviewed library definition is unavailable.'}
          disabled={!definition}
          onClick={handleToggle}
          data-testid={`hugging-face-cluster-toggle-${node.id}`}
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </ModiffIconButton>
      </header>
      {expanded ? (
        <div className="pointer-events-none min-h-0 flex-1" aria-hidden="true">
          {graphProjectionState === 'error' ? (
            <p className="pointer-events-auto m-4 max-w-md text-xs text-modiff-red" role="status">
              {graphProjectionMessage}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="nodrag nowheel min-h-24 flex-1 overflow-x-hidden overflow-y-auto bg-modiff-surface p-3">
            {executionAdmissions.length > 1 ? (
              <ModiffFieldShell className="mb-3" label="Workflow">
                <ModiffSelect
                  value={selectedAdmissionId}
                  onValueChange={handleExecutionChange}
                  options={executionAdmissions.map((admission) => ({
                    value: admission.id,
                    label: admission.studioMode.replace(/_/gu, ' '),
                  }))}
                  placeholder="Select a mode"
                />
              </ModiffFieldShell>
            ) : null}
            {hasSuggestedInputs && suggestedInputSource ? (
              <p
                className="mb-3 rounded-modiff-compact border border-modiff-border-subtle bg-modiff-bg/60 px-2 py-1.5 text-modiff-label text-modiff-subtle-text"
                data-testid={`hugging-face-cluster-suggestion-source-${node.id}`}
              >
                Starter values:{' '}
                {suggestedInputSource.url ? (
                  <a
                    className="nodrag nowheel font-semibold text-hf-yellow hover:underline"
                    href={suggestedInputSource.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {suggestedInputSource.label}
                  </a>
                ) : (
                  <span className="font-semibold text-modiff-text">{suggestedInputSource.label}</span>
                )}
              </p>
            ) : null}
            <NodeContent
              nodeId={node.id}
              params={node.data.params}
              updateStore={updateStore}
              module={definition?.provider ?? 'huggingface'}
              action="cluster"
              mode="controls"
            />
          </div>
          <div className="shrink-0">
            <NodeContent
              nodeId={node.id}
              params={node.data.params}
              updateStore={updateStore}
              module={definition?.provider ?? 'huggingface'}
              action="cluster"
              mode="connectors"
            />
          </div>
        </>
      )}
      {!expanded ? <NodeResizeGrip label="Drag to resize Cluster Node" onMouseDown={handleResizeStart} /> : null}
    </div>
  );
});

HuggingFaceClusterNode.displayName = 'HuggingFaceClusterNode';

export default HuggingFaceClusterNode;
