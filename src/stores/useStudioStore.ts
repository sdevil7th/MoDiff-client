import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import {
  DEFAULT_STUDIO_FORM,
  STUDIO_MODEL_PROFILES,
  getDefaultModeForModel,
  getFormDefaultsForMode,
  getProfileForForm,
  isModelCompatibleWithMode,
} from '../studio/modelProfiles';
import {
  coerceStudioFormState,
  coerceStudioGraphBinding,
  coerceStudioOutput,
  coerceStudioTemplateId,
  isRecord,
  optionalNullableString,
  safeCloneJson,
} from '../studio/outputContracts';
import { deleteStudioOutput, fetchStudioOutputs, setStudioOutputFavorite, syncStudioOutput } from '../studio/outputApi';
import { resolveStudioResourceForm } from '../studio/resourcePlanner';
import {
  firstImageValue,
  firstAudioValue,
  firstVideoValue,
  isLikelyAudioValue,
  isLikelyImageValue,
  isLikelyVideoValue,
  resolveStudioAudioUrl,
  resolveStudioImageUrl,
  resolveStudioVideoUrl,
} from '../studio/outputUtils';
import {
  getPromptSettingsHash,
  getTemplateLockHash,
  getTemplateLockedSettings,
  hashString,
  isTemplateExactEligible,
  stableStringify,
} from '../studio/templateExactness';
import { STUDIO_TEMPLATES, getPreset } from '../studio/templates';
import { migrateLocalStorageKey } from '../utils/persistMigration';
import { createLatestRequestGate, formatRequestError, requestBlob } from '../utils/requestJson';
import type { MediaArtifact } from '../utils/imageArtifacts';
import type { StudioAutoResourcePlan } from '../studio/autoResource';
import type {
  AppModeConfig,
  AppModeInput,
  AppModeOutput,
  StudioFormState,
  StudioGraphFinalizationState,
  StudioGraphBinding,
  StudioGraphSnapshot,
  StudioImportedAsset,
  StudioMode,
  StudioOutput,
  StudioOutputMediaItem,
  StudioPreset,
  StudioRunContext,
  StudioTemplate,
  StudioTemplateId,
  WorkflowBlueprint,
  WorkflowTab,
  WorkflowTabSnapshot,
  UserBlockDefinition,
} from '../studio/types';
import { useFlowStore } from './useFlowStore';
import { useUserBlockStore } from './useUserBlockStore';

export type StudioRecentChange = {
  id: string;
  label: string;
  fields: Array<{ key: keyof StudioFormState; label: string; before: unknown; after: unknown }>;
  createdAt: number;
};

type StudioState = {
  selectedMode: StudioMode;
  form: StudioFormState;
  promptHistory: string[];
  savedSnippets: string[];
  negativePromptPresets: string[];
  activeTemplateId: StudioTemplateId | null;
  sourceOutputId: string | null;
  outputs: StudioOutput[];
  importedAssets: StudioImportedAsset[];
  workflowTabs: WorkflowTab[];
  activeWorkflowTabId: string | null;
  appModeConfigs: AppModeConfig[];
  activeAppModeConfigId: string | null;
  blueprints: WorkflowBlueprint[];
  pinnedGraphInputIds: string[];
};

type StudioVolatileState = {
  graphBinding: StudioGraphBinding | null;
  graphFinalization: StudioGraphFinalizationState | null;
  autoResourcePlan: StudioAutoResourcePlan | null;
  autoResourcePlans: Record<string, StudioAutoResourcePlan>;
  autoResourceCheck: {
    status: 'idle' | 'checking' | 'probing';
    message: string | null;
    startedAt: number | null;
  };
  canvasTransition: {
    type: 'template_graph_building';
    workflowTabId: string;
    templateId: StudioTemplateId;
    startedAt: number;
  } | null;
  launcherDismissed: boolean;
  currentRunContext: StudioRunContext | null;
  runContextsByClientRunId: Record<string, StudioRunContext>;
  runContextsByTaskId: Record<string, StudioRunContext>;
  lastError: string | null;
  recentChange: StudioRecentChange | null;
  galleryBackendStatus: 'idle' | 'loading' | 'syncing' | 'error';
  galleryBackendError: string | null;
  galleryRequests: Record<GalleryRequestKey, { error: string | null; pending: number }>;
  outputRevision: number;
};

type GalleryRequestKey = 'history' | 'mutation' | 'sync';

type StudioActions = {
  selectMode: (mode: StudioMode) => void;
  updateForm: (values: Partial<StudioFormState>) => void;
  applyPreset: (preset: StudioPreset) => void;
  applyTemplate: (template: StudioTemplate) => void;
  setGraphBinding: (binding: StudioGraphBinding | null) => void;
  setGraphFinalization: (finalization: StudioGraphFinalizationState | null) => void;
  setAutoResourcePlan: (plan: StudioAutoResourcePlan | null) => void;
  setAutoResourcePlans: (plans: Record<string, StudioAutoResourcePlan>) => void;
  setAutoResourceCheck: (check: Partial<StudioVolatileState['autoResourceCheck']>) => void;
  clearGraphBinding: () => void;
  setCanvasTransition: (transition: StudioVolatileState['canvasTransition']) => void;
  setLauncherDismissed: (dismissed: boolean) => void;
  resetWorkflowSession: () => void;
  addPromptHistory: (prompt: string) => void;
  saveCurrentPromptAsSnippet: () => void;
  removeSnippet: (snippet: string) => void;
  applySnippet: (snippet: string) => void;
  applyNegativePreset: (preset: string) => void;
  setReferenceImages: (images: string[]) => void;
  addReferenceImage: (image: string) => void;
  replaceReferenceImage: (index: number, image: string) => void;
  removeReferenceImage: (index: number) => void;
  moveReferenceImage: (index: number, direction: -1 | 1) => void;
  useOutputAsReference: (output: StudioOutput) => void;
  addImportedAssets: (assets: StudioImportedAsset[]) => void;
  deleteImportedAsset: (id: string) => void;
  useImportedAssetAsReference: (asset: StudioImportedAsset) => void;
  captureRunContext: (
    apiGraph?: unknown,
    variation?: Pick<StudioRunContext, 'variationGroupId' | 'variationLabel'>,
    identity?: { clientRunId: string; runInputHash: string },
  ) => StudioRunContext;
  clearRunContext: () => void;
  restoreWorkflowFromOutput: (output: StudioOutput) => void;
  shouldAcceptRunOutputUpdate: (taskId?: string | null, clientRunId?: string | null) => boolean;
  shouldApplyRunUpdateToActiveWorkflow: (taskId?: string | null, clientRunId?: string | null) => boolean;
  markRunContextStatus: (
    taskId: string | null | undefined,
    clientRunId: string | null | undefined,
    status: NonNullable<StudioRunContext['status']>,
  ) => void;
  clearChangedPreviewFieldsForRun: (runInputHash: string) => void;
  clearPreviewFieldsForFailedRun: (taskId?: string | null, clientRunId?: string | null) => void;
  recordOutputFromUpdate: (
    nodeId: string,
    fieldKey: string,
    value: unknown,
    metadata?: {
      taskId?: string | null;
      clientRunId?: string | null;
      runInputHash?: string | null;
      attemptIndex?: number;
      runtimeFingerprint?: unknown;
      dataType?: string | string[];
      artifacts?: unknown;
    },
  ) => void;
  attachRunResponse: (response: unknown, clientRunId?: string) => void;
  fetchBackendOutputs: () => Promise<void>;
  syncOutputToBackend: (output: StudioOutput) => Promise<void>;
  toggleFavoriteOutput: (id: string) => void;
  deleteOutput: (id: string) => void;
  setLastError: (error: string | null) => void;
  ensureWorkflowTabs: () => void;
  saveActiveWorkflowTab: (dirty?: boolean) => void;
  createWorkflowTab: (
    title?: string,
    snapshot?: WorkflowTabSnapshot,
    source?: WorkflowTab['source'],
    sourceLabel?: string,
  ) => string;
  switchWorkflowTab: (id: string) => void;
  closeWorkflowTab: (id: string) => void;
  renameWorkflowTab: (id: string, title: string) => void;
  createAppModeConfig: (workflowTabId?: string | null) => string | null;
  updateAppModeConfig: (
    id: string,
    values: Partial<Pick<AppModeConfig, 'name' | 'exposedInputs' | 'exposedOutputs'>>,
  ) => void;
  deleteAppModeConfig: (id: string) => void;
  setActiveAppModeConfig: (id: string | null) => void;
  setPinnedGraphInputIds: (ids: string[]) => void;
  togglePinnedGraphInput: (id: string) => void;
  createBlueprintFromSelection: (name?: string) => string | null;
  insertBlueprint: (id: string) => void;
  deleteBlueprint: (id: string) => void;
  setRecentChange: (change: StudioRecentChange | null) => void;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function currentGraphSnapshot(): StudioGraphSnapshot {
  const flow = useFlowStore.getState().toObject();
  return cloneJson({
    nodes: flow.nodes,
    edges: flow.edges,
    viewport: flow.viewport,
  });
}

function currentWorkflowSnapshot(
  state: Pick<
    StudioState & StudioVolatileState,
    'form' | 'selectedMode' | 'graphBinding' | 'activeTemplateId' | 'sourceOutputId' | 'pinnedGraphInputIds'
  >,
): WorkflowTabSnapshot {
  const graph = currentGraphSnapshot();
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    viewport: graph.viewport,
    studioForm: cloneJson(state.form),
    studioGraphBinding: state.graphBinding ? cloneJson(state.graphBinding) : null,
    selectedMode: state.selectedMode,
    activeTemplateId: state.activeTemplateId,
    sourceOutputId: state.sourceOutputId,
    pinnedGraphInputIds: cloneJson(state.pinnedGraphInputIds),
    userBlocks: cloneJson(useUserBlockStore.getState().blocks),
  };
}

