import { useFlowStore, type APIGraphExport, type CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { ensureStudioGraphReadyForRun } from '../studio/graphBridge';
import { addLoraWorkflowBlock, addUpscaleWorkflowBlock } from '../studio/controlledWorkflows';
import { handleWebsocketMessage } from '../stores/websocketMessageHandler';
import { inspectCurrentGraph, validateCurrentRun } from '../studio/runReadiness';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { STUDIO_TEMPLATES } from '../studio/templates';
import { ensureStudioAutoPlanReadyForRun } from '../studio/useStudioRunActions';
import type {
  StudioFormState,
  StudioImportedAsset,
  StudioOutput,
  StudioTemplateId,
  WorkspacePanelTab,
} from '../studio/types';

type GalleryTemplateSummary = {
  id: StudioTemplateId;
  label: string;
  mode: string;
  modelType: string;
  exampleStatus: string;
  mediaType: string;
  thumbnailVariant?: string;
  workflowBlocks: string[];
};

type GalleryRunResult = {
  templateId: StudioTemplateId | null;
  taskId?: string | null;
  sid?: string | null;
  startedAt: number;
  response: unknown;
};

type GraphConnectionForTest = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

type GraphScenarioForTest =
  'empty' | 'no_enabled' | 'outputless' | 'disconnected_output' | 'missing_model' | 'multi_model_compare';

type ModiffE2EHooks = {
  getState: () => unknown;
  listTemplates: () => GalleryTemplateSummary[];
  applyTemplate: (templateId: StudioTemplateId, formOverrides?: Partial<StudioFormState>) => Promise<void>;
  refreshModelIndexes: () => Promise<void>;
  installHfModel: (repoId: string, repair?: boolean) => Promise<unknown>;
  runActiveTemplate: () => Promise<GalleryRunResult>;
  runPreparedTemplateGraph: (graph: APIGraphExport) => Promise<GalleryRunResult>;
  applyNodeDefinitionForAction: (action: string, params: Record<string, unknown>) => boolean;
  inspectCurrentGraph: () => unknown;
  setGraphScenarioForTest: (scenario: GraphScenarioForTest) => void;
  addCustomNodeForTest: (key?: string) => string;
  connectGraph: (connection: GraphConnectionForTest) => void;
  setFirstNodeCollapsedByAction: (action: string, collapsed: boolean) => boolean;
  setFirstNodePositionByAction: (action: string, position: { x: number; y: number }) => boolean;
  setWebsocketConnection: (connection: { sid?: string | null; isConnected?: boolean }) => void;
  startStudioRunForTest: (identity: { clientRunId: string; runInputHash: string; taskId?: string | null }) => {
    clientRunId: string;
    runInputHash: string;
    taskId?: string | null;
  };
  seedStudioOutputsForTest: (outputs: Array<Partial<StudioOutput> & { id: string; url: string }>) => void;
  seedImportedAssetsForTest: (
    assets: Array<Partial<StudioImportedAsset> & { id: string; url: string; name: string }>,
  ) => void;
  openWorkspacePanelForTest: (tab: WorkspacePanelTab) => void;
  sendWebsocketMessage: (message: unknown) => void;
};

declare global {
  interface Window {
    __MODIFF_E2E__?: ModiffE2EHooks;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function listTemplates(): GalleryTemplateSummary[] {
  return STUDIO_TEMPLATES.map((template) => ({
    id: template.id,
    label: template.label,
    mode: template.mode,
    modelType: template.modelType,
    exampleStatus: template.example?.status ?? 'unverified',
    mediaType: template.example?.mediaType ?? 'image',
    thumbnailVariant: template.thumbnailVariant,
    workflowBlocks: [...(template.workflowBlocks ?? [])],
  }));
}

async function applyTemplate(templateId: StudioTemplateId, formOverrides: Partial<StudioFormState> = {}) {
  const template = STUDIO_TEMPLATES.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Unknown Studio template: ${templateId}`);
  }

  useStudioStore.getState().applyTemplate(template);
  if (Object.keys(formOverrides).length > 0) {
    useStudioStore.getState().updateForm(formOverrides);
  }
  await ensureStudioGraphReadyForRun(useStudioStore.getState().form);
  for (const block of template.workflowBlocks ?? []) {
    if (block === 'lora') {
      await addLoraWorkflowBlock(useStudioStore.getState().form, template.workflowBlockSettings?.lora);
    } else {
      await addUpscaleWorkflowBlock(useStudioStore.getState().form, template.workflowBlockSettings?.upscaler);
    }
  }
}

async function runActiveTemplate(): Promise<GalleryRunResult> {
  const websocket = useWebsocketStore.getState();
  const sid = websocket.sid;
  const templateId = useStudioStore.getState().activeTemplateId;
  if (!sid || !websocket.isConnected) {
    throw new Error('MoDiff websocket is not connected.');
  }

  // A managed graph is created in two phases: its skeleton is synchronous, while
  // dynamic fields and edges finish asynchronously. Waiting here matters even
  // after applyTemplate(), because this call can schedule a fresh graph update.
  await ensureStudioGraphReadyForRun(useStudioStore.getState().form);
  const autoReady = await ensureStudioAutoPlanReadyForRun();
  if (!autoReady) {
    throw new Error(
      useStudioStore.getState().lastError ?? 'Auto could not choose a runnable local plan for this workflow.',
    );
  }
  // Auto may apply the selected candidate's model, quantization, dimensions, or
  // offload settings. Those changes schedule a new managed-graph finalization,
  // so validate only after the post-plan graph is ready as well.
  await ensureStudioGraphReadyForRun(useStudioStore.getState().form);
  const validation = validateCurrentRun({
    sid,
    isConnected: websocket.isConnected,
    includeStudio: true,
    showDialog: false,
  });
  if (!validation.canRun) {
    const firstIssue = validation.blocking[0] ?? validation.issues[0];
    throw new Error(
      firstIssue?.details
        ? `${firstIssue.message} ${firstIssue.details}`
        : (firstIssue?.message ?? 'Studio workflow is not ready.'),
    );
  }

  useStudioStore.getState().addPromptHistory(useStudioStore.getState().form.prompt);
  const { context, response } = await coordinateGraphRun({
    sid,
    studioContext: { forceDeterministic: true },
  });
  if (!context) throw new Error('Studio run context was not captured.');

  return {
    templateId: templateId ?? context.templateId ?? null,
    taskId: typeof response.task_id === 'string' ? response.task_id : null,
    sid,
    startedAt: context.startedAt,
    response,
  };
}

async function runPreparedTemplateGraph(graph: APIGraphExport): Promise<GalleryRunResult> {
  const websocket = useWebsocketStore.getState();
  const sid = websocket.sid;
  const templateId = useStudioStore.getState().activeTemplateId;
  if (!sid || !websocket.isConnected) {
    throw new Error('MoDiff websocket is not connected.');
  }

  useStudioStore.getState().addPromptHistory(useStudioStore.getState().form.prompt);
  const { context, response } = await coordinateGraphRun({
    sid,
    preparedGraph: graph,
    studioContext: { forceDeterministic: true },
  });
  if (!context) throw new Error('Studio run context was not captured.');

  return {
    templateId: templateId ?? context.templateId ?? null,
    taskId: typeof response.task_id === 'string' ? response.task_id : null,
    sid,
    startedAt: context.startedAt,
    response,
  };
}

function applyNodeDefinitionForAction(action: string, params: Record<string, unknown>) {
  const node = useFlowStore.getState().nodes.find((item) => item.data.action === action);
  if (!node) {
    return false;
  }
  handleWebsocketMessage(
    {
      type: 'node_definition',
      node: node.id,
      label: node.data.label,
      params,
    } as never,
    {
      sid: useWebsocketStore.getState().sid,
      ws: {} as WebSocket,
      getSid: () => useWebsocketStore.getState().sid,
      setSid: () => undefined,
      setLoopTimer: () => undefined,
    },
  );
  return true;
}

function makeGraphScenarioNode(
  key: string,
  id: string,
  position: { x: number; y: number },
  disabled = false,
): CustomNodeType {
  const registryNode = useNodesStore.getState().nodesRegistry[key];
  if (!registryNode) {
    throw new Error(`Mock node registry is missing ${key}.`);
  }
  return {
    id,
    type: registryNode.type,
    position,
    data: {
      ...cloneJson(registryNode),
      uiState: disabled ? { disabled: true } : undefined,
    },
  };
}

function setGraphScenarioForTest(scenario: GraphScenarioForTest) {
  useStudioStore.getState().clearGraphBinding();
  useStudioStore.setState({
    activeTemplateId: null,
    canvasTransition: null,
    graphFinalization: null,
    launcherDismissed: true,
  });

  if (scenario === 'empty') {
    useFlowStore.setState({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    return;
  }

  const prompt = makeGraphScenarioNode(
    'modules.ModularDiffusers.EncodePrompt',
    'scenario-prompt',
    { x: 0, y: 0 },
    scenario === 'no_enabled',
  );
  const preview = makeGraphScenarioNode(
    'modules.Image.Preview',
    'scenario-preview',
    { x: 360, y: 0 },
    scenario === 'no_enabled',
  );
  if (scenario === 'outputless' || scenario === 'no_enabled') {
    useFlowStore.setState({
      nodes: scenario === 'outputless' ? [prompt] : [prompt, preview],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    return;
  }

  if (scenario === 'disconnected_output') {
    useFlowStore.setState({
      nodes: [prompt, preview],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    return;
  }

  if (scenario === 'multi_model_compare') {
    const firstModel = makeGraphScenarioNode('modules.ModularDiffusers.ModelsLoader', 'scenario-model-a', {
      x: -420,
      y: -120,
    });
    firstModel.data.params.repo_id = {
      ...firstModel.data.params.repo_id,
      value: 'Tongyi-MAI/Z-Image-Turbo',
    };
    const secondModel = makeGraphScenarioNode('modules.ModularDiffusers.ModelsLoader', 'scenario-model-b', {
      x: -420,
      y: 220,
    });
    secondModel.data.params.model_type = {
      ...secondModel.data.params.model_type,
      value: 'QwenImageModularPipeline',
    };
    secondModel.data.params.repo_id = {
      ...secondModel.data.params.repo_id,
      value: 'Qwen/Qwen-Image-2512',
    };
    const firstPreview = makeGraphScenarioNode('modules.Image.Preview', 'scenario-preview-a', { x: 120, y: -120 });
    const secondPreview = makeGraphScenarioNode('modules.Image.Preview', 'scenario-preview-b', { x: 120, y: 220 });
    useFlowStore.setState({
      nodes: [firstModel, secondModel, firstPreview, secondPreview],
      edges: [
        {
          id: 'scenario-model-a-preview',
          source: firstModel.id,
          sourceHandle: 'text_encoders',
          target: firstPreview.id,
          targetHandle: 'image',
          type: 'default',
        },
        {
          id: 'scenario-model-b-preview',
          source: secondModel.id,
          sourceHandle: 'text_encoders',
          target: secondPreview.id,
          targetHandle: 'image',
          type: 'default',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    return;
  }

  const model = makeGraphScenarioNode('modules.ModularDiffusers.ModelsLoader', 'scenario-model', { x: -360, y: 0 });
  model.data.params.repo_id = {
    ...model.data.params.repo_id,
    value: 'missing/GraphModel',
  };
  useFlowStore.setState({
    nodes: [model, preview],
    edges: [
      {
        id: 'scenario-model-preview',
        source: model.id,
        sourceHandle: 'text_encoders',
        target: preview.id,
        targetHandle: 'image',
        type: 'default',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

function addCustomNodeForTest(key = 'modules.Image.Preview') {
  const id = `custom-${Date.now()}`;
  const node = makeGraphScenarioNode(key, id, { x: 720, y: 220 });
  useFlowStore.getState().addNode(node);
  return id;
}

function connectGraph(connection: GraphConnectionForTest) {
  useFlowStore.getState().onConnect({
    ...connection,
    sourceHandle: connection.sourceHandle ?? null,
    targetHandle: connection.targetHandle ?? null,
    edgeType: useSettingsStore.getState().edgeType,
  });
}

function setFirstNodeCollapsedByAction(action: string, collapsed: boolean) {
  const node = useFlowStore.getState().nodes.find((item) => item.data.action === action);
  if (!node) {
    return false;
  }
  useFlowStore.getState().setNodeUiState(node.id, { collapsed });
  return true;
}

function setFirstNodePositionByAction(action: string, position: { x: number; y: number }) {
  const node = useFlowStore.getState().nodes.find((item) => item.data.action === action);
  if (!node) {
    return false;
  }
  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((item) => (item.id === node.id ? { ...item, position } : item)),
  }));
  return true;
}

function setWebsocketConnection(connection: { sid?: string | null; isConnected?: boolean }) {
  const state = useWebsocketStore.getState();
  if (state.connectionTimer) {
    clearTimeout(state.connectionTimer);
  }
  if (state.loopTimer) {
    clearTimeout(state.loopTimer);
  }
  if (state.ws && state.ws.readyState < WebSocket.CLOSING) {
    state.ws.onclose = null;
    state.ws.close();
  }
  useWebsocketStore.setState({
    sid: connection.sid ?? 'mock-sid',
    ws: null,
    isConnected: connection.isConnected ?? true,
    isConnecting: false,
    connectionTimer: undefined,
    loopTimer: undefined,
    reconnectAttempts: 0,
  });
}

function startStudioRunForTest(identity: { clientRunId: string; runInputHash: string; taskId?: string | null }) {
  useStudioStore.getState().clearChangedPreviewFieldsForRun(identity.runInputHash);
  useStudioStore.getState().captureRunContext(undefined, undefined, {
    clientRunId: identity.clientRunId,
    runInputHash: identity.runInputHash,
  });
  if (identity.taskId) {
    useStudioStore.getState().attachRunResponse(
      {
        task_id: identity.taskId,
        sid: useWebsocketStore.getState().sid,
      },
      identity.clientRunId,
    );
  }
  return identity;
}

function seedStudioOutputsForTest(outputs: Array<Partial<StudioOutput> & { id: string; url: string }>) {
  const state = useStudioStore.getState();
  const now = Date.now();
  const seeded = outputs.map((output, index): StudioOutput => {
    const form = output.formSnapshot ?? state.form;
    return {
      id: output.id,
      clientRunId: output.clientRunId,
      runInputHash: output.runInputHash,
      workflowTabId: output.workflowTabId,
      attemptIndex: output.attemptIndex,
      nodeId: output.nodeId ?? `seed-node-${index}`,
      fieldKey: output.fieldKey ?? 'image',
      value: output.value ?? output.url,
      url: output.url,
      mode: output.mode ?? form.mode,
      modelType: output.modelType ?? form.modelType,
      modelLabel: output.modelLabel ?? 'Seeded output',
      repo: output.repo ?? 'mock/seeded-output',
      templateId: output.templateId,
      templateLabel: output.templateLabel,
      runId: output.runId,
      taskId: output.taskId ?? null,
      sid: output.sid ?? null,
      prompt: output.prompt ?? '',
      negativePrompt: output.negativePrompt ?? '',
      seed: output.seed ?? form.seed,
      width: output.width ?? form.width,
      height: output.height ?? form.height,
      steps: output.steps ?? form.steps,
      guidanceScale: output.guidanceScale ?? form.guidanceScale,
      referenceImages: output.referenceImages ?? [],
      sourceOutputId: output.sourceOutputId,
      formSnapshot: form,
      graphSnapshot: output.graphSnapshot,
      graphBindingSnapshot: output.graphBindingSnapshot,
      apiGraphSnapshot: output.apiGraphSnapshot,
      createdAt: output.createdAt ?? now - index,
      favorite: output.favorite ?? false,
      parentId: output.parentId,
      displayType: output.displayType ?? 'image',
      mediaItems: output.mediaItems,
      templateLockHash: output.templateLockHash,
      promptSettingsHash: output.promptSettingsHash,
      exactTemplateCompatible: output.exactTemplateCompatible,
      variationGroupId: output.variationGroupId,
      variationLabel: output.variationLabel,
      provenance: output.provenance,
      backendProvenance: output.backendProvenance,
      backendImagePath: output.backendImagePath,
      backendMediaPath: output.backendMediaPath,
      mediaHash: output.mediaHash,
      mediaCollectionHash: output.mediaCollectionHash,
    };
  });
  useStudioStore.setState({ outputs: seeded });
}

function seedImportedAssetsForTest(
  assets: Array<Partial<StudioImportedAsset> & { id: string; url: string; name: string }>,
) {
  const now = Date.now();
  useStudioStore.setState({
    importedAssets: assets.map((asset, index): StudioImportedAsset => ({
      id: asset.id,
      kind: 'imported',
      name: asset.name,
      url: asset.url,
      backendPath: asset.backendPath,
      displayType: asset.displayType ?? 'image',
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      createdAt: asset.createdAt ?? now - index,
      source: 'upload',
      storage: asset.storage,
    })),
  });
}

function openWorkspacePanelForTest(tab: WorkspacePanelTab) {
  useSettingsStore.setState({
    isRightPanelOpen: true,
    rightPanelTab: tab,
  });
}

function sendWebsocketMessage(message: unknown) {
  handleWebsocketMessage(message as never, {
    sid: useWebsocketStore.getState().sid,
    ws: {} as WebSocket,
    getSid: () => useWebsocketStore.getState().sid,
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  });
}

export function installE2EHooks() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;

  const hooks = {
    getState: () =>
      cloneJson({
        flow: {
          visibleNodeCount:
            useStudioStore.getState().canvasTransition?.workflowTabId === useStudioStore.getState().activeWorkflowTabId
              ? 0
              : useFlowStore.getState().nodes.length,
          nodes: useFlowStore.getState().nodes.map((node) => ({
            id: node.id,
            module: node.data.module,
            action: node.data.action,
            params: Object.fromEntries(
              Object.entries(node.data.params).map(([key, param]) => [
                key,
                {
                  value: param.value,
                  artifacts: param.artifacts,
                  display: param.display,
                  type: param.type,
                },
              ]),
            ),
            uiState: node.data.uiState,
            progress: node.data.progress,
            executionStatus: node.data.executionStatus,
            executionPhase: node.data.executionPhase,
            progressMessage: node.data.progressMessage,
            activeTaskId: node.data.activeTaskId,
            attemptIndex: node.data.attemptIndex,
            studioRole: node.data.studioRole,
            studioOwned: node.data.studioOwned,
            studioAuxiliary: node.data.studioAuxiliary,
          })),
          edges: useFlowStore.getState().edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
          })),
          historyPast: useFlowStore.getState().historyPast.length,
          historyFuture: useFlowStore.getState().historyFuture.length,
        },
        studio: {
          form: useStudioStore.getState().form,
          graphBinding: useStudioStore.getState().graphBinding,
          graphFinalization: useStudioStore.getState().graphFinalization,
          canvasTransition: useStudioStore.getState().canvasTransition,
          outputs: useStudioStore.getState().outputs,
          importedAssets: useStudioStore.getState().importedAssets,
          workflowTabs: useStudioStore.getState().workflowTabs,
          activeWorkflowTabId: useStudioStore.getState().activeWorkflowTabId,
          activeTemplateId: useStudioStore.getState().activeTemplateId,
          currentRunContext: useStudioStore.getState().currentRunContext,
          lastError: useStudioStore.getState().lastError,
        },
        nodes: {
          hfCache: useNodesStore.getState().hfCache,
          localModels: useNodesStore.getState().localModels,
          modelCacheDiagnostics: useNodesStore.getState().modelCacheDiagnostics,
          studioModelCapabilities: useNodesStore.getState().studioModelCapabilities,
          hfDownloadProgress: useNodesStore.getState().hfDownloadProgress,
        },
        tasks: {
          currentTask: useTaskStore.getState().currentTask,
          queuedTasks: useTaskStore.getState().queuedTasks,
          sessionRuns: useTaskStore.getState().sessionRuns,
          taskCount: useTaskStore.getState().taskCount,
        },
        settings: {
          rightPanelOpen: useSettingsStore.getState().isRightPanelOpen,
          rightPanelTab: useSettingsStore.getState().rightPanelTab,
        },
        runIssues: {
          issues: useRunIssueStore.getState().issues,
          issueDialogOpen: useRunIssueStore.getState().issueDialogOpen,
          failure: useRunIssueStore.getState().failure,
          failureDialogOpen: useRunIssueStore.getState().failureDialogOpen,
        },
        websocket: {
          sid: useWebsocketStore.getState().sid,
          isConnected: useWebsocketStore.getState().isConnected,
        },
      }),
    listTemplates,
    applyTemplate,
    refreshModelIndexes: () => useNodesStore.getState().refreshModelIndexes(true),
    installHfModel: (repoId: string, repair = false) =>
      useNodesStore.getState().installHfModel(repoId, useWebsocketStore.getState().sid, { repair }),
    runActiveTemplate,
    runPreparedTemplateGraph,
    applyNodeDefinitionForAction,
    inspectCurrentGraph: () => cloneJson(inspectCurrentGraph()),
    setGraphScenarioForTest,
    addCustomNodeForTest,
    connectGraph,
    setFirstNodeCollapsedByAction,
    setFirstNodePositionByAction,
    setWebsocketConnection,
    startStudioRunForTest,
    seedStudioOutputsForTest,
    seedImportedAssetsForTest,
    openWorkspacePanelForTest,
    sendWebsocketMessage,
  };

  window.__MODIFF_E2E__ = hooks;
}
