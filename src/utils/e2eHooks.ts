import { useFlowStore, type APIGraphExport, type CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import { useHuggingFaceClusterRuntimeStore } from '../stores/useHuggingFaceClusterRuntimeStore';
import { captureWorkflowOperationContext, useStudioStore } from '../stores/useStudioStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import {
  createOrUpdateStudioGraph,
  ensureStudioGraphReadyForRun,
  inspectStudioGraphBindingDivergence,
  markStudioGraphDefinitionPending,
  syncStudioGraphDefinition,
  validateStudioGraphReadyForRun,
  waitForStudioGraphFinalization,
} from '../studio/graphBridge';
import {
  addLoraWorkflowBlock,
  addLyricVideoWorkflowBlock,
  addQualityVideoSequenceWorkflowBlock,
  addSoundtrackWorkflowBlock,
  addUpscaleWorkflowBlock,
  addVideoSequenceWorkflowBlock,
} from '../studio/controlledWorkflows';
import { handleWebsocketMessage } from '../stores/websocketMessageHandler';
import { inspectCurrentGraph, validateCurrentRun } from '../studio/runReadiness';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { applyHuggingFaceClusterRuntimeHints } from '../studio/huggingFaceClusterRuntime';
import { PLANNING_STUDIO_TEMPLATES, STUDIO_TEMPLATES } from '../studio/templates';
import { getFormDefaultsForMode } from '../studio/modelProfiles';
import type { StudioTaskTemplateSkeleton } from '../studio/taskTemplateContracts';
import { materializeTemplateDefaultInputs } from '../studio/templateInputs';
import { ensureStudioAutoPlanReadyForRun } from '../studio/useStudioRunActions';
import type { UserBlockDefinition } from '../studio/types';
import { createUserBlockNode, normalizeUserBlockDefinition } from '../studio/userBlocks';
import { arrangeGraphNodes, waitForGraphNodeMeasurements } from '../workflow/graphLayout';
import { decorateConnectionEdges } from '../theme/connectionTypes';
import type {
  StudioFormState,
  StudioGraphBinding,
  StudioImportedAsset,
  StudioGraphRole,
  StudioOutput,
  StudioTemplateId,
  WorkspacePanelTab,
} from '../studio/types';