function blankWorkflowSnapshot(): WorkflowTabSnapshot {
  return {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    studioForm: cloneJson(resolveStudioResourceForm(DEFAULT_STUDIO_FORM)),
    studioGraphBinding: null,
    selectedMode: DEFAULT_STUDIO_FORM.mode,
    activeTemplateId: null,
    sourceOutputId: null,
    pinnedGraphInputIds: [],
    userBlocks: [],
  };
}

function safeUserBlocks(value: unknown): UserBlockDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is UserBlockDefinition =>
      isRecord(item) &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      item.version === 1 &&
      Array.isArray(item.nodes) &&
      Array.isArray(item.edges) &&
      Array.isArray(item.inputs) &&
      Array.isArray(item.outputs) &&
      Array.isArray(item.exposedParams),
  );
}

function normalizeWorkflowSnapshot(snapshot: unknown): WorkflowTabSnapshot {
  const value = isRecord(snapshot) ? snapshot : {};
  const studioForm = resolveStudioResourceForm(coerceStudioFormState(value.studioForm));
  return {
    nodes: Array.isArray(value.nodes) ? (safeCloneJson(value.nodes) as unknown[]) : [],
    edges: Array.isArray(value.edges) ? (safeCloneJson(value.edges) as unknown[]) : [],
    viewport: value.viewport === undefined ? undefined : safeCloneJson(value.viewport),
    studioForm,
    studioGraphBinding: coerceStudioGraphBinding(value.studioGraphBinding),
    selectedMode: studioForm.mode,
    activeTemplateId: coerceStudioTemplateId(value.activeTemplateId) ?? null,
    sourceOutputId: typeof value.sourceOutputId === 'string' ? value.sourceOutputId : null,
    pinnedGraphInputIds: Array.isArray(value.pinnedGraphInputIds)
      ? value.pinnedGraphInputIds.filter((item): item is string => typeof item === 'string')
      : [],
    userBlocks: safeUserBlocks(value.userBlocks),
  };
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isStudioImportedAsset(value: unknown): value is StudioImportedAsset {
  if (!isRecord(value)) return false;
  if (value.kind !== 'imported') return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.url !== 'string') return false;
  return ['image', 'video', 'audio', 'unknown'].includes(String(value.displayType));
}

const WORKFLOW_TAB_SOURCES: NonNullable<WorkflowTab['source']>[] = ['new', 'import', 'template', 'gallery', 'manual'];

function workflowTabSource(value: unknown): WorkflowTab['source'] | undefined {
  return typeof value === 'string' && WORKFLOW_TAB_SOURCES.includes(value as NonNullable<WorkflowTab['source']>)
    ? (value as NonNullable<WorkflowTab['source']>)
    : undefined;
}

function workflowTabSourceLabel(source: WorkflowTab['source'] | undefined, value: unknown) {
  if (source === 'template') {
    return coerceStudioTemplateId(value) ?? (typeof value === 'string' ? value : undefined);
  }
  return typeof value === 'string' ? value : undefined;
}

function normalizeWorkflowTab(value: unknown): WorkflowTab | undefined {
  if (!isRecord(value)) return undefined;
  const createdAt = finiteNumber(value.createdAt, Date.now());
  const source = workflowTabSource(value.source);
  return {
    id: typeof value.id === 'string' && value.id ? value.id : nanoid(),
    title: typeof value.title === 'string' && value.title.trim() ? value.title : 'Workflow',
    createdAt,
    updatedAt: finiteNumber(value.updatedAt, createdAt),
    dirty: typeof value.dirty === 'boolean' ? value.dirty : false,
    source,
    sourceLabel: workflowTabSourceLabel(source, value.sourceLabel),
    snapshot: normalizeWorkflowSnapshot(value.snapshot),
  };
}

function normalizeWorkflowTabs(tabs: unknown[]) {
  return tabs.map(normalizeWorkflowTab).filter((tab): tab is WorkflowTab => Boolean(tab));
}

function applyWorkflowSnapshot(snapshot: WorkflowTabSnapshot) {
  const flow = useFlowStore.getState();
  flow.replaceGraph({
    nodes: cloneJson(snapshot.nodes) as typeof flow.nodes,
    edges: cloneJson(snapshot.edges) as typeof flow.edges,
    viewport: (cloneJson(snapshot.viewport) as typeof flow.viewport) ?? flow.viewport,
  });
}

function savedTabsWithActiveSnapshot(state: StudioState & StudioVolatileState) {
  if (!state.activeWorkflowTabId) return state.workflowTabs;
  const snapshot = currentWorkflowSnapshot(state);
  return state.workflowTabs.map((tab) =>
    tab.id === state.activeWorkflowTabId ? { ...tab, snapshot, updatedAt: Date.now(), dirty: true } : tab,
  );
}

function normalizePersistedStudioState(
  persistedState: unknown,
  currentState: StudioState & StudioVolatileState & StudioActions,
): StudioState & StudioVolatileState & StudioActions {
  if (!isRecord(persistedState)) return currentState;
  const mergedState = {
    ...currentState,
    ...persistedState,
  } as StudioState & StudioVolatileState & StudioActions;
  const form = resolveStudioResourceForm(coerceStudioFormState(mergedState.form));
  return {
    ...mergedState,
    selectedMode: form.mode,
    form,
    activeTemplateId: coerceStudioTemplateId(mergedState.activeTemplateId) ?? null,
    outputs: Array.isArray(mergedState.outputs)
      ? mergedState.outputs.map(coerceStudioOutput).filter((output): output is StudioOutput => Boolean(output))
      : currentState.outputs,
    importedAssets: Array.isArray(mergedState.importedAssets)
      ? mergedState.importedAssets.filter(isStudioImportedAsset).slice(0, 24)
      : currentState.importedAssets,
    workflowTabs: Array.isArray(mergedState.workflowTabs)
      ? normalizeWorkflowTabs(mergedState.workflowTabs)
      : currentState.workflowTabs,
    pinnedGraphInputIds: Array.isArray(mergedState.pinnedGraphInputIds)
      ? mergedState.pinnedGraphInputIds.filter((item): item is string => typeof item === 'string')
      : currentState.pinnedGraphInputIds,
  };
}

function isFlowNode(value: unknown): value is {
  id: string;
  position?: { x?: number; y?: number };
  data?: {
    label?: string;
    params?: Record<string, { value?: unknown; default?: unknown; label?: string; isInput?: boolean }>;
  };
  selected?: boolean;
} {
  return isRecord(value) && typeof value.id === 'string';
}

function isFlowEdge(value: unknown): value is { id?: string; source: string; target: string } {
  return isRecord(value) && typeof value.source === 'string' && typeof value.target === 'string';
}

function studioFormInputs(): AppModeInput[] {
  return [
    { id: 'studio:prompt', kind: 'studio-form', label: 'Prompt', formKey: 'prompt' },
    { id: 'studio:negativePrompt', kind: 'studio-form', label: 'Negative prompt', formKey: 'negativePrompt' },
    { id: 'studio:seed', kind: 'studio-form', label: 'Seed', formKey: 'seed' },
    { id: 'studio:steps', kind: 'studio-form', label: 'Steps', formKey: 'steps' },
    { id: 'studio:guidanceScale', kind: 'studio-form', label: 'Guidance', formKey: 'guidanceScale' },
    { id: 'studio:strength', kind: 'studio-form', label: 'Strength', formKey: 'strength' },
    { id: 'studio:width', kind: 'studio-form', label: 'Width', formKey: 'width' },
    { id: 'studio:height', kind: 'studio-form', label: 'Height', formKey: 'height' },
    { id: 'studio:referenceImages', kind: 'studio-form', label: 'Reference images', formKey: 'referenceImages' },
    { id: 'studio:controlImage', kind: 'studio-form', label: 'Control image', formKey: 'controlImage' },
    { id: 'studio:maskImage', kind: 'studio-form', label: 'Mask image', formKey: 'maskImage' },
    { id: 'studio:sourceVideo', kind: 'studio-form', label: 'Source video', formKey: 'sourceVideo' },
    { id: 'studio:maskVideo', kind: 'studio-form', label: 'Mask video', formKey: 'maskVideo' },
    { id: 'studio:controlVideo', kind: 'studio-form', label: 'Control video', formKey: 'controlVideo' },
  ];
}

function graphParamInputs(nodes: unknown[]): AppModeInput[] {
  return nodes.filter(isFlowNode).flatMap((node) =>
    Object.entries(node.data?.params ?? {})
      .filter(([key, param]) => !param.isInput && !['image', 'output', 'images', 'latents'].includes(key))
      .slice(0, 8)
      .map(([key, param]) => ({
        id: `graph:${node.id}:${key}`,
        kind: 'graph-param' as const,
        label: `${node.data?.label || node.id} / ${param.label || key}`,
        nodeId: node.id,
        paramKey: key,
      })),
  );
}

function graphOutputs(nodes: unknown[]): AppModeOutput[] {
  return nodes
    .filter(isFlowNode)
    .filter((node) => /preview|save|output|video|audio|image/i.test(`${node.data?.label ?? ''} ${node.id}`))
    .map((node) => ({
      id: `output:${node.id}`,
      label: node.data?.label || node.id,
      nodeId: node.id,
      fieldKey: 'output',
    }));
}

function defaultAppModeConfig(tab: WorkflowTab): AppModeConfig {
  return {
    id: nanoid(),
    workflowTabId: tab.id,
    name: `${tab.title} app`,
    exposedInputs: [...studioFormInputs().slice(0, 5), ...graphParamInputs(tab.snapshot.nodes).slice(0, 6)],
    exposedOutputs: graphOutputs(tab.snapshot.nodes).slice(0, 4),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const defaultState: StudioState = {
  selectedMode: DEFAULT_STUDIO_FORM.mode,
  form: resolveStudioResourceForm(DEFAULT_STUDIO_FORM),
  promptHistory: [],
  savedSnippets: [],
  negativePromptPresets: [
    'blurry, low quality, artifacts',
    'misspelled text, warped letters, unreadable typography',
    'distorted anatomy, extra fingers, broken hands',
    'flicker, jitter, temporal inconsistency, warped motion, frame tearing, watermark',
  ],
  activeTemplateId: null,
  sourceOutputId: null,
  outputs: [],
  importedAssets: [],
  workflowTabs: [],
  activeWorkflowTabId: null,
  appModeConfigs: [],
  activeAppModeConfigId: null,
  blueprints: [],
  pinnedGraphInputIds: [],
};

const defaultVolatileState: StudioVolatileState = {
  graphBinding: null,
  graphFinalization: null,
  autoResourcePlan: null,
  autoResourcePlans: {},
  autoResourceCheck: {
    status: 'idle',
    message: null,
    startedAt: null,
  },
  canvasTransition: null,
  launcherDismissed: false,
  currentRunContext: null,
  runContextsByClientRunId: {},
  runContextsByTaskId: {},
  lastError: null,
  recentChange: null,
  galleryBackendStatus: 'idle',
  galleryBackendError: null,
  galleryRequests: {
    history: { error: null, pending: 0 },
    mutation: { error: null, pending: 0 },
    sync: { error: null, pending: 0 },
  },
  outputRevision: 0,
};

const MAX_RUN_CONTEXTS = 50;
const MAX_TERMINAL_RUN_CONTEXTS = 20;
const TERMINAL_RUN_STATUSES = new Set<StudioRunContext['status']>(['completed', 'failed', 'cancelled']);
const outputHistoryRequestGate = createLatestRequestGate<'outputs'>();
const outputMutationVersions = new Map<string, number>();
let nextOutputMutationVersion = 0;

function galleryRequestPatch(
  state: StudioVolatileState,
  key: GalleryRequestKey,
  pendingDelta: number,
  error?: string | null,
): Pick<StudioVolatileState, 'galleryBackendError' | 'galleryBackendStatus' | 'galleryRequests'> {
  const current = state.galleryRequests[key];
  const galleryRequests = {
    ...state.galleryRequests,
    [key]: {
      error: error === undefined ? current.error : error,
      pending: Math.max(0, current.pending + pendingDelta),
    },
  };
  const galleryBackendError =
    galleryRequests.mutation.error ?? galleryRequests.sync.error ?? galleryRequests.history.error ?? null;
  const galleryBackendStatus =
    galleryRequests.history.pending > 0
      ? 'loading'
      : galleryRequests.mutation.pending > 0 || galleryRequests.sync.pending > 0
        ? 'syncing'
        : galleryBackendError
          ? 'error'
          : 'idle';
  return { galleryRequests, galleryBackendError, galleryBackendStatus };
}

function beginOutputMutation(id: string) {
  const version = ++nextOutputMutationVersion;
  outputMutationVersions.set(id, version);
  return {
    isLatest: () => outputMutationVersions.get(id) === version,
    finish: () => {
      if (outputMutationVersions.get(id) === version) outputMutationVersions.delete(id);
    },
  };
}

function withBoundedRunContext(
  contexts: Record<string, StudioRunContext>,
  key: string,
  context: StudioRunContext,
): Record<string, StudioRunContext> {
  return Object.fromEntries(
    [...Object.entries(contexts).filter(([contextKey]) => contextKey !== key), [key, context]].slice(-MAX_RUN_CONTEXTS),
  );
}

function matchingRunContext(
  state: Pick<StudioVolatileState, 'currentRunContext' | 'runContextsByClientRunId' | 'runContextsByTaskId'>,
  taskId?: string | null,
  clientRunId?: string | null,
) {
  const normalizedTaskId = typeof taskId === 'string' && taskId.trim() ? taskId : null;
  const normalizedClientRunId = typeof clientRunId === 'string' && clientRunId.trim() ? clientRunId : null;
  const taskContext = normalizedTaskId ? state.runContextsByTaskId[normalizedTaskId] : undefined;
  const clientContext = normalizedClientRunId ? state.runContextsByClientRunId[normalizedClientRunId] : undefined;
  if (taskContext && normalizedClientRunId && taskContext.clientRunId !== normalizedClientRunId) return null;
  if (clientContext && normalizedTaskId && clientContext.run?.taskId && clientContext.run.taskId !== normalizedTaskId)
    return null;
  return taskContext ?? clientContext ?? null;
}

function pruneTerminalRunContexts(
  contextsByClientRunId: Record<string, StudioRunContext>,
  contextsByTaskId: Record<string, StudioRunContext>,
  currentClientRunId?: string,
) {
  const terminalContexts = Object.values(contextsByClientRunId)
    .filter((context) => context.status && TERMINAL_RUN_STATUSES.has(context.status))
    .sort((left, right) => (right.completedAt ?? 0) - (left.completedAt ?? 0));
  const retainedTerminalIds = new Set(
    terminalContexts.slice(0, MAX_TERMINAL_RUN_CONTEXTS).map((context) => context.clientRunId),
  );
  if (currentClientRunId) retainedTerminalIds.add(currentClientRunId);
  const nextByClientRunId = Object.fromEntries(
    Object.entries(contextsByClientRunId).filter(
      ([, context]) =>
        !context.status || !TERMINAL_RUN_STATUSES.has(context.status) || retainedTerminalIds.has(context.clientRunId),
    ),
  );
  const nextByTaskId = Object.fromEntries(
    Object.entries(contextsByTaskId).filter(
      ([, context]) =>
        !context.status || !TERMINAL_RUN_STATUSES.has(context.status) || retainedTerminalIds.has(context.clientRunId),
    ),
  );
  return { nextByClientRunId, nextByTaskId };
}

function outputKey(output: StudioOutput) {
  return output.id || `${output.nodeId}:${output.fieldKey}:${output.url}`;
}

function mergeOutputs(preferred: StudioOutput[], fallback: StudioOutput[]) {
  const merged = new Map<string, StudioOutput>();
  [...preferred, ...fallback].forEach((output) => {
    const key = outputKey(output);
    if (!key || merged.has(key)) return;
    merged.set(key, output);
  });

  return Array.from(merged.values())
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
    .slice(0, 80);
}

export function outputsForWorkflow(
  outputs: StudioOutput[],
  workflowTabId?: string | null,
  options: { includeUnscopedFallback?: boolean } = {},
) {
  if (!workflowTabId) return outputs;
  const scoped = outputs.filter((output) => output.workflowTabId === workflowTabId);
  if (scoped.length > 0 || options.includeUnscopedFallback === false) return scoped;
  return outputs.filter((output) => !output.workflowTabId);
}

export function scopedOutputsForWorkflow(outputs: StudioOutput[], workflowTabId?: string | null) {
  return outputsForWorkflow(outputs, workflowTabId, { includeUnscopedFallback: false });
}

export function latestOutputForWorkflow(
  outputs: StudioOutput[],
  workflowTabId?: string | null,
  options: { includeUnscopedFallback?: boolean } = {},
) {
  const workflowOutputs = outputsForWorkflow(outputs, workflowTabId, options);
  if (workflowOutputs[0]) return workflowOutputs[0];
  return options.includeUnscopedFallback === false ? null : (outputs[0] ?? null);
}

function withReferenceImage(form: StudioFormState, image: string) {
  const trimmed = image.trim();
  if (!trimmed) return form;
  return {
    ...form,
    referenceImages: [trimmed, ...form.referenceImages.filter((item) => item !== trimmed)],
  };
}

function applyImportedImageToForm(form: StudioFormState, image: string): StudioFormState {
  const trimmed = image.trim();
  if (!trimmed) return form;

  if (form.mode === 'control_image') {
    return form.controlImage.trim() ? withReferenceImage(form, trimmed) : { ...form, controlImage: trimmed };
  }

  if (form.mode === 'inpaint' || form.mode === 'outpaint') {
    if (!form.referenceImages[0]?.trim()) return withReferenceImage(form, trimmed);
    if (!form.maskImage.trim()) return { ...form, maskImage: trimmed };
    return withReferenceImage(form, trimmed);
  }

  return withReferenceImage(form, trimmed);
}

function importedVideoMode(currentMode: StudioMode): StudioMode {
  if (
    currentMode === 'video_to_video' ||
    currentMode === 'video_inpaint' ||
    currentMode === 'video_outpaint' ||
    currentMode === 'control_to_video' ||
    currentMode === 'video_color_edit'
  ) {
    return currentMode;
  }
  return 'video_to_video';
}

function applyImportedVideoToForm(form: StudioFormState, video: string): StudioFormState {
  if (form.mode === 'control_to_video') {
    return form.controlVideo.trim() ? { ...form, sourceVideo: video } : { ...form, controlVideo: video };
  }

  if (form.mode === 'video_inpaint' || form.mode === 'video_outpaint') {
    if (!form.sourceVideo.trim()) return { ...form, sourceVideo: video };
    if (!form.maskVideo.trim()) return { ...form, maskVideo: video };
    return { ...form, sourceVideo: video };
  }

  return { ...form, sourceVideo: video };
}

function importedAudioMode(currentMode: StudioMode): StudioMode {
  if (currentMode === 'audio_variation' || currentMode === 'audio_continuation' || currentMode === 'audio_repaint') {
    return currentMode;
  }
  return 'audio_variation';
}

function applyImportedAudioToForm(form: StudioFormState, audio: string): StudioFormState {
  if (!form.sourceAudio.trim()) return { ...form, sourceAudio: audio };
  if (!form.referenceAudio.trim()) return { ...form, referenceAudio: audio };
  return { ...form, sourceAudio: audio };
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read output image.'));
    reader.readAsDataURL(blob);
  });
}