type GalleryTemplateSummary = {
  id: StudioTemplateId;
  label: string;
  mode: string;
  modelType: string;
  category?: string;
  exampleStatus: string;
  mediaType: string;
  thumbnailVariant?: string;
  workflowBlocks: string[];
  runtimeReuseKey?: string;
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
  | 'empty'
  | 'no_enabled'
  | 'outputless'
  | 'disconnected_output'
  | 'disconnected_image_output'
  | 'missing_model'
  | 'multi_model_compare';

type ControlledWorkflowBlockForTest = 'upscaler' | 'video_sequence' | 'quality_video_sequence' | 'soundtrack';

type ModiffE2EHooks = {
  getState: () => unknown;
  listTemplates: (includePlanning?: boolean) => GalleryTemplateSummary[];
  listTaskTemplateSkeletons: () => StudioTaskTemplateSkeleton[];
  applyTemplate: (templateId: StudioTemplateId, formOverrides?: Partial<StudioFormState>) => Promise<void>;
  applyTaskTemplateSkeleton: (templateId: string, formOverrides?: Partial<StudioFormState>) => Promise<void>;
  applyControlledWorkflowBlockForTest: (
    block: ControlledWorkflowBlockForTest,
    settingsTemplateId: StudioTemplateId,
  ) => Promise<void>;
  refreshTaskTemplateContracts: () => Promise<number>;
  refreshModelIndexes: () => Promise<void>;
  installHfModel: (repoId: string, repair?: boolean, files?: string[]) => Promise<unknown>;
  runActiveTemplate: () => Promise<GalleryRunResult>;
  runPreparedTemplateGraph: (graph: APIGraphExport) => Promise<GalleryRunResult>;
  applyNodeDefinitionForAction: (action: string, params: Record<string, unknown>) => boolean;
  inspectCurrentGraph: () => unknown;
  inspectRunReadiness: () => unknown;
  inspectStudioGraphBindingDivergence: () => unknown;
  exportWorkflowGraph: () => unknown;
  exportAuthorizedApiGraph: () => unknown;
  prepareWorkflowGraphForExport: () => Promise<unknown>;
  arrangeWorkflowGraphSnapshot: (graph: {
    nodes?: CustomNodeType[];
    edges?: import('@xyflow/react').Edge[];
  }) => unknown;
  setGraphScenarioForTest: (scenario: GraphScenarioForTest) => void;
  loadUserBlockForTest: (definition: UserBlockDefinition) => string;
  toggleUserBlockForTest: (id: string) => void;
  addCustomNodeForTest: (key?: string) => string;
  connectGraph: (connection: GraphConnectionForTest) => void;
  setFirstNodeCollapsedByAction: (action: string, collapsed: boolean) => boolean;
  setFirstNodePositionByAction: (action: string, position: { x: number; y: number }) => boolean;
  setFirstNodeSizeByAction: (action: string, size: { width: number; height: number }) => boolean;
  selectFirstNodeByAction: (action: string) => boolean;
  selectNodesByAction: (actions: string[]) => number;
  setWebsocketConnection: (connection: { sid?: string | null; isConnected?: boolean }) => void;
  setStudioFormForTest: (form: Partial<StudioFormState>) => void;
  bindManagedGraphForTest: (form: Partial<StudioFormState>, nodes: Partial<Record<StudioGraphRole, string>>) => boolean;
  startManagedGraphFinalizationForTest: () => Promise<void>;
  waitForManagedGraphFinalizationForTest: () => Promise<void>;
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
  rehydrateActiveWorkflowCanvasForTest: () => void;
  setWorkspacePanelOpenForTest: (open: boolean) => void;
  sendWebsocketMessage: (message: unknown) => void;
};

declare global {
  interface Window {
    __MODIFF_E2E__?: ModiffE2EHooks;
  }
}

// Gallery qualification sometimes performs an explicitly non-exact, low-cost
// screening run before committing to the template's full locked settings. Auto
// planning can legitimately replace generation settings while choosing a local
// artifact, so retain the caller's probe overrides and reapply them only after
// Auto has finished. This is isolated to the E2E bridge; normal Studio runs keep
// the selected template and Auto contracts unchanged.
let pendingGalleryFormOverrides: Partial<StudioFormState> = {};
let managedGraphFinalizationForTest: Promise<void> | null = null;
const GALLERY_GRAPH_FINALIZATION_TIMEOUT_MS = 120_000;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function listTemplates(includePlanning = false): GalleryTemplateSummary[] {
  const templates = includePlanning ? [...STUDIO_TEMPLATES, ...PLANNING_STUDIO_TEMPLATES] : STUDIO_TEMPLATES;
  return templates.map((template) => ({
    id: template.id,
    label: template.label,
    mode: template.mode,
    modelType: template.modelType,
    category: template.category,
    exampleStatus: template.example?.status ?? 'unverified',
    mediaType: template.example?.mediaType ?? 'image',
    thumbnailVariant: template.thumbnailVariant,
    workflowBlocks: [...(template.workflowBlocks ?? [])],
    runtimeReuseKey: template.runtimeReuseKey,
  }));
}

function listTaskTemplateSkeletons() {
  return cloneJson(useNodesStore.getState().studioTaskTemplateSkeletons);
}

async function applyTaskTemplateSkeleton(templateId: string, formOverrides: Partial<StudioFormState> = {}) {
  await useNodesStore.getState().fetchStudioModelCapabilities();
  const template = useNodesStore
    .getState()
    .studioTaskTemplateSkeletons.find((candidate) => candidate.id === templateId);
  if (!template) throw new Error(`Unknown Studio task-template skeleton: ${templateId}`);

  if (!useStudioStore.getState().workflowCanvasHydrated) {
    useStudioStore.getState().hydrateActiveWorkflowCanvas();
  }
  setGraphScenarioForTest('empty');
  const form = {
    ...getFormDefaultsForMode(template.mode, template.modelType),
    ...formOverrides,
  };
  useStudioStore.getState().updateForm(form);
  const context = captureWorkflowOperationContext();
  await createOrUpdateStudioGraph(useStudioStore.getState().form, context, GALLERY_GRAPH_FINALIZATION_TIMEOUT_MS);
  const autoReady = await ensureStudioAutoPlanReadyForRun(context);
  if (!autoReady) {
    throw new Error(
      useStudioStore.getState().lastError ?? 'Auto could not choose a runnable local plan for this workflow.',
    );
  }
  await createOrUpdateStudioGraph(useStudioStore.getState().form, context, GALLERY_GRAPH_FINALIZATION_TIMEOUT_MS);
  pendingGalleryFormOverrides = { ...formOverrides };
  useStudioStore.getState().saveActiveWorkflowTab(true);
}

async function applyTemplate(templateId: StudioTemplateId, formOverrides: Partial<StudioFormState> = {}) {
  const template = [...STUDIO_TEMPLATES, ...PLANNING_STUDIO_TEMPLATES].find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Unknown Studio template: ${templateId}`);
  }
  await useNodesStore.getState().fetchStudioModelCapabilities();

  if (!useStudioStore.getState().workflowCanvasHydrated) {
    useStudioStore.getState().hydrateActiveWorkflowCanvas();
  }
  useFlowStore.getState().replaceGraph({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  useStudioStore.getState().setGraphBinding(null);
  const inputDefaults = await materializeTemplateDefaultInputs(template);
  useStudioStore.getState().applyTemplate(template, inputDefaults);
  pendingGalleryFormOverrides = { ...formOverrides };
  if (Object.keys(formOverrides).length > 0) {
    useStudioStore.getState().updateForm(formOverrides);
  }
  const workflowTabId = useStudioStore.getState().activeWorkflowTabId ?? 'e2e-template-workflow';
  useStudioStore.getState().setCanvasTransition({
    type: 'template_graph_building',
    workflowTabId,
    templateId: template.id,
    startedAt: Date.now(),
  });
  try {
    const context = captureWorkflowOperationContext();
    // Materialize the loader graph before validating Auto's selected target.
    // The app-wide Auto sync is paused by this template transition while the
    // caller owns the initial graph and the subsequent plan commit.
    await createOrUpdateStudioGraph(useStudioStore.getState().form, context, GALLERY_GRAPH_FINALIZATION_TIMEOUT_MS);
    const autoReady = await ensureStudioAutoPlanReadyForRun(context);
    if (!autoReady) {
      throw new Error(
        useStudioStore.getState().lastError ?? 'Auto could not choose a runnable local plan for this workflow.',
      );
    }
    await createOrUpdateStudioGraph(useStudioStore.getState().form, context, GALLERY_GRAPH_FINALIZATION_TIMEOUT_MS);
    for (const block of template.workflowBlocks ?? []) {
      if (block === 'lora') {
        await addLoraWorkflowBlock(useStudioStore.getState().form, template.workflowBlockSettings?.lora, {
          graphPrepared: true,
          workflowContext: context,
        });
      } else if (block === 'upscaler') {
        await addUpscaleWorkflowBlock(useStudioStore.getState().form, template.workflowBlockSettings?.upscaler, {
          graphPrepared: true,
          workflowContext: context,
        });
      } else if (block === 'video_sequence') {
        await addVideoSequenceWorkflowBlock(
          useStudioStore.getState().form,
          template.workflowBlockSettings?.videoSequence,
          { graphPrepared: true, workflowContext: context },
        );
      } else if (block === 'quality_video_sequence') {
        await addQualityVideoSequenceWorkflowBlock(
          useStudioStore.getState().form,
          template.workflowBlockSettings?.qualityVideoSequence,
          { graphPrepared: true, workflowContext: context },
        );
      } else if (block === 'soundtrack') {
        await addSoundtrackWorkflowBlock(useStudioStore.getState().form, template.workflowBlockSettings?.soundtrack, {
          graphPrepared: true,
          workflowContext: context,
        });
      } else {
        await addLyricVideoWorkflowBlock(useStudioStore.getState().form, template.workflowBlockSettings?.lyricVideo, {
          graphPrepared: true,
          workflowContext: context,
        });
      }
    }
    const blocksFinalized = await waitForStudioGraphFinalization(GALLERY_GRAPH_FINALIZATION_TIMEOUT_MS, context);
    if (!blocksFinalized) {
      throw new Error('The template workflow blocks did not finish finalizing within 120 seconds.');
    }
    const finalization = useStudioStore.getState().graphFinalization;
    if (finalization?.status === 'error') {
      throw new Error(finalization.message ?? 'The template graph could not be finalized.');
    }
    await waitForGraphNodeMeasurements(() => useFlowStore.getState().nodes, 500);
    await useFlowStore.getState().arrangeGraph({ history: false });
    try {
      validateStudioGraphReadyForRun(useStudioStore.getState().form);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Graph changed.') throw error;
      if (!syncStudioGraphDefinition(useStudioStore.getState().form)) {
        throw new Error('The template graph schema could not be revalidated after layout.');
      }
      validateStudioGraphReadyForRun(useStudioStore.getState().form);
    }
    useStudioStore.getState().saveActiveWorkflowTab(true);
  } catch (error) {
    if (useFlowStore.getState().nodes.length === 0) {
      useStudioStore.getState().setGraphBinding(null);
      useStudioStore.getState().setGraphFinalization(null);
      useStudioStore.getState().saveActiveWorkflowTab(true);
    }
    throw error;
  } finally {
    const transition = useStudioStore.getState().canvasTransition;
    if (transition?.workflowTabId === workflowTabId && transition.templateId === template.id) {
      useStudioStore.getState().setCanvasTransition(null);
    }
  }
}

async function applyControlledWorkflowBlockForTest(
  block: ControlledWorkflowBlockForTest,
  settingsTemplateId: StudioTemplateId,
) {
  const template = [...STUDIO_TEMPLATES, ...PLANNING_STUDIO_TEMPLATES].find((item) => item.id === settingsTemplateId);
  if (!template) throw new Error(`Unknown Studio template: ${settingsTemplateId}`);
  const form = useStudioStore.getState().form;
  if (block === 'upscaler') await addUpscaleWorkflowBlock(form, template.workflowBlockSettings?.upscaler);
  else if (block === 'video_sequence') {
    await addVideoSequenceWorkflowBlock(form, template.workflowBlockSettings?.videoSequence);
  } else if (block === 'quality_video_sequence') {
    await addQualityVideoSequenceWorkflowBlock(form, template.workflowBlockSettings?.qualityVideoSequence);
  } else await addSoundtrackWorkflowBlock(form, template.workflowBlockSettings?.soundtrack);
}

async function prepareWorkflowGraphForExport() {
  await waitForGraphNodeMeasurements(() => useFlowStore.getState().nodes, 500);
  await useFlowStore.getState().arrangeGraph({ history: false });
  return cloneJson(useFlowStore.getState().toObject());
}

function arrangeWorkflowGraphSnapshot(graph: { nodes?: CustomNodeType[]; edges?: import('@xyflow/react').Edge[] }) {
  const nodes = cloneJson(graph.nodes ?? []);
  const edges = cloneJson(graph.edges ?? []);
  return {
    ...cloneJson(graph),
    nodes: arrangeGraphNodes(nodes, edges),
    edges: decorateConnectionEdges(nodes, edges),
  };
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
  try {
    await ensureStudioGraphReadyForRun(useStudioStore.getState().form);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Graph changed.') throw error;
    if (!syncStudioGraphDefinition(useStudioStore.getState().form)) {
      throw new Error('The template graph schema could not be revalidated before run.');
    }
    validateStudioGraphReadyForRun(useStudioStore.getState().form);
  }
  const autoReady = await ensureStudioAutoPlanReadyForRun();
  if (!autoReady) {
    throw new Error(
      useStudioStore.getState().lastError ?? 'Auto could not choose a runnable local plan for this workflow.',
    );
  }
  if (Object.keys(pendingGalleryFormOverrides).length > 0 && useStudioStore.getState().form.resourceMode === 'auto') {
    const autoPlan = useStudioStore.getState().autoResourcePlan;
    const selectedCandidate = autoPlan?.selectedCandidate;
    const generationOverrides = Object.fromEntries(
      (['width', 'height', 'steps', 'guidanceScale', 'negativePrompt', 'maxSequenceLength'] as const).flatMap(
        (field) =>
          pendingGalleryFormOverrides[field] === undefined ? [] : [[field, pendingGalleryFormOverrides[field]]],
      ),
    );
    const updatedCandidate =
      selectedCandidate && Object.keys(generationOverrides).length > 0
        ? {
            ...selectedCandidate,
            generation: { ...selectedCandidate.generation, ...generationOverrides },
          }
        : null;
    const updatedPlan = updatedCandidate
      ? {
          ...autoPlan,
          selectedCandidate: updatedCandidate,
          candidates: autoPlan?.candidates?.map((candidate) =>
            candidate.id === updatedCandidate.id ? updatedCandidate : candidate,
          ),
        }
      : autoPlan;
    if (updatedPlan) {
      // Gallery screening overrides are generation-only. Commit them through
      // the same atomic path as a normal Auto run so updateForm's generic
      // fallback cannot silently replace the selected resource recipe.
      useStudioStore.getState().applyAutoResourcePlan(updatedPlan, pendingGalleryFormOverrides);
    } else {
      useStudioStore.getState().updateForm(pendingGalleryFormOverrides);
    }
  }
  // Auto may apply the selected candidate's model, quantization, dimensions, or
  // offload settings. Gallery probe overrides may then restore bounded
  // generation values. Both changes schedule a managed-graph finalization, so
  // validate only after the final graph is ready as well.
  try {
    await ensureStudioGraphReadyForRun(useStudioStore.getState().form);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Graph changed.') throw error;
    if (!syncStudioGraphDefinition(useStudioStore.getState().form)) {
      throw new Error('The template graph schema could not be revalidated after Auto.');
    }
  }
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

  // Deterministic duplicate capture reuses the exact graph submitted for the
  // first proof, but Auto admission is intentionally live. Refresh and retain
  // the app-selected plan so the prepared graph receives current proof and
  // runtime hints instead of being submitted with an empty Auto contract.
  const autoReady = await ensureStudioAutoPlanReadyForRun();
  if (!autoReady) {
    throw new Error(
      useStudioStore.getState().lastError ?? 'Auto could not choose a runnable local plan for this workflow.',
    );
  }
  await ensureStudioGraphReadyForRun(useStudioStore.getState().form);

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

function bindManagedGraphForTest(
  formPatch: Partial<StudioFormState>,
  roleNodes: Partial<Record<StudioGraphRole, string>>,
) {
  const studio = useStudioStore.getState();
  const form = { ...studio.form, ...formPatch } as StudioFormState;
  useStudioStore.setState({ form });
  const roleByNodeId = new Map(
    Object.entries(roleNodes).flatMap(([role, nodeId]) =>
      typeof nodeId === 'string' ? [[nodeId, role as StudioGraphRole]] : [],
    ),
  );
  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => {
      const role = roleByNodeId.get(node.id);
      return role ? { ...node, data: { ...node.data, studioOwned: true, studioRole: role } } : node;
    }),
  }));
  const now = Date.now();
  const binding: StudioGraphBinding = {
    mode: form.mode,
    modelType: form.modelType,
    nodes: roleNodes,
    managedNodeIds: Array.from(roleByNodeId.keys()),
    managedEdgeIds: [],
    fingerprint: `${form.mode}:${form.modelType}:${form.resourceMode}:${form.quantizationMode}`,
    createdAt: now,
    updatedAt: now,
  };
  useStudioStore.getState().setGraphBinding(binding);
  useStudioStore.getState().setGraphFinalization(null);
  markStudioGraphDefinitionPending();
  return syncStudioGraphDefinition(form);
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
  const replaceScenarioGraph = (graph: Partial<ReturnType<typeof useFlowStore.getState>>) => {
    useFlowStore.setState(graph);
    useStudioStore.getState().saveActiveWorkflowTab(true);
  };

  if (scenario === 'empty') {
    replaceScenarioGraph({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
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
    replaceScenarioGraph({
      nodes: scenario === 'outputless' ? [prompt] : [prompt, preview],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    return;
  }

  if (scenario === 'disconnected_output') {
    replaceScenarioGraph({
      nodes: [prompt, preview],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    return;
  }

  if (scenario === 'disconnected_image_output') {
    const loader = makeGraphScenarioNode('modules.Image.Load', 'scenario-image-load', { x: -360, y: 0 });
    loader.data.params.file = {
      ...loader.data.params.file,
      value: 'data/studio/outputs/fix-contract-input.webp',
    };
    replaceScenarioGraph({
      nodes: [loader, preview],
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
    replaceScenarioGraph({
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
  replaceScenarioGraph({
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

function loadUserBlockForTest(definition: UserBlockDefinition) {
  const node = createUserBlockNode(normalizeUserBlockDefinition(definition), { x: 120, y: 100 });
  useFlowStore.getState().replaceGraph({
    nodes: [node],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  return node.id;
}

function toggleUserBlockForTest(id: string) {
  useFlowStore.getState().toggleUserBlockExpanded(id);
}

let customNodeSequence = 0;

function addCustomNodeForTest(key = 'modules.Image.Preview') {
  customNodeSequence += 1;
  const id = `custom-${Date.now()}-${customNodeSequence}`;
  const node = makeGraphScenarioNode(key, id, { x: 720, y: 220 });
  useFlowStore.getState().addNode(node);
  if (useStudioStore.getState().graphBinding) {
    useStudioStore.getState().detachManagedGraph();
  }
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

function setFirstNodeSizeByAction(action: string, size: { width: number; height: number }) {
  const node = useFlowStore.getState().nodes.find((item) => item.data.action === action);
  if (!node) {
    return false;
  }
  useFlowStore.getState().setNodeSize(node.id, size.width, size.height);
  return true;
}

function selectFirstNodeByAction(action: string) {
  const node = useFlowStore.getState().nodes.find((item) => item.data.action === action);
  if (!node) {
    return false;
  }
  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((item) => ({ ...item, selected: item.id === node.id })),
  }));
  return true;
}

function selectNodesByAction(actions: string[]) {
  const selectedActions = new Set(actions);
  let selectedCount = 0;
  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((item) => {
      const selected = selectedActions.has(item.data.action);
      if (selected) selectedCount += 1;
      return { ...item, selected };
    }),
  }));
  return selectedCount;
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

function setWorkspacePanelOpenForTest(open: boolean) {
  useSettingsStore.getState().setRightPanelOpen(open);
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
            type: node.type,
            dataType: node.data.type,
            parentId: node.parentId,
            selected: node.selected,
            position: node.position,
            module: node.data.module,
            action: node.data.action,
            label: node.data.label,
            category: node.data.category,
            params: Object.fromEntries(
              Object.entries(node.data.params).map(([key, param]) => [
                key,
                {
                  value: param.value,
                  artifacts: param.artifacts,
                  display: param.display,
                  options: param.options,
                  signal: param.signal,
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
            huggingFaceClusterRole: node.data.huggingFaceClusterRole,
            huggingFaceClusterInstance: node.data.huggingFaceClusterInstance,
            huggingFaceClusterInstanceId: node.data.huggingFaceClusterInstanceId,
            huggingFaceClusterExecutionRole: node.data.huggingFaceClusterExecutionRole,
            huggingFaceClusterExecutionAdmissionId: node.data.huggingFaceClusterExecutionAdmissionId,
            blockInstanceV2: node.data.blockInstanceV2,
            blockProjectionOwnerId: node.data.blockProjectionOwnerId,
            blockProjectionNodeId: node.data.blockProjectionNodeId,
          })),
          edges: useFlowStore.getState().edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            blockProjectionOwnerId: edge.data?.blockProjectionOwnerId,
          })),
          historyPast: useFlowStore.getState().historyPast.length,
          historyFuture: useFlowStore.getState().historyFuture.length,
        },
        studio: {
          workflowCanvasHydrated: useStudioStore.getState().workflowCanvasHydrated,
          form: useStudioStore.getState().form,
          graphBinding: useStudioStore.getState().graphBinding,
          graphFinalization: useStudioStore.getState().graphFinalization,
          canvasTransition: useStudioStore.getState().canvasTransition,
          outputs: useStudioStore.getState().outputs,
          importedAssets: useStudioStore.getState().importedAssets,
          workflowTabs: useStudioStore.getState().workflowTabs,
          activeWorkflowTabId: useStudioStore.getState().activeWorkflowTabId,
          activeTemplateId: useStudioStore.getState().activeTemplateId,
          autoResourcePlan: useStudioStore.getState().autoResourcePlan,
          autoFieldOverrides: useStudioStore.getState().autoFieldOverrides,
          currentRunContext: useStudioStore.getState().currentRunContext,
          lastError: useStudioStore.getState().lastError,
        },
        nodes: {
          hfCache: useNodesStore.getState().hfCache,
          localModels: useNodesStore.getState().localModels,
          modelCacheDiagnostics: useNodesStore.getState().modelCacheDiagnostics,
          studioModelCapabilities: useNodesStore.getState().studioModelCapabilities,
          hfDownloadProgress: useNodesStore.getState().hfDownloadProgress,
          optionalRuntimeCatalog: useNodesStore.getState().optionalRuntimeCatalog,
          discoveryRequests: useNodesStore.getState().discoveryRequests,
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
          studioViewMode: useSettingsStore.getState().studioViewMode,
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
        huggingFaceClusterRuntime: {
          authorities: useHuggingFaceClusterRuntimeStore.getState().authorities,
        },
      }),
    listTemplates,
    listTaskTemplateSkeletons,
    applyTemplate,
    applyTaskTemplateSkeleton,
    applyControlledWorkflowBlockForTest,
    refreshTaskTemplateContracts: async () => {
      await useNodesStore.getState().fetchStudioModelCapabilities();
      return useNodesStore.getState().studioTaskTemplateSkeletons.length;
    },
    refreshModelIndexes: (refresh = true) => useNodesStore.getState().refreshModelIndexes(refresh),
    inspectDiscovery: () => {
      const nodes = useNodesStore.getState();
      const cache = Array.isArray(nodes.hfCache) ? nodes.hfCache : [];
      const ids = cache.map((item) =>
        item && typeof item === 'object' && 'id' in item ? String(item.id) : String(item),
      );
      return {
        hfCacheCount: cache.length,
        hfCacheStatus: nodes.discoveryRequests.hfCache.status,
        optionalRuntimesStatus: nodes.discoveryRequests.optionalRuntimes.status,
        capabilitiesStatus: nodes.discoveryRequests.capabilities.status,
        processLoadStatus: nodes.optionalRuntimeCatalog?.processLoadStatus ?? null,
        profiles: (nodes.optionalRuntimeCatalog?.profiles ?? []).map((profile) => ({
          id: profile.id,
          overlayStatus: profile.overlayStatus,
          cutoverReady: profile.cutoverReady,
          contractState: profile.contractState,
          status: profile.status,
        })),
        sampleCacheIds: ids.slice(0, 8),
        hasLcm: ids.some((id) => id.includes('LCM_Dreamshaper_v7')),
      };
    },
    installHfModel: (repoId: string, repair = false, files: string[] = []) =>
      useNodesStore.getState().installHfModel(repoId, useWebsocketStore.getState().sid, { repair, files }),
    runActiveTemplate,
    runPreparedTemplateGraph,
    applyNodeDefinitionForAction,
    inspectCurrentGraph: () => cloneJson(inspectCurrentGraph()),
    inspectRunReadiness: () =>
      cloneJson(
        validateCurrentRun({
          sid: useWebsocketStore.getState().sid,
          isConnected: useWebsocketStore.getState().isConnected,
          includeStudio: true,
          showDialog: false,
        }),
      ),
    inspectStudioGraphBindingDivergence: () => cloneJson(inspectStudioGraphBindingDivergence()),
    exportWorkflowGraph: () => cloneJson(useFlowStore.getState().toObject()),
    exportAuthorizedApiGraph: () => {
      const sid = useWebsocketStore.getState().sid;
      if (!sid) throw new Error('Backend session is unavailable.');
      return cloneJson(applyHuggingFaceClusterRuntimeHints(useFlowStore.getState().exportGraph(sid)));
    },
    prepareWorkflowGraphForExport,
    arrangeWorkflowGraphSnapshot,
    setGraphScenarioForTest,
    loadUserBlockForTest,
    toggleUserBlockForTest,
    addCustomNodeForTest,
    connectGraph,
    setFirstNodeCollapsedByAction,
    setFirstNodePositionByAction,
    setFirstNodeSizeByAction,
    selectFirstNodeByAction,
    selectNodesByAction,
    setWebsocketConnection,
    setStudioFormForTest: (form: Partial<StudioFormState>) => {
      useStudioStore.getState().updateForm(form);
      useStudioStore.getState().setLauncherDismissed(true);
    },
    bindManagedGraphForTest,
    startManagedGraphFinalizationForTest: () => {
      managedGraphFinalizationForTest = createOrUpdateStudioGraph().then(() => undefined);
      return managedGraphFinalizationForTest;
    },
    waitForManagedGraphFinalizationForTest: async () => {
      if (managedGraphFinalizationForTest) return managedGraphFinalizationForTest;
      if (!(await waitForStudioGraphFinalization(30_000))) {
        throw new Error('The restored managed graph did not finish finalizing.');
      }
    },
    startStudioRunForTest,
    seedStudioOutputsForTest,
    seedImportedAssetsForTest,
    openWorkspacePanelForTest,
    rehydrateActiveWorkflowCanvasForTest: () => useStudioStore.getState().hydrateActiveWorkflowCanvas(),
    setWorkspacePanelOpenForTest,
    sendWebsocketMessage,
  };

  window.__MODIFF_E2E__ = hooks;
}