async function imageDataForOutput(output: StudioOutput) {
  if (output.backendImagePath || !output.url) return undefined;

  try {
    const imageUrl = new URL(output.url, window.location.origin).toString();
    const blob = await requestBlob(imageUrl);
    if (blob.size === 0 || !blob.type.startsWith('image/')) return undefined;
    return blobToDataUrl(blob);
  } catch {
    return undefined;
  }
}

type MediaCandidate = {
  value: string;
  label?: string;
  role?: string;
};

const MEDIA_VALUE_KEYS = ['url', 'path', 'file', 'image', 'output', 'preview', 'value'];

type RecordedMediaKind = 'image' | 'video' | 'audio';

function collectMediaCandidates(value: unknown, kind: RecordedMediaKind): MediaCandidate[] {
  const seen = new Set<string>();
  const matchesMedia =
    kind === 'video' ? isLikelyVideoValue : kind === 'audio' ? isLikelyAudioValue : isLikelyImageValue;

  const visit = (entry: unknown, fallbackLabel?: string, fallbackRole?: string): MediaCandidate[] => {
    if (typeof entry === 'string') {
      if (!matchesMedia(entry) || seen.has(entry)) return [];
      seen.add(entry);
      return [{ value: entry, label: fallbackLabel, role: fallbackRole }];
    }

    if (Array.isArray(entry)) {
      return entry.flatMap((item, index) => visit(item, fallbackLabel ?? `Item ${index + 1}`, fallbackRole));
    }

    if (!isRecord(entry)) return [];

    const label =
      typeof entry.label === 'string' ? entry.label : typeof entry.name === 'string' ? entry.name : fallbackLabel;
    const role =
      typeof entry.role === 'string' ? entry.role : typeof entry.type === 'string' ? entry.type : fallbackRole;

    for (const key of MEDIA_VALUE_KEYS) {
      const directValue = entry[key];
      if (typeof directValue === 'string' && matchesMedia(directValue)) {
        if (seen.has(directValue)) return [];
        seen.add(directValue);
        return [{ value: directValue, label, role }];
      }
    }

    return Object.entries(entry).flatMap(([key, item]) => visit(item, label ?? key, role));
  };

  return visit(value);
}

function mediaArtifactAt(artifacts: unknown, index: number): MediaArtifact {
  if (!Array.isArray(artifacts)) return {};
  const artifact = artifacts[index];
  return isRecord(artifact) ? (artifact as MediaArtifact) : {};
}

function mediaItemsForOutput(
  value: unknown,
  kind: RecordedMediaKind,
  nodeId: string,
  fieldKey: string,
  form: StudioFormState,
  artifacts?: unknown,
): StudioOutputMediaItem[] | undefined {
  const candidates = collectMediaCandidates(value, kind);
  if (candidates.length === 0) return undefined;
  const layered = form.mode === 'layer_decomposition';
  return candidates.map((candidate, index) => {
    const artifact = mediaArtifactAt(artifacts, index);
    const artifactUrl = typeof artifact.url === 'string' ? artifact.url : null;
    return {
      index,
      role: layered ? 'layer' : candidate.role,
      label: layered ? (candidate.label ?? `Layer ${index + 1}`) : candidate.label,
      value: candidate.value,
      url: artifactUrl
        ? kind === 'video'
          ? resolveStudioVideoUrl(artifactUrl, nodeId, fieldKey)
          : kind === 'audio'
            ? resolveStudioAudioUrl(artifactUrl, nodeId, fieldKey)
            : resolveStudioImageUrl(artifactUrl, nodeId, fieldKey)
        : kind === 'video'
          ? resolveStudioVideoUrl(candidate.value, nodeId, fieldKey)
          : kind === 'audio'
            ? resolveStudioAudioUrl(candidate.value, nodeId, fieldKey)
            : resolveStudioImageUrl(candidate.value, nodeId, fieldKey),
      displayType: artifact.displayType ?? kind,
      backendPath: artifact.filename ?? artifact.url,
      contentType: artifact.mimeType,
      width: artifact.width,
      height: artifact.height,
      durationSeconds: artifact.durationSeconds,
      clientRunId: artifact.clientRunId,
      runInputHash: artifact.runInputHash,
      attemptIndex: artifact.attemptIndex,
      taskId: artifact.taskId,
    };
  });
}

function dataTypeIncludes(dataType: string | string[] | undefined, expected: string) {
  const values = Array.isArray(dataType) ? dataType : [dataType];
  return values.some((item) => String(item ?? '').toLowerCase() === expected);
}

const GENERATED_PREVIEW_DISPLAYS = new Set(['ui_image', 'ui_video', 'ui_audio', 'ui_text']);

function isGeneratedPreviewParam(display: unknown) {
  return typeof display === 'string' && GENERATED_PREVIEW_DISPLAYS.has(display);
}

function outputSlotKey(nodeId: string, fieldKey: string, workflowTabId?: string | null) {
  return `${workflowTabId ?? 'legacy'}:${nodeId}:${fieldKey}`;
}

function getRunInputHash(form: StudioFormState, apiGraph: unknown) {
  return `run_${hashString(stableStringify({ form, apiGraph }))}`;
}

function isNonEmptyPreviewValue(value: unknown) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.some(isNonEmptyPreviewValue);
  return true;
}

const STUDIO_STORAGE_KEY = 'modiff.studio';
migrateLocalStorageKey('studio', STUDIO_STORAGE_KEY);

export const useStudioStore = create<StudioState & StudioVolatileState & StudioActions>()(
  persist(
    (set, get) => ({
      ...defaultState,
      ...defaultVolatileState,

      selectMode: (mode) => {
        const current = get().form;
        const nextForm = resolveStudioResourceForm(getFormDefaultsForMode(mode, current.modelType));
        set({
          selectedMode: mode,
          activeTemplateId: null,
          form: resolveStudioResourceForm({
            ...nextForm,
            prompt: current.prompt,
            negativePrompt: current.negativePrompt,
            referenceImages: current.referenceImages,
            maskImage: current.maskImage,
            controlImage: current.controlImage,
            sourceVideo: current.sourceVideo,
            maskVideo: current.maskVideo,
            controlVideo: current.controlVideo,
          }),
        });
      },

      updateForm: (values) => {
        set((state) => {
          let form = {
            ...state.form,
            ...values,
          };
          let selectedMode = values.mode ?? state.selectedMode;
          let lastError = state.lastError;

          if (
            values.modelType &&
            STUDIO_MODEL_PROFILES[values.modelType].family !== 'Qwen Image' &&
            values.quantizationMode === undefined
          ) {
            form = { ...form, quantizationMode: 'none', offloadMode: values.offloadMode ?? 'model_cpu' };
          }

          if (values.modelType && !isModelCompatibleWithMode(values.modelType, form.mode)) {
            const fallbackMode = getDefaultModeForModel(values.modelType);
            const defaults = getFormDefaultsForMode(fallbackMode, values.modelType);
            form = {
              ...state.form,
              ...defaults,
              modelType: values.modelType,
              mode: fallbackMode,
              prompt: state.form.prompt,
              negativePrompt: state.form.negativePrompt,
              referenceImages: state.form.referenceImages,
              maskImage: state.form.maskImage,
              controlImage: state.form.controlImage,
              sourceVideo: state.form.sourceVideo,
              maskVideo: state.form.maskVideo,
              controlVideo: state.form.controlVideo,
            };
            selectedMode = fallbackMode;
            lastError = `${STUDIO_MODEL_PROFILES[values.modelType].label} does not support ${values.mode ?? state.form.mode}; switched to ${fallbackMode.replace(/_/g, ' ')}.`;
          }

          form = resolveStudioResourceForm(form);

          return {
            form,
            selectedMode,
            activeTemplateId: values.modelType || values.mode ? null : state.activeTemplateId,
            lastError,
            autoResourcePlan: null,
          };
        });
      },

      applyPreset: (preset) => {
        get().updateForm(preset.values);
      },

      applyTemplate: (template) => {
        const defaults = getFormDefaultsForMode(template.mode, template.modelType);
        const presetValues = getPreset(template.presetId)?.values || {};
        const lockedValues = getTemplateLockedSettings(template);
        set((state) => ({
          selectedMode: template.mode,
          activeTemplateId: template.id,
          sourceOutputId: null,
          autoResourcePlan: null,
          form: resolveStudioResourceForm({
            ...state.form,
            ...defaults,
            ...presetValues,
            ...lockedValues,
            mode: template.mode,
            modelType: template.modelType,
            prompt: template.prompt,
            negativePrompt: template.negativePrompt ?? lockedValues.negativePrompt,
          }),
        }));
      },

      setGraphBinding: (binding) => set({ graphBinding: binding }),
      setGraphFinalization: (finalization) => set({ graphFinalization: finalization }),
      setAutoResourcePlan: (plan) => set({ autoResourcePlan: plan }),
      setAutoResourcePlans: (plans) =>
        set((state) => ({ autoResourcePlans: { ...state.autoResourcePlans, ...plans } })),
      setAutoResourceCheck: (check) =>
        set((state) => ({
          autoResourceCheck: {
            ...state.autoResourceCheck,
            ...check,
          },
        })),
      clearGraphBinding: () => set({ graphBinding: null, graphFinalization: null }),
      setCanvasTransition: (transition) => set({ canvasTransition: transition }),
      setLauncherDismissed: (dismissed) => set({ launcherDismissed: dismissed }),
      resetWorkflowSession: () =>
        set({
          graphBinding: null,
          graphFinalization: null,
          autoResourcePlan: null,
          autoResourcePlans: {},
          autoResourceCheck: defaultVolatileState.autoResourceCheck,
          canvasTransition: null,
          launcherDismissed: false,
          currentRunContext: null,
          runContextsByClientRunId: {},
          runContextsByTaskId: {},
          lastError: null,
        }),

      addPromptHistory: (prompt) => {
        const trimmed = prompt.trim();
        if (!trimmed) return;
        set((state) => ({
          promptHistory: [trimmed, ...state.promptHistory.filter((item) => item !== trimmed)].slice(0, 30),
        }));
      },

      saveCurrentPromptAsSnippet: () => {
        const prompt = get().form.prompt.trim();
        if (!prompt) return;
        set((state) => ({
          savedSnippets: [prompt, ...state.savedSnippets.filter((item) => item !== prompt)].slice(0, 30),
        }));
      },

      removeSnippet: (snippet) => {
        set((state) => ({
          savedSnippets: state.savedSnippets.filter((item) => item !== snippet),
        }));
      },

      applySnippet: (snippet) => {
        get().updateForm({ prompt: snippet });
      },

      applyNegativePreset: (preset) => {
        get().updateForm({ negativePrompt: preset });
      },

      setReferenceImages: (images) => {
        get().updateForm({ referenceImages: images.filter(Boolean) });
      },

      addReferenceImage: (image) => {
        const trimmed = image.trim();
        if (!trimmed) return;
        const images = get().form.referenceImages;
        get().setReferenceImages([...images, trimmed]);
      },

      replaceReferenceImage: (index, image) => {
        const images = [...get().form.referenceImages];
        images[index] = image;
        get().setReferenceImages(images);
      },

      removeReferenceImage: (index) => {
        get().setReferenceImages(get().form.referenceImages.filter((_, itemIndex) => itemIndex !== index));
      },

      moveReferenceImage: (index, direction) => {
        const images = [...get().form.referenceImages];
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= images.length) return;
        const current = images[index];
        const next = images[nextIndex];
        if (current === undefined || next === undefined) return;
        images[index] = next;
        images[nextIndex] = current;
        get().setReferenceImages(images);
      },

      useOutputAsReference: (output) => {
        const isVideoOutput = output.displayType === 'video';
        const isAudioOutput = output.displayType === 'audio';
        const mode: StudioMode = isVideoOutput
          ? 'video_to_video'
          : isAudioOutput
            ? 'audio_variation'
            : get().form.mode === 'text_to_image'
              ? 'edit_image'
              : get().form.mode;
        const current = get().form;
        const defaults = getFormDefaultsForMode(
          mode,
          isVideoOutput ? 'WanVACEPipeline' : isAudioOutput ? 'AceStepAudioPipeline' : current.modelType,
        );
        set({
          selectedMode: mode,
          sourceOutputId: output.id,
          activeTemplateId: null,
          form: {
            ...current,
            ...defaults,
            mode,
            modelType: defaults.modelType,
            prompt: current.prompt,
            negativePrompt: current.negativePrompt,
            referenceImages:
              isVideoOutput || isAudioOutput
                ? current.referenceImages
                : [output.url, ...current.referenceImages.filter((image) => image !== output.url)],
            sourceVideo: isVideoOutput ? output.url : current.sourceVideo,
            sourceAudio: isAudioOutput ? output.url : current.sourceAudio,
            maskImage: current.maskImage,
            controlImage: current.controlImage,
            maskVideo: current.maskVideo,
            controlVideo: current.controlVideo,
          },
        });
      },

      addImportedAssets: (assets) => {
        if (assets.length === 0) return;
        set((state) => ({
          importedAssets: [
            ...assets,
            ...state.importedAssets.filter((asset) => !assets.some((next) => next.id === asset.id)),
          ].slice(0, 24),
        }));
      },

      deleteImportedAsset: (id) => {
        set((state) => ({
          importedAssets: state.importedAssets.filter((asset) => asset.id !== id),
        }));
      },

      useImportedAssetAsReference: (asset) => {
        const current = get().form;
        const assetInput = asset.backendPath || asset.url;
        if (asset.displayType === 'video') {
          const mode = importedVideoMode(current.mode);
          const defaults = mode === current.mode ? null : getFormDefaultsForMode(mode, 'WanVACEPipeline');
          const baseForm = defaults
            ? {
                ...current,
                ...defaults,
                mode,
                modelType: defaults.modelType,
                prompt: current.prompt,
                negativePrompt: current.negativePrompt,
              }
            : current;
          set({
            selectedMode: mode,
            sourceOutputId: null,
            activeTemplateId: null,
            form: applyImportedVideoToForm(baseForm, assetInput),
          });
          return;
        }
        if (asset.displayType === 'audio') {
          const mode = importedAudioMode(current.mode);
          const defaults = mode === current.mode ? null : getFormDefaultsForMode(mode, 'AceStepAudioPipeline');
          const baseForm = defaults
            ? {
                ...current,
                ...defaults,
                mode,
                modelType: defaults.modelType,
                prompt: current.prompt,
                negativePrompt: current.negativePrompt,
              }
            : current;
          set({
            selectedMode: mode,
            sourceOutputId: null,
            activeTemplateId: null,
            form: applyImportedAudioToForm(baseForm, assetInput),
          });
          return;
        }
        if (asset.displayType === 'image') {
          const mode = current.mode === 'text_to_image' ? 'edit_image' : current.mode;
          const defaults = mode === current.mode ? null : getFormDefaultsForMode(mode, current.modelType);
          const baseForm = defaults
            ? {
                ...current,
                ...defaults,
                mode,
                modelType: defaults.modelType,
                prompt: current.prompt,
                negativePrompt: current.negativePrompt,
              }
            : current;
          set({
            selectedMode: mode,
            sourceOutputId: null,
            activeTemplateId: null,
            form: applyImportedImageToForm(baseForm, assetInput),
          });
        }
      },

      captureRunContext: (apiGraph, variation, identity) => {
        const state = get();
        const clientRunId = identity?.clientRunId ?? nanoid();
        const runInputHash = identity?.runInputHash ?? getRunInputHash(state.form, apiGraph ?? currentGraphSnapshot());
        const context: StudioRunContext = {
          id: clientRunId,
          startedAt: Date.now(),
          status: 'submitted',
          clientRunId,
          runInputHash,
          workflowTabId: state.activeWorkflowTabId,
          form: cloneJson(state.form),
          graph: currentGraphSnapshot(),
          binding: state.graphBinding ? cloneJson(state.graphBinding) : null,
          apiGraph,
          templateId: state.activeTemplateId ?? undefined,
          sourceOutputId: state.sourceOutputId ?? undefined,
          variationGroupId: variation?.variationGroupId,
          variationLabel: variation?.variationLabel,
        };
        set((current) => ({
          currentRunContext: context,
          runContextsByClientRunId: withBoundedRunContext(
            current.runContextsByClientRunId,
            context.clientRunId,
            context,
          ),
        }));
        return context;
      },

      clearRunContext: () => set({ currentRunContext: null, runContextsByClientRunId: {}, runContextsByTaskId: {} }),

      shouldAcceptRunOutputUpdate: (taskId, clientRunId) => {
        const state = get();
        const normalizedTaskId = typeof taskId === 'string' && taskId.trim() ? taskId : null;
        const normalizedClientRunId = typeof clientRunId === 'string' && clientRunId.trim() ? clientRunId : null;
        if (matchingRunContext(state, normalizedTaskId, normalizedClientRunId)) return true;
        const hasCapturedRuns =
          Boolean(state.currentRunContext) ||
          Object.keys(state.runContextsByClientRunId).length > 0 ||
          Object.keys(state.runContextsByTaskId).length > 0;
        return Boolean(normalizedTaskId && !hasCapturedRuns);
      },

      shouldApplyRunUpdateToActiveWorkflow: (taskId, clientRunId) => {
        const state = get();
        const context = matchingRunContext(state, taskId, clientRunId);
        if (!context) return true;
        return (
          state.currentRunContext?.clientRunId === context.clientRunId &&
          state.activeWorkflowTabId === context.workflowTabId
        );
      },

      markRunContextStatus: (taskId, clientRunId, status) => {
        set((state) => {
          const context = matchingRunContext(state, taskId, clientRunId);
          if (!context) return {};
          const terminal = TERMINAL_RUN_STATUSES.has(status);
          const nextContext: StudioRunContext = {
            ...context,
            status,
            completedAt: terminal ? Date.now() : context.completedAt,
          };
          let runContextsByClientRunId = withBoundedRunContext(
            state.runContextsByClientRunId,
            nextContext.clientRunId,
            nextContext,
          );
          let runContextsByTaskId = context.run?.taskId
            ? withBoundedRunContext(state.runContextsByTaskId, context.run.taskId, nextContext)
            : state.runContextsByTaskId;
          if (terminal) {
            const pruned = pruneTerminalRunContexts(
              runContextsByClientRunId,
              runContextsByTaskId,
              state.currentRunContext?.clientRunId,
            );
            runContextsByClientRunId = pruned.nextByClientRunId;
            runContextsByTaskId = pruned.nextByTaskId;
          }
          return {
            currentRunContext:
              state.currentRunContext?.clientRunId === nextContext.clientRunId ? nextContext : state.currentRunContext,
            runContextsByClientRunId,
            runContextsByTaskId,
          };
        });
      },

      clearChangedPreviewFieldsForRun: (runInputHash) => {
        const workflowTabId = get().activeWorkflowTabId;
        const outputsBySlot = new Map<string, StudioOutput>();
        get().outputs.forEach((output) => {
          if (output.workflowTabId && workflowTabId && output.workflowTabId !== workflowTabId) return;
          const key = outputSlotKey(output.nodeId, output.fieldKey, output.workflowTabId ?? workflowTabId);
          if (!outputsBySlot.has(key)) outputsBySlot.set(key, output);
        });

        const flow = useFlowStore.getState();
        flow.nodes.forEach((node) => {
          let cleared = false;
          let waitingForCurrentRun = false;
          Object.entries(node.data.params).forEach(([fieldKey, param]) => {
            if (!isGeneratedPreviewParam(param.display)) return;
            const latest = outputsBySlot.get(outputSlotKey(node.id, fieldKey, workflowTabId));
            if (latest?.runInputHash === runInputHash) return;
            if (latest) waitingForCurrentRun = true;
            if (!isNonEmptyPreviewValue(param.value)) return;
            flow.setParam(node.id, fieldKey, null);
            flow.setParam(node.id, fieldKey, undefined, 'artifacts');
            cleared = true;
          });
          if (cleared || waitingForCurrentRun) {
            flow.setNodeUiState(node.id, {
              validationSeverity: 'info',
              validationMessage: 'Waiting for this run',
            });
          }
        });
      },

      clearPreviewFieldsForFailedRun: (taskId, clientRunId) => {
        if (!get().shouldAcceptRunOutputUpdate(taskId, clientRunId)) return;
        const workflowTabId = get().activeWorkflowTabId;
        const context = matchingRunContext(get(), taskId, clientRunId) ?? get().currentRunContext;
        if (
          !context ||
          context.workflowTabId !== workflowTabId ||
          context.clientRunId !== get().currentRunContext?.clientRunId
        )
          return;
        const outputsBySlot = new Map<string, StudioOutput>();
        get().outputs.forEach((output) => {
          if (output.workflowTabId && workflowTabId && output.workflowTabId !== workflowTabId) return;
          const key = outputSlotKey(output.nodeId, output.fieldKey, output.workflowTabId ?? workflowTabId);
          if (!outputsBySlot.has(key)) outputsBySlot.set(key, output);
        });
        const flow = useFlowStore.getState();
        flow.nodes.forEach((node) => {
          let cleared = false;
          Object.entries(node.data.params).forEach(([fieldKey, param]) => {
            if (!isGeneratedPreviewParam(param.display)) return;
            const latest = outputsBySlot.get(outputSlotKey(node.id, fieldKey, workflowTabId));
            if (latest?.runInputHash && latest.runInputHash === context?.runInputHash) return;
            flow.setParam(node.id, fieldKey, null);
            flow.setParam(node.id, fieldKey, undefined, 'artifacts');
            cleared = true;
          });
          if (cleared) {
            flow.setNodeUiState(node.id, {
              validationSeverity: 'error',
              validationMessage: 'Run failed before producing a new output.',
            });
          }
        });
      },

      attachRunResponse: (response, clientRunId) => {
        set((state) => {
          const capturedContext = clientRunId ? state.runContextsByClientRunId[clientRunId] : state.currentRunContext;
          if (!capturedContext) return {};
          const runResponse = isRecord(response) ? response : {};
          const taskId = optionalNullableString(runResponse.task_id);
          const nextContext: StudioRunContext = {
            ...capturedContext,
            run: {
              runId: capturedContext.id,
              sid: optionalNullableString(runResponse.sid),
              taskId,
              response: response === undefined ? null : safeCloneJson(response),
            },
          };
          const runContextsByTaskId = taskId
            ? withBoundedRunContext(state.runContextsByTaskId, taskId, nextContext)
            : state.runContextsByTaskId;
          return {
            currentRunContext:
              state.currentRunContext?.clientRunId === capturedContext.clientRunId
                ? nextContext
                : state.currentRunContext,
            runContextsByClientRunId: withBoundedRunContext(
              state.runContextsByClientRunId,
              nextContext.clientRunId,
              nextContext,
            ),
            runContextsByTaskId,
          };
        });
      },

      fetchBackendOutputs: async () => {
        const ticket = outputHistoryRequestGate.begin('outputs');
        const outputRevision = get().outputRevision;
        set((state) => galleryRequestPatch(state, 'history', 1, null));
        try {
          const backendOutputs = await fetchStudioOutputs(ticket.signal);
          if (!ticket.isLatest()) return;
          set((state) => ({
            ...(state.outputRevision === outputRevision
              ? {
                  outputs: mergeOutputs(backendOutputs, state.outputs),
                  outputRevision: state.outputRevision + 1,
                }
              : {}),
            ...galleryRequestPatch(state, 'history', -1, null),
          }));
        } catch (error) {
          if (!ticket.isLatest()) return;
          set((state) =>
            galleryRequestPatch(
              state,
              'history',
              -1,
              formatRequestError(error, 'Could not load Studio output history.'),
            ),
          );
        } finally {
          if (!ticket.isLatest()) set((state) => galleryRequestPatch(state, 'history', -1));
          ticket.finish();
        }
      },

      syncOutputToBackend: async (output) => {
        const mutation = beginOutputMutation(output.id);
        set((state) => galleryRequestPatch(state, 'sync', 1, null));
        try {
          const imageData = await imageDataForOutput(output);
          const payload = {
            ...output,
            ...(imageData ? { image_data: imageData } : {}),
          };
          const backendOutputs = await syncStudioOutput(payload);
          set((state) => ({
            ...(mutation.isLatest()
              ? {
                  outputs: mergeOutputs(backendOutputs, state.outputs),
                  outputRevision: state.outputRevision + 1,
                }
              : {}),
            ...galleryRequestPatch(state, 'sync', -1, null),
          }));
        } catch (error) {
          set((state) =>
            galleryRequestPatch(
              state,
              'sync',
              -1,
              mutation.isLatest() ? formatRequestError(error, 'Could not sync Studio output history.') : undefined,
            ),
          );
        } finally {
          mutation.finish();
        }
      },

      restoreWorkflowFromOutput: (output) => {
        const restoredForm = coerceStudioFormState(output.formSnapshot);
        const snapshot: WorkflowTabSnapshot = {
          nodes: output.graphSnapshot?.nodes ?? [],
          edges: output.graphSnapshot?.edges ?? [],
          viewport: output.graphSnapshot?.viewport ?? { x: 0, y: 0, zoom: 1 },
          studioForm: cloneJson(restoredForm),
          studioGraphBinding: output.graphBindingSnapshot ? cloneJson(output.graphBindingSnapshot) : null,
          selectedMode: restoredForm.mode,
          activeTemplateId: output.templateId ?? null,
          sourceOutputId: output.sourceOutputId ?? output.parentId ?? null,
        };

        get().createWorkflowTab(
          output.templateLabel || output.prompt.slice(0, 28) || 'Gallery workflow',
          snapshot,
          'gallery',
          output.id,
        );
      },

      recordOutputFromUpdate: (nodeId, fieldKey, value, metadata = {}) => {
        const { taskId, clientRunId, runInputHash, attemptIndex, runtimeFingerprint, dataType } = metadata;
        if (!get().shouldAcceptRunOutputUpdate(taskId, clientRunId)) return;
        const hasExplicitDataType = dataType !== undefined;
        const isVideoOutput =
          dataTypeIncludes(dataType, 'video') ||
          (!hasExplicitDataType && !isLikelyImageValue(value) && isLikelyVideoValue(value));
        const isAudioOutput =
          !isVideoOutput &&
          (dataTypeIncludes(dataType, 'audio') ||
            (!hasExplicitDataType &&
              !isLikelyImageValue(value) &&
              !isLikelyVideoValue(value) &&
              isLikelyAudioValue(value)));
        const isTextOutput =
          !isVideoOutput &&
          !isAudioOutput &&
          !isLikelyImageValue(value) &&
          (dataTypeIncludes(dataType, 'text') || dataTypeIncludes(dataType, 'string'));
        const mediaKind: RecordedMediaKind = isVideoOutput ? 'video' : isAudioOutput ? 'audio' : 'image';
        const mediaValue = isVideoOutput
          ? firstVideoValue(value)
          : isAudioOutput
            ? firstAudioValue(value)
            : firstImageValue(value);
        if (!mediaValue && !isTextOutput) return;
        if (!isVideoOutput && !isAudioOutput && !isTextOutput && !isLikelyImageValue(value)) return;

        const url = isTextOutput
          ? `data:text/plain;charset=utf-8,${encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}`
          : isVideoOutput
            ? resolveStudioVideoUrl(mediaValue ?? '', nodeId, fieldKey)
            : isAudioOutput
              ? resolveStudioAudioUrl(mediaValue ?? '', nodeId, fieldKey)
              : resolveStudioImageUrl(mediaValue ?? '', nodeId, fieldKey);
        const context = matchingRunContext(get(), taskId, clientRunId) ?? get().currentRunContext;
        if (!context) return;
        const form = context?.form ?? get().form;
        const profile = getProfileForForm(form);
        const template = STUDIO_TEMPLATES.find((item) => item.id === context?.templateId);
        const templateLockHash = template ? getTemplateLockHash(template) : undefined;
        const promptSettingsHash = getPromptSettingsHash(form);
        const exactTemplateCompatible = template ? isTemplateExactEligible(template, form) : undefined;
        const runtimeHints =
          isRecord(context?.apiGraph) && isRecord(context.apiGraph.runtimeHints) ? context.apiGraph.runtimeHints : null;
        const mediaItems = isTextOutput
          ? [
              {
                index: 0,
                value,
                url,
                displayType: 'text' as const,
                clientRunId: clientRunId ?? context.clientRunId,
                runInputHash: runInputHash ?? context.runInputHash,
                attemptIndex,
                taskId: taskId ?? context.run?.taskId ?? null,
              },
            ]
          : mediaItemsForOutput(value, mediaKind, nodeId, fieldKey, form, metadata.artifacts)?.map((item) => ({
              ...item,
              clientRunId: clientRunId ?? context.clientRunId,
              runInputHash: runInputHash ?? context.runInputHash,
              attemptIndex,
              taskId: taskId ?? context.run?.taskId ?? null,
            }));
        const displayType = isTextOutput
          ? 'text'
          : isVideoOutput
            ? 'video'
            : isAudioOutput
              ? 'audio'
              : mediaItems && mediaItems.length > 1
                ? 'image_collection'
                : 'image';
        const output: StudioOutput = {
          id: nanoid(),
          clientRunId: clientRunId ?? context.clientRunId,
          runInputHash: runInputHash ?? context.runInputHash,
          workflowTabId: context.workflowTabId,
          attemptIndex,
          nodeId,
          fieldKey,
          value,
          url,
          mode: form.mode,
          modelType: form.modelType,
          modelLabel: profile.label,
          repo: profile.defaultRepo,
          templateId: context?.templateId,
          templateLabel: template?.label,
          runId: context?.run?.runId ?? context?.id,
          taskId: context?.run?.taskId ?? null,
          sid: context?.run?.sid ?? null,
          prompt: form.prompt,
          negativePrompt: form.negativePrompt,
          seed: form.seed,
          width: form.width,
          height: form.height,
          steps: form.steps,
          guidanceScale: form.guidanceScale,
          referenceImages: [...form.referenceImages],
          sourceOutputId: context?.sourceOutputId,
          formSnapshot: cloneJson(form),
          graphSnapshot: context?.graph,
          graphBindingSnapshot: context?.binding,
          apiGraphSnapshot: context?.apiGraph,
          createdAt: Date.now(),
          favorite: false,
          parentId: context?.sourceOutputId ?? context?.variationGroupId,
          displayType,
          mediaItems,
          templateLockHash,
          promptSettingsHash,
          exactTemplateCompatible,
          variationGroupId: context?.variationGroupId,
          variationLabel: context?.variationLabel,
          provenance: {
            schemaVersion: 1,
            source: 'frontend-record',
            capturedAt: new Date().toISOString(),
            templateId: context?.templateId,
            templateLockHash,
            promptSettingsHash,
            exactTemplateCompatible,
            backendExecutionId: context?.run?.taskId ?? null,
            clientRunId: clientRunId ?? context.clientRunId,
            runInputHash: runInputHash ?? context.runInputHash,
            workflowTabId: context.workflowTabId,
            attemptIndex,
            nodeId,
            graphBindingFingerprint: context?.binding?.fingerprint,
            modelRevision: template?.example?.modelRevision,
            runtimeFingerprint:
              typeof runtimeFingerprint === 'string' ? runtimeFingerprint : template?.example?.runtimeFingerprint,
            resourcePlan: runtimeHints
              ? {
                  resourceMode: runtimeHints.resourceMode,
                  resolvedResourceMode: runtimeHints.resolvedResourceMode,
                  executionPath: runtimeHints.executionPath,
                  resolvedArtifact: runtimeHints.resolvedArtifact,
                  quantizationMode: runtimeHints.quantizationMode,
                  quantizedComponents: runtimeHints.quantizedComponents,
                  offloadMode: runtimeHints.offloadMode,
                  autoResourceCandidateId: runtimeHints.autoResourceCandidateId,
                  autoResourceProofStatus: runtimeHints.autoResourceProofStatus,
                  autoResourcePlan: safeCloneJson(runtimeHints.autoResourcePlan),
                }
              : undefined,
            mediaItems,
            ...(isVideoOutput
              ? {
                  video: {
                    sourceVideo: form.sourceVideo,
                    maskVideo: form.maskVideo,
                    controlVideo: form.controlVideo,
                    numFrames: form.numFrames,
                    fps: form.fps,
                    conditioningScale: form.conditioningScale,
                    guidanceScale2: form.guidanceScale2,
                    outputType: form.outputType,
                  },
                }
              : {}),
            ...(isAudioOutput
              ? {
                  audio: {
                    sourceAudio: form.sourceAudio,
                    referenceAudio: form.referenceAudio,
                    durationSeconds: form.audioDuration,
                  },
                }
              : {}),
          },
        };

        set((state) => ({
          outputs: [
            output,
            ...state.outputs.filter(
              (item) => !(item.nodeId === nodeId && item.fieldKey === fieldKey && item.url === url),
            ),
          ].slice(0, 80),
          outputRevision: state.outputRevision + 1,
        }));
        void get().syncOutputToBackend(output);
      },

      toggleFavoriteOutput: (id) => {
        const output = get().outputs.find((item) => item.id === id);
        if (!output) return;
        const favorite = !(output?.favorite ?? false);
        const mutation = beginOutputMutation(id);
        set((state) => ({
          outputs: state.outputs.map((item) => (item.id === id ? { ...item, favorite } : item)),
          outputRevision: state.outputRevision + 1,
          ...galleryRequestPatch(state, 'mutation', 1, null),
        }));
        void setStudioOutputFavorite(id, favorite)
          .then(() => {
            set((state) => galleryRequestPatch(state, 'mutation', -1, null));
          })
          .catch((error) => {
            const message = formatRequestError(error, 'Could not update the Studio output.');
            set((state) => ({
              ...(mutation.isLatest() && state.outputs.some((item) => item.id === id && item.favorite === favorite)
                ? {
                    outputs: state.outputs.map((item) =>
                      item.id === id ? { ...item, favorite: output.favorite ?? false } : item,
                    ),
                    outputRevision: state.outputRevision + 1,
                  }
                : {}),
              ...galleryRequestPatch(state, 'mutation', -1, mutation.isLatest() ? message : undefined),
            }));
          })
          .finally(mutation.finish);
      },

      deleteOutput: (id) => {
        const output = get().outputs.find((item) => item.id === id);
        if (!output) return;
        const mutation = beginOutputMutation(id);
        set((state) => ({
          outputs: state.outputs.filter((output) => output.id !== id),
          outputRevision: state.outputRevision + 1,
          ...galleryRequestPatch(state, 'mutation', 1, null),
        }));
        void deleteStudioOutput(id)
          .then(() => {
            set((state) => galleryRequestPatch(state, 'mutation', -1, null));
          })
          .catch((error) => {
            const message = formatRequestError(error, 'Could not delete the Studio output.');
            set((state) => ({
              ...(mutation.isLatest() && !state.outputs.some((item) => item.id === id)
                ? {
                    outputs: mergeOutputs([output], state.outputs),
                    outputRevision: state.outputRevision + 1,
                  }
                : {}),
              ...galleryRequestPatch(state, 'mutation', -1, mutation.isLatest() ? message : undefined),
            }));
          })
          .finally(mutation.finish);
      },

      ensureWorkflowTabs: () => {
        const state = get();
        if (state.workflowTabs.length > 0 && state.activeWorkflowTabId) return;
        const snapshot = currentWorkflowSnapshot(state);
        const id = nanoid();
        set({
          workflowTabs: [
            {
              id,
              title: 'Workflow 1',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              dirty: false,
              source: 'manual',
              snapshot,
            },
          ],
          activeWorkflowTabId: id,
        });
      },

      saveActiveWorkflowTab: (dirty = true) => {
        set((state) => ({
          workflowTabs: savedTabsWithActiveSnapshot(state).map((tab) =>
            tab.id === state.activeWorkflowTabId ? { ...tab, dirty } : tab,
          ),
        }));
      },

      createWorkflowTab: (title, snapshot, source = 'new', sourceLabel) => {
        const id = nanoid();
        const state = get();
        const nextSnapshot = normalizeWorkflowSnapshot(snapshot ?? blankWorkflowSnapshot());
        const savedTabs = savedTabsWithActiveSnapshot(state);
        const tab: WorkflowTab = {
          id,
          title: title || `Workflow ${savedTabs.length + 1}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          dirty: false,
          source,
          sourceLabel,
          snapshot: cloneJson(nextSnapshot),
        };
        applyWorkflowSnapshot(nextSnapshot);
        set({
          workflowTabs: [...savedTabs, tab],
          activeWorkflowTabId: id,
          selectedMode: nextSnapshot.selectedMode,
          form: cloneJson(nextSnapshot.studioForm),
          graphBinding: nextSnapshot.studioGraphBinding ? cloneJson(nextSnapshot.studioGraphBinding) : null,
          graphFinalization: null,
          autoResourcePlan: null,
          canvasTransition: null,
          activeTemplateId: nextSnapshot.activeTemplateId,
          sourceOutputId: nextSnapshot.sourceOutputId,
          pinnedGraphInputIds: nextSnapshot.pinnedGraphInputIds ?? [],
          launcherDismissed: nextSnapshot.nodes.length > 0,
          lastError: null,
        });
        return id;
      },

      switchWorkflowTab: (id) => {
        const state = get();
        if (id === state.activeWorkflowTabId) return;
        const target = state.workflowTabs.find((tab) => tab.id === id);
        if (!target) return;
        const savedTabs = savedTabsWithActiveSnapshot(state);
        const targetSnapshot = normalizeWorkflowSnapshot(target.snapshot);
        applyWorkflowSnapshot(targetSnapshot);
        set({
          workflowTabs: savedTabs,
          activeWorkflowTabId: id,
          selectedMode: targetSnapshot.selectedMode,
          form: cloneJson(targetSnapshot.studioForm),
          graphBinding: targetSnapshot.studioGraphBinding ? cloneJson(targetSnapshot.studioGraphBinding) : null,
          graphFinalization: null,
          autoResourcePlan: null,
          canvasTransition: null,
          activeTemplateId: targetSnapshot.activeTemplateId,
          sourceOutputId: targetSnapshot.sourceOutputId,
          pinnedGraphInputIds: targetSnapshot.pinnedGraphInputIds ?? [],
          launcherDismissed: targetSnapshot.nodes.length > 0,
          lastError: null,
        });
      },

      closeWorkflowTab: (id) => {
        const state = get();
        const tabs = savedTabsWithActiveSnapshot(state).filter((tab) => tab.id !== id);
        if (tabs.length === 0) {
          const snapshot = normalizeWorkflowSnapshot(blankWorkflowSnapshot());
          const newId = nanoid();
          applyWorkflowSnapshot(snapshot);
          set({
            workflowTabs: [
              {
                id: newId,
                title: 'Workflow 1',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                dirty: false,
                source: 'new',
                snapshot,
              },
            ],
            activeWorkflowTabId: newId,
            selectedMode: snapshot.selectedMode,
            form: cloneJson(snapshot.studioForm),
            graphBinding: null,
            graphFinalization: null,
            autoResourcePlan: null,
            canvasTransition: null,
            activeTemplateId: null,
            sourceOutputId: null,
            pinnedGraphInputIds: [],
            launcherDismissed: false,
            lastError: null,
          });
          return;
        }

        const nextActive =
          id === state.activeWorkflowTabId
            ? tabs[Math.max(0, tabs.length - 1)]
            : (tabs.find((tab) => tab.id === state.activeWorkflowTabId) ?? tabs[0]);
        if (!nextActive) return;
        const nextSnapshot = normalizeWorkflowSnapshot(nextActive.snapshot);
        applyWorkflowSnapshot(nextSnapshot);
        set({
          workflowTabs: tabs,
          activeWorkflowTabId: nextActive.id,
          selectedMode: nextSnapshot.selectedMode,
          form: cloneJson(nextSnapshot.studioForm),
          graphBinding: nextSnapshot.studioGraphBinding ? cloneJson(nextSnapshot.studioGraphBinding) : null,
          graphFinalization: null,
          autoResourcePlan: null,
          canvasTransition: null,
          activeTemplateId: nextSnapshot.activeTemplateId,
          sourceOutputId: nextSnapshot.sourceOutputId,
          pinnedGraphInputIds: nextSnapshot.pinnedGraphInputIds ?? [],
          launcherDismissed: nextSnapshot.nodes.length > 0,
          lastError: null,
        });
      },

      renameWorkflowTab: (id, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set((state) => ({
          workflowTabs: state.workflowTabs.map((tab) =>
            tab.id === id ? { ...tab, title: trimmed, updatedAt: Date.now(), dirty: true } : tab,
          ),
        }));
      },

      createAppModeConfig: (workflowTabId) => {
        const state = get();
        const tabId = workflowTabId ?? state.activeWorkflowTabId;
        const tab = state.workflowTabs.find((item) => item.id === tabId);
        if (!tab) return null;
        const existing = state.appModeConfigs.find((item) => item.workflowTabId === tab.id);
        if (existing) {
          set({ activeAppModeConfigId: existing.id });
          return existing.id;
        }
        const config = defaultAppModeConfig(tab);
        set((current) => ({
          appModeConfigs: [config, ...current.appModeConfigs],
          activeAppModeConfigId: config.id,
        }));
        return config.id;
      },

      updateAppModeConfig: (id, values) => {
        set((state) => ({
          appModeConfigs: state.appModeConfigs.map((config) =>
            config.id === id ? { ...config, ...cloneJson(values), updatedAt: Date.now() } : config,
          ),
        }));
      },

      deleteAppModeConfig: (id) => {
        set((state) => {
          const configs = state.appModeConfigs.filter((config) => config.id !== id);
          return {
            appModeConfigs: configs,
            activeAppModeConfigId:
              state.activeAppModeConfigId === id ? (configs[0]?.id ?? null) : state.activeAppModeConfigId,
          };
        });
      },

      setActiveAppModeConfig: (id) => set({ activeAppModeConfigId: id }),

      setPinnedGraphInputIds: (ids) => {
        const next = Array.from(new Set(ids));
        set({ pinnedGraphInputIds: next });
        get().saveActiveWorkflowTab(true);
      },

      togglePinnedGraphInput: (id) => {
        set((state) => {
          const ids = state.pinnedGraphInputIds.includes(id)
            ? state.pinnedGraphInputIds.filter((item) => item !== id)
            : [...state.pinnedGraphInputIds, id];
          return { pinnedGraphInputIds: ids };
        });
        get().saveActiveWorkflowTab(true);
      },

      createBlueprintFromSelection: (name) => {
        const flow = useFlowStore.getState();
        const selectedNodes = flow.nodes.filter((node) => node.selected);
        if (selectedNodes.length === 0) return null;
        const nodeIds = new Set(selectedNodes.map((node) => node.id));
        const edges = flow.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
        const blueprint: WorkflowBlueprint = {
          id: nanoid(),
          name: name?.trim() || `Blueprint ${get().blueprints.length + 1}`,
          nodes: cloneJson(selectedNodes),
          edges: cloneJson(edges),
          exposedInputs: graphParamInputs(selectedNodes),
          exposedOutputs: graphOutputs(selectedNodes),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((state) => ({ blueprints: [blueprint, ...state.blueprints] }));
        return blueprint.id;
      },

      insertBlueprint: (id) => {
        const blueprint = get().blueprints.find((item) => item.id === id);
        if (!blueprint) return;
        const idMap = new Map<string, string>();
        const nodes = blueprint.nodes.filter(isFlowNode).map((node) => {
          const nextId = nanoid();
          idMap.set(node.id, nextId);
          return {
            ...cloneJson(node),
            id: nextId,
            selected: false,
            position: {
              x: (node.position?.x ?? 0) + 80,
              y: (node.position?.y ?? 0) + 80,
            },
          };
        });
        const edges = blueprint.edges
          .filter(isFlowEdge)
          .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
          .map((edge) => ({
            ...cloneJson(edge),
            id: nanoid(),
            source: idMap.get(edge.source) ?? edge.source,
            target: idMap.get(edge.target) ?? edge.target,
          }));
        const flow = useFlowStore.getState();
        flow.replaceGraph(
          {
            nodes: [...flow.nodes, ...nodes] as typeof flow.nodes,
            edges: [...flow.edges, ...edges] as typeof flow.edges,
          },
          { historyLabel: 'Insert blueprint' },
        );
        get().saveActiveWorkflowTab(true);
      },

      deleteBlueprint: (id) => {
        set((state) => ({ blueprints: state.blueprints.filter((item) => item.id !== id) }));
      },

      setLastError: (error) => set({ lastError: error }),
      setRecentChange: (change) => set({ recentChange: change }),
    }),
    {
      name: STUDIO_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedMode: state.selectedMode,
        form: state.form,
        promptHistory: state.promptHistory,
        savedSnippets: state.savedSnippets,
        negativePromptPresets: state.negativePromptPresets,
        activeTemplateId: state.activeTemplateId,
        sourceOutputId: state.sourceOutputId,
        outputs: state.outputs,
        importedAssets: state.importedAssets,
        workflowTabs: state.workflowTabs,
        activeWorkflowTabId: state.activeWorkflowTabId,
        appModeConfigs: state.appModeConfigs,
        activeAppModeConfigId: state.activeAppModeConfigId,
        blueprints: state.blueprints,
        pinnedGraphInputIds: state.pinnedGraphInputIds,
      }),
      merge: normalizePersistedStudioState,
    },
  ),
);
