import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { enqueueSnackbar } from '../ui/snackbar';
import { useShallow } from 'zustand/react/shallow';
import {
  AlertTriangle,
  ClipboardCopy,
  GalleryVerticalEnd,
  Info,
  Pin,
  PinOff,
  Save,
  Trash2,
  WandSparkles,
} from 'lucide-react';

import {
  advanceWorkflowOperationContext,
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  isWorkflowOperationCancelled,
  latestOutputForWorkflow,
  scopedOutputsForWorkflow,
  useStudioStore,
  workflowOperationContextIsCurrent,
} from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { useNodesStore, type NodeParams } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import {
  createOrUpdateStudioGraph,
  ensureStudioGraphReadyForRun,
  getStudioGraphRunBlockingMessage,
  getStudioGraphShapeKey,
  inspectStudioGraphBindingDivergence,
  syncStudioGraphValues,
} from '../studio/graphBridge';
import { StudioImageReferenceTray } from './StudioImageReferenceTray';
import { StudioCommandPalette } from './StudioCommandPalette';
import { StudioControlledWorkflows } from './StudioControlledWorkflows';
import { StudioMaskEditor } from './StudioMaskEditor';
import { StudioParameterExplainers } from './StudioParameterExplainers';
import { StudioPromptComposer } from './StudioPromptComposer';
import { StudioPromptDiffPanel } from './StudioPromptDiffPanel';
import { StudioPromptEnhancer } from './StudioPromptEnhancer';
import { StudioVariationPlanner, type StudioVariationOption } from './StudioVariationPlanner';
import NodeContent from './NodeContent';
import {
  DEFAULT_STUDIO_FORM,
  STUDIO_MODEL_LABELS,
  STUDIO_MODEL_PROFILES,
  STUDIO_MODE_LABELS,
  STUDIO_OFFLOAD_LABELS,
  AUDIO_STUDIO_MODES,
  VIDEO_STUDIO_MODES,
  getStudioModelArtifactNote,
  getStudioModelDisplayName,
  getStudioModelRuntimeLabel,
} from '../studio/modelProfiles';
import {
  getStudioResourceExecutionPathLabel,
  resolveStudioResourcePlan,
  studioLowMemoryFormValues,
  STUDIO_RESOURCE_LABELS,
  STUDIO_RESOURCE_MODES,
} from '../studio/resourcePlanner';
import { STUDIO_PRESETS, STUDIO_TEMPLATES } from '../studio/templates';
import { exactStudioExecutionProfileForForm } from '../studio/executionSpecs';
import {
  autoPlanIsReady,
  controlledArtifactProofNotice,
  fetchAutoResourcePlan,
  formPatchForAutoCandidate,
  selectedAutoCandidate,
} from '../studio/autoResource';
import type {
  AppModeInput,
  StudioAspectRatio,
  StudioFormState,
  StudioMode,
  StudioModelType,
  StudioResourceMode,
} from '../studio/types';
import {
  getPreferredRuntimeDevice,
  inspectCurrentGraph,
  runtimeDeviceIsAvailable,
  validateCurrentRun,
} from '../studio/runReadiness';
import { useStudioReadiness } from '../studio/useStudioReadiness';
import { summarizeRunReadinessIssues, useRunReadinessIssues } from '../studio/useRunReadinessIssues';
import { formatRequestError } from '../utils/requestJson';
import { requestExecutionStop } from '../utils/serverActions';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { applyStudioRuntimeHints } from '../studio/runPreparation';
import { ensureStudioAutoPlanReadyForRun, useStudioRunActions } from '../studio/useStudioRunActions';
import { syncManagedNodeControlChange } from '../studio/managedControlSync';
import { diffStudioFormValues, formatStudioFieldValue, publishStudioChange } from '../studio/presetDiff';
import {
  ActionStatusRow,
  ModiffDisclosure,
  ModiffFieldShell,
  SectionHeader,
  StatusBox,
  StatusActionChip,
  StudioButton,
  StudioCheckbox,
  StudioChip,
  StudioDivider,
  StudioIconButton,
  StudioInput,
  StudioSelect,
  StudioSection,
  StudioSlider,
  StatusLine,
  StudioTextInput,
} from '../ui';
import { cx } from '../utils/classNames';

const ASPECT_OPTIONS: { label: StudioAspectRatio; width: number; height: number }[] = [
  { label: '1:1', width: 1024, height: 1024 },
  { label: '4:3', width: 1152, height: 864 },
  { label: '3:4', width: 864, height: 1152 },
  { label: '16:9', width: 1344, height: 768 },
  { label: '9:16', width: 768, height: 1344 },
];

function numberValue(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function copyText(value: string, label: string) {
  void navigator.clipboard.writeText(value);
  enqueueSnackbar(`${label} copied`, { variant: 'success', autoHideDuration: 1800 });
}

export default function StudioPanel() {
  const [isWorking, setIsWorking] = useState(false);
  const [autoPlanChecking, setAutoPlanChecking] = useState(false);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(0);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const setLightboxOpener = useSettingsStore((state) => state.setLightboxOpener);
  const setTemplateBrowserOpen = useSettingsStore((state) => state.setTemplateBrowserOpen);
  const setGalleryLibraryOpen = useSettingsStore((state) => state.setGalleryLibraryOpen);
  const studioViewMode = useSettingsStore((state) => state.studioViewMode);
  const showRunIssues = useRunIssueStore((state) => state.showIssues);
  const { sid, isConnected } = useWebsocketStore(
    useShallow((state) => ({
      sid: state.sid,
      isConnected: state.isConnected,
    })),
  );
  const {
    hfCache,
    localModels,
    modelCacheDiagnostics,
    runtimeStatus,
    nodesRegistry,
    studioModelCapabilities,
    studioModelCapabilitiesAuthoritative,
    studioExecutionSpecInvalid,
    installHfModel,
  } = useNodesStore(
    useShallow((state) => ({
      hfCache: state.hfCache,
      localModels: state.localModels,
      modelCacheDiagnostics: state.modelCacheDiagnostics,
      runtimeStatus: state.runtimeStatus,
      nodesRegistry: state.nodesRegistry,
      studioModelCapabilities: state.studioModelCapabilities,
      studioModelCapabilitiesAuthoritative: state.studioModelCapabilitiesAuthoritative,
      studioExecutionSpecInvalid: state.studioExecutionSpecInvalid,
      installHfModel: state.installHfModel,
    })),
  );
  const {
    form,
    autoResourcePlan,
    autoResourceCheck,
    promptHistory,
    savedSnippets,
    negativePromptPresets,
    activeTemplateId,
    activeWorkflowTabId,
    outputs,
    lastError,
    recentChange,
    pinnedGraphInputIds,
    workflowCanvasHydrated,
    launcherDismissed,
    applyPreset,
    addPromptHistory,
    togglePinnedGraphInput,
    saveCurrentPromptAsSnippet,
    removeSnippet,
    applySnippet,
    applyNegativePreset,
    detachManagedGraph,
  } = useStudioStore(
    useShallow((state) => ({
      form: state.form,
      autoResourceCheck: state.autoResourceCheck,
      promptHistory: state.promptHistory,
      savedSnippets: state.savedSnippets,
      negativePromptPresets: state.negativePromptPresets,
      autoResourcePlan: state.autoResourcePlan,
      activeTemplateId: state.activeTemplateId,
      activeWorkflowTabId: state.activeWorkflowTabId,
      outputs: state.outputs,
      lastError: state.lastError,
      recentChange: state.recentChange,
      pinnedGraphInputIds: state.pinnedGraphInputIds,
      workflowCanvasHydrated: state.workflowCanvasHydrated,
      launcherDismissed: state.launcherDismissed,
      applyPreset: state.applyPreset,
      addPromptHistory: state.addPromptHistory,
      togglePinnedGraphInput: state.togglePinnedGraphInput,
      saveCurrentPromptAsSnippet: state.saveCurrentPromptAsSnippet,
      removeSnippet: state.removeSnippet,
      applySnippet: state.applySnippet,
      applyNegativePreset: state.applyNegativePreset,
      detachManagedGraph: state.detachManagedGraph,
    })),
  );

  const activeTemplate = useMemo(
    () => STUDIO_TEMPLATES.find((template) => template.id === activeTemplateId),
    [activeTemplateId],
  );
  const activeWorkflowOutputs = useMemo(
    () => scopedOutputsForWorkflow(outputs, activeWorkflowTabId),
    [activeWorkflowTabId, outputs],
  );
  const visiblePresets = useMemo(
    () =>
      STUDIO_PRESETS.filter((preset) => {
        const videoPreset = Boolean(preset.compatibleModes?.some((mode) => VIDEO_STUDIO_MODES.includes(mode)));
        const audioPreset = Boolean(preset.compatibleModes?.some((mode) => AUDIO_STUDIO_MODES.includes(mode)));
        if (VIDEO_STUDIO_MODES.includes(form.mode) && !videoPreset) return false;
        if (AUDIO_STUDIO_MODES.includes(form.mode) && !audioPreset) return false;
        const modeMatch = !preset.compatibleModes || preset.compatibleModes.includes(form.mode);
        const modelMatch = !preset.compatibleModelTypes || preset.compatibleModelTypes.includes(form.modelType);
        return modeMatch && modelMatch;
      }),
    [form.mode, form.modelType],
  );
  const isVideoMode = VIDEO_STUDIO_MODES.includes(form.mode);
  const isAudioMode = AUDIO_STUDIO_MODES.includes(form.mode);
  const resourcePlan = useMemo(() => resolveStudioResourcePlan(form), [form]);
  const expertResourceMode = studioViewMode === 'expert';
  const autoPlanExecution = useMemo(
    () => ({
      device: form.device,
      autoOffload: form.autoOffload,
      offloadMode: form.offloadMode,
    }),
    [form.autoOffload, form.device, form.offloadMode],
  );
  const selectedAutoPlanCandidate = selectedAutoCandidate(autoResourcePlan, autoPlanExecution);
  const resourcePathLabel = getStudioResourceExecutionPathLabel({
    resourceMode: resourcePlan.resourceMode,
    executionPath: selectedAutoPlanCandidate?.executionPath ?? resourcePlan.executionPath,
  });
  const autoResourceChecking = autoPlanChecking || autoResourceCheck.status !== 'idle';
  const autoPlanReady = form.resourceMode !== 'auto' || autoPlanIsReady(autoResourcePlan, autoPlanExecution);
  const autoPlanStatusLabel =
    form.resourceMode === 'auto'
      ? (autoResourceCheck.message ?? autoResourcePlan?.statusLabel ?? 'Checking hardware')
      : 'Expert controls active';
  const selectedModelName = getStudioModelDisplayName(STUDIO_MODEL_PROFILES[form.modelType]);
  const selectedModelRuntimeLabel = getStudioModelRuntimeLabel(STUDIO_MODEL_PROFILES[form.modelType], form);
  const selectedModelArtifactNote = getStudioModelArtifactNote(STUDIO_MODEL_PROFILES[form.modelType]);
  const expertQuantizationModes =
    exactStudioExecutionProfileForForm(studioModelCapabilities, studioExecutionSpecInvalid, form)
      ?.expert_quantization_modes ?? [];
  const selectedModelInfo = `${selectedModelRuntimeLabel}. ${selectedModelName} defaults to ${STUDIO_MODEL_PROFILES[form.modelType].recommendedSteps} steps, ${STUDIO_MODEL_PROFILES[form.modelType].guidanceLabel.toLowerCase()} ${STUDIO_MODEL_PROFILES[form.modelType].recommendedGuidance}, ${STUDIO_MODEL_PROFILES[form.modelType].defaultDtype}. ${selectedModelArtifactNote}`;
  const selectedAutoPlanSummary = selectedAutoPlanCandidate
    ? `${selectedAutoPlanCandidate.resolvedArtifact ?? selectedAutoPlanCandidate.artifact ?? selectedAutoPlanCandidate.modelRepo} | ${selectedAutoPlanCandidate.qualityTier ?? 'quality plan'} | ${selectedAutoPlanCandidate.generation?.width ?? form.width}x${selectedAutoPlanCandidate.generation?.height ?? form.height} | ${selectedAutoPlanCandidate.generation?.steps ?? form.steps} steps | ${selectedAutoPlanCandidate.offloadMode ?? form.offloadMode}`
    : null;
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const controlledProofNotice = controlledArtifactProofNotice(
    selectedAutoPlanCandidate,
    graphBinding?.controlled?.contractIds,
  );
  const graphFinalization = useStudioStore((state) => state.graphFinalization);
  const managedGraphRunBlockingMessage = graphBinding ? getStudioGraphRunBlockingMessage(form) : null;
  const displayedGraphFinalization =
    graphFinalization ??
    (managedGraphRunBlockingMessage
      ? {
          status: 'warning' as const,
          message: managedGraphRunBlockingMessage,
        }
      : null);
  const canvasTransition = useStudioStore((state) => state.canvasTransition);
  const templateGraphPreparing = Boolean(
    canvasTransition?.type === 'template_graph_building' && canvasTransition.workflowTabId === activeWorkflowTabId,
  );
  const graphInspectionSignature = useFlowStore(
    useShallow((state) => ({
      nodes: state.nodes
        .map((node) => {
          const modelParams = Object.entries(node.data.params)
            .filter(([key]) => /repo|model|checkpoint|ckpt|safetensors|lora|vae|controlnet|adapter/i.test(key))
            .map(([key, param]) => `${key}:${JSON.stringify(param.value ?? param.default ?? '')}`)
            .join(',');
          return `${node.id}:${node.data.module}:${node.data.action}:${node.data.uiState?.disabled ? 'disabled' : 'enabled'}:${modelParams}`;
        })
        .join('|'),
      edges: state.edges
        .map(
          (edge) => `${edge.id}:${edge.source}:${edge.sourceHandle ?? ''}->${edge.target}:${edge.targetHandle ?? ''}`,
        )
        .join('|'),
    })),
  );
  void graphInspectionSignature;
  const graphInspection = inspectCurrentGraph();
  const graphDivergence =
    workflowCanvasHydrated && !templateGraphPreparing && graphBinding
      ? inspectStudioGraphBindingDivergence(graphBinding)
      : null;
  const graphDivergenceKey = graphDivergence
    ? `${graphDivergence.kind}:${graphDivergence.details ?? graphDivergence.message}`
    : '';
  const customGraphMode =
    workflowCanvasHydrated &&
    !templateGraphPreparing &&
    ((!graphBinding && graphInspection.nodeCount > 0) || Boolean(graphDivergence));
  const showExactNodeInspector = customGraphMode || studioViewMode === 'expert';
  const customGraphModelText =
    graphInspection.modelRefs.length > 0
      ? `${new Set(graphInspection.modelRefs.map((reference) => `${reference.kind}:${reference.value}`)).size} model refs`
      : 'Graph-defined';
  const runReadiness = useRunReadinessIssues({ sid, isConnected, includeStudio: !customGraphMode });
  const runReadinessSummary = useMemo(() => summarizeRunReadinessIssues(runReadiness.issues), [runReadiness.issues]);
  const studioReadinessMeta =
    runReadiness.blockingIssues.length > 0
      ? `${runReadiness.blockingIssues.length} issue${runReadiness.blockingIssues.length === 1 ? '' : 's'}`
      : runReadiness.warningIssues.length > 0
        ? `${runReadiness.warningIssues.length} warning${runReadiness.warningIssues.length === 1 ? '' : 's'}`
        : undefined;
  const graphNodes = useFlowStore(useShallow((state) => state.nodes));
  const emptyWorkflow =
    workflowCanvasHydrated && !templateGraphPreparing && !launcherDismissed && !graphBinding && graphNodes.length === 0;
  const selectedGraphNodes = useMemo(() => graphNodes.filter((node) => node.selected), [graphNodes]);
  const inspectExactNode = showExactNodeInspector || selectedGraphNodes.length > 0;
  const graphInputCandidates = useMemo(
    () => (inspectExactNode ? graphParamInputCandidates(graphNodes) : []),
    [graphNodes, inspectExactNode],
  );
  const effectivePinnedGraphInputIds = pinnedGraphInputIds.filter((id) =>
    graphInputCandidates.some((input) => input.id === id),
  );
  const pinnedGraphInputs = useMemo(() => {
    const ids = new Set(effectivePinnedGraphInputIds);
    return graphInputCandidates.filter((input) => ids.has(input.id));
  }, [effectivePinnedGraphInputIds, graphInputCandidates]);
  const {
    capability,
    compatibleModels,
    compatibleModes,
    showImageTray,
    supportsMask,
    inpaintContract,
    missingInstallTarget,
  } = useStudioReadiness({
    form,
    hfCache,
    localModels,
    modelCacheDiagnostics,
    autoResourcePlan,
    backendCapabilities: studioModelCapabilities,
    backendCapabilitiesAuthoritative: studioModelCapabilitiesAuthoritative,
  });
  const runBlockedReason = runReadiness.blockingIssues[0]?.message ?? '';
  const runControlsBlocked = !runReadiness.canRun;
  const showFullStudioForm = !customGraphMode && !emptyWorkflow;
  const showStudioResourceHeader = false;
  const {
    updateAndSync,
    handleCreateGraph,
    handleModeChange,
    handleModelTypeChange,
    handleResourceModeChange,
    handleRun,
    openSetup,
  } = useStudioRunActions({
    sid,
    isConnected,
    missingInstallTarget,
    installHfModel,
    setIsWorking,
  });

  useEffect(() => {
    // Template creation publishes its managed graph only after dynamic fields,
    // layout, and saved-tab state are stable. Validating the deliberately hidden
    // intermediate graph would briefly surface false structure/model issues in
    // the right panel and paint those issues onto nodes before reveal.
    if (!workflowCanvasHydrated || templateGraphPreparing) return;
    validateCurrentRun({ sid, isConnected, includeStudio: true, showDialog: false });
  }, [
    sid,
    isConnected,
    form,
    graphBinding,
    graphFinalization,
    hfCache,
    localModels,
    modelCacheDiagnostics,
    runtimeStatus,
    nodesRegistry,
    templateGraphPreparing,
    workflowCanvasHydrated,
  ]);

  useEffect(() => {
    if (
      !graphBinding ||
      !graphDivergence ||
      graphFinalization?.status === 'pending' ||
      canvasTransition?.type === 'template_graph_building'
    ) {
      return;
    }
    detachManagedGraph();
  }, [
    canvasTransition?.type,
    detachManagedGraph,
    graphBinding,
    graphDivergence,
    graphDivergenceKey,
    graphFinalization?.status,
  ]);

  useEffect(() => {
    if (!runtimeStatus) return;
    const preferredDevice = getPreferredRuntimeDevice(runtimeStatus);
    if (preferredDevice === form.device || runtimeDeviceIsAvailable(runtimeStatus, form.device)) return;
    if (form.device !== DEFAULT_STUDIO_FORM.device && !form.device.toLowerCase().startsWith('cuda')) return;
    updateAndSync({ device: preferredDevice });
  }, [form.device, runtimeStatus, updateAndSync]);

  const handleAspectChange = (aspectRatio: StudioAspectRatio) => {
    const aspect = ASPECT_OPTIONS.find((item) => item.label === aspectRatio);
    updateAndSync(aspect ? { aspectRatio, width: aspect.width, height: aspect.height } : { aspectRatio });
  };

  const applyAutoCandidateToGraph = useCallback(async () => {
    if (form.resourceMode !== 'auto') return null;
    const context = captureWorkflowOperationContext();
    setAutoPlanChecking(true);
    try {
      const liveForm = useStudioStore.getState().form;
      const currentPlan = autoPlanIsReady(useStudioStore.getState().autoResourcePlan, liveForm)
        ? useStudioStore.getState().autoResourcePlan
        : await fetchAutoResourcePlan(liveForm);
      assertWorkflowOperationContext(context);

      if (!currentPlan || !autoPlanIsReady(currentPlan, liveForm)) {
        useStudioStore.getState().setAutoResourcePlan(currentPlan);
        const message =
          currentPlan?.blockingReason || currentPlan?.message || 'Auto could not choose a runnable local plan yet.';
        useStudioStore.getState().setLastError(message);
        enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
        return null;
      }

      const currentForm = useStudioStore.getState().form;
      const previousShapeKey = getStudioGraphShapeKey(currentForm);
      const candidate = selectedAutoCandidate(currentPlan, currentForm);
      const patch = formPatchForAutoCandidate(candidate, currentForm);
      useStudioStore.getState().applyAutoResourcePlan(currentPlan, patch);
      advanceWorkflowOperationContext(context);
      const nextForm = useStudioStore.getState().form;
      syncStudioGraphValues(nextForm);
      if (previousShapeKey !== getStudioGraphShapeKey(nextForm)) {
        await createOrUpdateStudioGraph(nextForm, context);
      } else {
        await ensureStudioGraphReadyForRun(nextForm, context);
      }
      assertWorkflowOperationContext(context);
      enqueueSnackbar('Auto plan refreshed.', { variant: 'success', autoHideDuration: 2200 });
      return currentPlan;
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return null;
      const message = String(error);
      useStudioStore.getState().setLastError(message);
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
      return null;
    } finally {
      setAutoPlanChecking(false);
    }
  }, [form.resourceMode]);

  const handlePresetApply = useCallback(
    (preset: (typeof STUDIO_PRESETS)[number]) => {
      const before = useStudioStore.getState().form;
      const appliedPreset =
        preset.id === 'low_vram'
          ? {
              ...preset,
              values: {
                ...preset.values,
                ...studioLowMemoryFormValues(before),
              },
            }
          : preset;
      applyPreset(appliedPreset);
      const after = useStudioStore.getState().form;
      const fields = diffStudioFormValues(
        before,
        after,
        Object.keys(appliedPreset.values) as Array<keyof StudioFormState>,
      );
      const graphShapeChanged =
        before.quantizationMode !== after.quantizationMode || before.resourceMode !== after.resourceMode;
      queueMicrotask(() => {
        if (graphShapeChanged) {
          void createOrUpdateStudioGraph(after);
          return;
        }
        syncStudioGraphValues(after);
      });
      publishStudioChange(
        `${preset.label} applied`,
        fields,
        useStudioStore.getState().graphBinding?.managedNodeIds ?? [],
      );
      if (fields.length > 0) {
        enqueueSnackbar(`${preset.label} updated ${fields.map((field) => field.label).join(', ')}`, {
          variant: 'success',
          autoHideDuration: 2600,
        });
      }
    },
    [applyPreset],
  );

  const openGallery = useCallback(() => {
    setGalleryLibraryOpen(true);
  }, [setGalleryLibraryOpen]);

  const openTemplateGallery = useCallback(() => {
    setTemplateBrowserOpen(true);
  }, [setTemplateBrowserOpen]);

  const handleInterrupt = useCallback(async () => {
    try {
      const payload = await requestExecutionStop();
      const message =
        typeof payload.message === 'string' && payload.message.trim() ? payload.message : 'Interrupt requested';
      enqueueSnackbar(message, { variant: 'success', autoHideDuration: 3000 });
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Could not stop the current execution.'), {
        variant: 'error',
        autoHideDuration: 5000,
      });
    }
  }, []);

  const handleExportApiGraph = useCallback(() => {
    if (!sid) {
      enqueueSnackbar('Connect to the MoDiff server before exporting the API graph.', {
        variant: 'error',
        autoHideDuration: 3000,
      });
      return;
    }
    const apiGraph = applyStudioRuntimeHints(useFlowStore.getState().exportGraph(sid));
    const blob = new Blob([JSON.stringify(apiGraph, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'modiff-api-graph.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }, [sid]);

  const restoreLatestOutput = useCallback(() => {
    const state = useStudioStore.getState();
    const latest = latestOutputForWorkflow(state.outputs, state.activeWorkflowTabId, {
      includeUnscopedFallback: false,
    });
    if (!latest) return;
    useStudioStore.getState().restoreWorkflowFromOutput(latest);
    setRightPanelOpen(true);
    setRightPanelTab('studio');
    enqueueSnackbar('Latest Gallery workflow restored', { variant: 'success', autoHideDuration: 2000 });
  }, [setRightPanelOpen, setRightPanelTab]);

  const rerunLatestOutput = useCallback(async () => {
    const state = useStudioStore.getState();
    const latest = latestOutputForWorkflow(state.outputs, state.activeWorkflowTabId, {
      includeUnscopedFallback: false,
    });
    if (!latest || !sid || !isConnected) {
      enqueueSnackbar('Connect to the MoDiff server and keep a Gallery output available before rerunning.', {
        variant: 'error',
        autoHideDuration: 4000,
      });
      return;
    }
    setIsWorking(true);
    try {
      useStudioStore.getState().restoreWorkflowFromOutput(latest);
      const context = captureWorkflowOperationContext();
      const autoReady = await ensureStudioAutoPlanReadyForRun(context);
      if (!autoReady) return;
      await coordinateGraphRun({
        sid,
        studioContext: { forceDeterministic: !latest.formSnapshot.randomSeed },
        workflowContext: context,
      });
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 6000 });
    } finally {
      setIsWorking(false);
    }
  }, [isConnected, sid]);

  const compareLatestOutputs = useCallback(() => {
    const state = useStudioStore.getState();
    const [latest, previous] = scopedOutputsForWorkflow(state.outputs, state.activeWorkflowTabId);
    if (!latest || !previous) return;
    setLightboxOpener({ images: [previous.url, latest.url], currentIndex: 1, dataType: 'image', mimeType: null });
  }, [setLightboxOpener]);

  const handleReviewRunIssues = useCallback(() => {
    showRunIssues(runReadiness.issues);
  }, [runReadiness.issues, showRunIssues]);

  const handleRunSweep = useCallback(
    async (variations: StudioVariationOption[]) => {
      if (!sid || !isConnected) {
        enqueueSnackbar('Connect to the MoDiff server before running a sweep.', {
          variant: 'error',
          autoHideDuration: 4000,
        });
        return;
      }
      if (runBlockedReason) {
        enqueueSnackbar(runBlockedReason, { variant: 'error', autoHideDuration: 5000 });
        return;
      }

      const baseForm = {
        ...useStudioStore.getState().form,
        referenceImages: [...useStudioStore.getState().form.referenceImages],
      };
      const context = captureWorkflowOperationContext();
      const variationGroupId = `sweep-${Date.now()}`;
      setIsWorking(true);
      useStudioStore.getState().addPromptHistory(baseForm.prompt);

      try {
        for (const variation of variations) {
          assertWorkflowOperationContext(context);
          const nextValues = { ...variation.values, randomSeed: false };
          useStudioStore.getState().updateForm(nextValues);
          advanceWorkflowOperationContext(context);
          const nextForm = useStudioStore.getState().form;
          syncStudioGraphValues(nextForm);
          const autoReady = await ensureStudioAutoPlanReadyForRun(context);
          if (!autoReady) break;
          await ensureStudioGraphReadyForRun(useStudioStore.getState().form, context);
          assertWorkflowOperationContext(context);
          const { response } = await coordinateGraphRun({
            sid,
            workflowContext: context,
            studioContext: {
              forceDeterministic: true,
              variation: {
                variationGroupId,
                variationLabel: variation.label,
              },
            },
          });
          assertWorkflowOperationContext(context);
          if (response.error) {
            useStudioStore.getState().setLastError(response.message || 'MoDiff could not queue this sweep variation.');
            break;
          }
        }
        enqueueSnackbar('Variation sweep queued', { variant: 'success', autoHideDuration: 2200 });
      } catch (error) {
        if (isWorkflowOperationCancelled(error)) return;
        const message = String(error);
        useStudioStore.getState().setLastError(message);
        enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
      } finally {
        if (workflowOperationContextIsCurrent(context)) {
          useStudioStore.getState().updateForm(baseForm);
          advanceWorkflowOperationContext(context);
          syncStudioGraphValues(baseForm);
          await createOrUpdateStudioGraph(baseForm, context).catch((error) => {
            if (!isWorkflowOperationCancelled(error)) console.error('Could not restore the sweep graph', error);
          });
        }
        setIsWorking(false);
      }
    },
    [isConnected, runBlockedReason, sid],
  );

  useLayoutEffect(() => {
    const header = stickyHeaderRef.current;
    if (!header) return undefined;

    const syncHeaderHeight = () => {
      const nextHeight = Math.ceil(header.getBoundingClientRect().height);
      setStickyHeaderHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };

    syncHeaderHeight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let animationFrame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(syncHeaderHeight);
    });
    observer.observe(header);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="studio-panel">
      <div
        ref={stickyHeaderRef}
        className="sticky top-0 z-20 -mx-3 -mt-3 grid gap-2 border-b border-modiff-border bg-modiff-bg p-3 shadow-modiff-node"
        data-testid="studio-sticky-header"
      >
        {showStudioResourceHeader &&
          !customGraphMode &&
          (expertResourceMode ? (
            <ModiffFieldShell
              htmlFor="studio-header-resource-mode"
              className="grid gap-1.5 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-2"
              label={
                <span className="flex items-center justify-between gap-2">
                  <span>Resource mode</span>
                  <span
                    data-testid="studio-resource-path-badge"
                    className="shrink-0 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 py-1 text-xs font-semibold text-modiff-subtle-text"
                  >
                    {resourcePathLabel}
                  </span>
                </span>
              }
              labelClassName="block uppercase"
            >
              <div className="flex items-center gap-2">
                <StudioSelect
                  id="studio-header-resource-mode"
                  aria-label="Resource mode"
                  className="flex-1"
                  data-testid="studio-header-resource-mode-select"
                  value={form.resourceMode}
                  onValueChange={(value) => {
                    void handleResourceModeChange(value as StudioResourceMode);
                  }}
                  options={STUDIO_RESOURCE_MODES.map((mode) => ({
                    value: mode,
                    label: STUDIO_RESOURCE_LABELS[mode],
                  }))}
                />
                <StudioButton
                  tone="ghost"
                  className="min-h-8 px-2 text-xs"
                  onClick={() => {
                    void handleCreateGraph();
                  }}
                  disabled={isWorking}
                  data-testid="studio-update-graph"
                  title="Sync Studio values into the managed graph."
                >
                  Sync
                </StudioButton>
              </div>
              {form.resourceMode === 'auto' ? (
                <div className="grid gap-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className={autoPlanReady ? 'text-modiff-green' : 'text-modiff-subtle-text'}>
                      {autoPlanStatusLabel}
                    </span>
                    <StudioButton
                      tone="ghost"
                      className="min-h-7 px-2 text-xs"
                      onClick={() => {
                        void applyAutoCandidateToGraph();
                      }}
                      disabled={autoResourceChecking || isWorking}
                      data-testid="studio-auto-plan-check"
                    >
                      {autoResourceChecking ? 'Checking...' : autoPlanReady ? 'Refresh' : 'Refresh Auto plan'}
                    </StudioButton>
                  </div>
                  {selectedAutoPlanCandidate ? (
                    <>
                      <p className="sr-only" data-testid="studio-auto-plan-summary-details">
                        {selectedAutoPlanCandidate.resolvedArtifact ??
                          selectedAutoPlanCandidate.artifact ??
                          selectedAutoPlanCandidate.modelRepo}{' '}
                        · {selectedAutoPlanCandidate.qualityTier ?? 'quality plan'} ·{' '}
                        {selectedAutoPlanCandidate.generation?.width ?? form.width}x
                        {selectedAutoPlanCandidate.generation?.height ?? form.height} ·{' '}
                        {selectedAutoPlanCandidate.generation?.steps ?? form.steps} steps ·{' '}
                        {selectedAutoPlanCandidate.offloadMode ?? form.offloadMode}
                      </p>
                      <div className="flex flex-wrap gap-1.5" data-testid="studio-auto-plan-summary">
                        <ReadinessPill
                          tone={controlledProofNotice ? 'warning' : 'success'}
                          title={controlledProofNotice?.message ?? selectedAutoPlanSummary ?? undefined}
                        >
                          {controlledProofNotice?.label ?? 'Auto plan'}
                        </ReadinessPill>
                        <ReadinessPill
                          title={
                            selectedAutoPlanCandidate.resolvedArtifact ??
                            selectedAutoPlanCandidate.artifact ??
                            selectedAutoPlanCandidate.modelRepo
                          }
                        >
                          Artifact
                        </ReadinessPill>
                        <ReadinessPill title={selectedAutoPlanSummary ?? undefined}>
                          {selectedAutoPlanCandidate.generation?.steps ?? form.steps} steps
                        </ReadinessPill>
                        {selectedAutoPlanCandidate.artifactResolution?.substituted ||
                        selectedAutoPlanCandidate.compatibilityEvidence?.level !== 'ran_here' ||
                        controlledProofNotice ? (
                          <StudioIconButton
                            size="compact"
                            className="rounded-full border border-hf-yellow/60 bg-hf-yellow/10 text-hf-yellow hover:bg-hf-yellow/20 hover:text-hf-yellow"
                            title="Open model compatibility details"
                            data-testid="studio-compatibility-warning"
                            onClick={() => {
                              setRightPanelOpen(true);
                              setRightPanelTab('compatibility');
                            }}
                          >
                            <AlertTriangle size={13} />
                          </StudioIconButton>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <ReadinessPill
                      tone={autoResourcePlan?.blockingReason ? 'warning' : 'default'}
                      title={
                        autoResourcePlan?.blockingReason ||
                        'Auto chooses the best local recipe after checking hardware, resources, and installed artifacts.'
                      }
                    >
                      {autoResourcePlan?.blockingReason ? 'Auto needs setup' : 'Auto plan'}
                    </ReadinessPill>
                  )}
                </div>
              ) : null}
            </ModiffFieldShell>
          ) : (
            <div
              className="flex flex-wrap items-center gap-1.5 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-2"
              data-testid="studio-auto-status-strip"
            >
              <ReadinessPill
                tone={autoPlanReady ? 'success' : 'warning'}
                title={autoResourcePlan?.blockingReason || autoPlanStatusLabel}
              >
                Auto
              </ReadinessPill>
              <ReadinessPill title={resourcePathLabel}>Recipe</ReadinessPill>
              {selectedAutoPlanCandidate ? (
                <>
                  <p className="sr-only" data-testid="studio-auto-plan-summary-details">
                    {selectedAutoPlanCandidate.resolvedArtifact ??
                      selectedAutoPlanCandidate.artifact ??
                      selectedAutoPlanCandidate.modelRepo}{' '}
                    | {selectedAutoPlanCandidate.qualityTier ?? 'quality plan'} |{' '}
                    {selectedAutoPlanCandidate.generation?.width ?? form.width}x
                    {selectedAutoPlanCandidate.generation?.height ?? form.height} |{' '}
                    {selectedAutoPlanCandidate.generation?.steps ?? form.steps} steps |{' '}
                    {selectedAutoPlanCandidate.offloadMode ?? form.offloadMode}
                  </p>
                  <ReadinessPill
                    title={
                      selectedAutoPlanCandidate.resolvedArtifact ??
                      selectedAutoPlanCandidate.artifact ??
                      selectedAutoPlanCandidate.modelRepo
                    }
                  >
                    Artifact
                  </ReadinessPill>
                </>
              ) : null}
              <StudioButton
                tone="ghost"
                className="ml-auto min-h-7 px-2 text-xs"
                onClick={() => {
                  void applyAutoCandidateToGraph();
                }}
                disabled={autoResourceChecking || isWorking}
                data-testid="studio-auto-plan-check"
                title={selectedAutoPlanSummary ?? autoPlanStatusLabel}
              >
                {autoResourceChecking ? 'Checking...' : 'Refresh'}
              </StudioButton>
            </div>
          ))}
        <StudioCommandPalette
          isWorking={isWorking}
          runBlocked={runControlsBlocked}
          expertMode={expertResourceMode}
          hasGalleryItems={activeWorkflowOutputs.length > 0}
          hasComparePair={activeWorkflowOutputs.length > 1}
          onRun={() => {
            void handleRun();
          }}
          onInterrupt={() => {
            void handleInterrupt();
          }}
          onUpdateGraph={() => {
            void handleCreateGraph();
          }}
          onExport={handleExportApiGraph}
          onSavePrompt={saveCurrentPromptAsSnippet}
          onOpenGallery={openGallery}
          onOpenTemplateGallery={openTemplateGallery}
          onOpenSetup={openSetup}
          onRestoreLatest={restoreLatestOutput}
          onRerunLatest={() => {
            void rerunLatestOutput();
          }}
          onCompareLatest={compareLatestOutputs}
        />
        {displayedGraphFinalization &&
          displayedGraphFinalization.status !== 'complete' &&
          displayedGraphFinalization.status !== 'idle' && (
            <StatusBox
              severity={
                displayedGraphFinalization.status === 'error'
                  ? 'error'
                  : displayedGraphFinalization.status === 'warning'
                    ? 'warning'
                    : 'info'
              }
              testId="studio-graph-finalization"
            >
              <p className="text-xs font-semibold text-modiff-text">
                {displayedGraphFinalization.status === 'pending'
                  ? 'Finalizing graph...'
                  : displayedGraphFinalization.status === 'warning'
                    ? 'Graph still finalizing'
                    : 'Graph finalization failed'}
              </p>
              <p className="mt-1 text-xs text-modiff-subtle-text">
                {displayedGraphFinalization.message || 'Preparing dynamic fields and managed links in the background.'}
              </p>
            </StatusBox>
          )}
        {lastError && (
          <StatusBox severity="error">
            <div className="flex items-start gap-2">
              <ModiffDisclosure
                className="min-w-0 flex-1"
                label="Last error"
                buttonClassName="min-h-0 justify-start p-0 text-xs text-modiff-invalid hover:bg-transparent"
                panelClassName="mt-1"
              >
                <p className="mt-1 max-h-28 overflow-auto break-words text-xs text-modiff-red">{lastError}</p>
              </ModiffDisclosure>
              <StudioIconButton title="Copy error" onClick={() => copyText(lastError, 'Error')}>
                <ClipboardCopy size={15} />
              </StudioIconButton>
            </div>
          </StatusBox>
        )}
      </div>

      <StudioSection id="task" title="Task" defaultOpen>
        {emptyWorkflow ? (
          <div
            className="grid gap-3 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
            data-testid="studio-empty-workflow"
          >
            <div>
              <p className="text-sm font-semibold text-modiff-text">No task or model selected</p>
              <p className="mt-1 text-xs leading-5 text-modiff-subtle-text">
                Choose a task in the canvas, browse templates, or add a node from the Nodes panel to build manually.
              </p>
            </div>
            <StudioButton
              fullWidth
              tone="secondary"
              icon={<GalleryVerticalEnd size={15} />}
              data-testid="studio-open-template-browser"
              onClick={openTemplateGallery}
            >
              Browse templates
            </StudioButton>
          </div>
        ) : (
          <div className="grid gap-2">
            <div
              className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
              data-testid="studio-task-model-summary"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase text-modiff-subtle-text">
                    {customGraphMode ? 'Current graph' : 'Current task'}
                  </p>
                  <h2 className="truncate text-base font-bold text-modiff-text">
                    {customGraphMode ? 'Custom graph' : STUDIO_MODE_LABELS[form.mode]}
                  </h2>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-xs font-semibold uppercase text-modiff-subtle-text">
                    {customGraphMode ? 'Graph models' : 'Selected model'}
                  </p>
                  <div className="flex items-center justify-end gap-1">
                    <h3 className="truncate text-base font-bold text-hf-yellow">
                      {customGraphMode ? customGraphModelText : selectedModelName}
                    </h3>
                    {!customGraphMode && (
                      <StudioIconButton title={selectedModelInfo}>
                        <Info size={13} />
                      </StudioIconButton>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {showFullStudioForm && (
              <>
                <StudioSelect
                  aria-label="Task"
                  value={form.mode}
                  data-testid="studio-task-select"
                  onValueChange={(value) => {
                    void handleModeChange(value as StudioMode);
                  }}
                  options={compatibleModes.map((mode) => ({
                    value: mode,
                    label: STUDIO_MODE_LABELS[mode],
                  }))}
                />
                <StudioSelect
                  aria-label="Model"
                  value={form.modelType}
                  data-testid="studio-model-select"
                  onValueChange={(value) => {
                    handleModelTypeChange(value as StudioModelType);
                  }}
                  options={compatibleModels.map((modelType) => ({
                    value: modelType,
                    label: STUDIO_MODEL_LABELS[modelType],
                  }))}
                />
              </>
            )}
            {templateGraphPreparing ? (
              <ActionStatusRow tone="info" title="Preparing graph" testId="studio-run-readiness" />
            ) : (
              <ActionStatusRow
                tone={runReadinessSummary.tone}
                title={
                  studioReadinessMeta
                    ? `${runReadinessSummary.title} - ${studioReadinessMeta}`
                    : runReadinessSummary.title
                }
                meta={runReadiness.primaryIssue?.message}
                testId="studio-run-readiness"
                onClick={runReadiness.issues.length > 0 ? handleReviewRunIssues : undefined}
              />
            )}
            {inspectExactNode && graphNodes.length > 0 ? (
              <GraphNodeInputs
                candidates={graphInputCandidates}
                nodes={graphNodes}
                pinnedInputs={pinnedGraphInputs}
                pinnedIds={effectivePinnedGraphInputIds}
                selectedNodes={selectedGraphNodes}
                workflowId={activeWorkflowTabId}
                onTogglePin={togglePinnedGraphInput}
              />
            ) : null}
            {graphNodes.length === 0 ? (
              <StudioButton
                fullWidth
                tone="secondary"
                icon={<GalleryVerticalEnd size={15} />}
                data-testid="studio-open-template-browser"
                onClick={openTemplateGallery}
              >
                Templates
              </StudioButton>
            ) : null}
          </div>
        )}
      </StudioSection>

      {showFullStudioForm && (
        <>
          <div className="relative grid gap-3">
            <StudioSection
              id="prompt"
              title="Prompt"
              defaultOpen
              testId="studio-sticky-prompt"
              className="sticky z-10 rounded-modiff-panel border border-modiff-border bg-modiff-bg px-2 pb-2 shadow-modiff-node before:absolute before:-inset-x-3 before:-top-3 before:h-3 before:bg-modiff-bg before:content-['']"
              stickyTop={stickyHeaderHeight + 12}
            >
              <div data-testid="studio-prompt-input">
                <StudioInput
                  label="Prompt"
                  value={form.prompt}
                  multiline
                  onChange={(value) => updateAndSync({ prompt: value })}
                />
              </div>
              {capability.supportsNegativePrompt !== false && (
                <div data-testid="studio-negative-prompt-input">
                  <StudioInput
                    label="Negative prompt"
                    value={form.negativePrompt}
                    multiline
                    onChange={(value) => updateAndSync({ negativePrompt: value })}
                  />
                </div>
              )}
              <div className="flex gap-2">
                <StudioButton tone="ghost" icon={<Save size={15} />} onClick={saveCurrentPromptAsSnippet}>
                  Snippet
                </StudioButton>
                <StudioButton
                  tone="ghost"
                  icon={<WandSparkles size={15} />}
                  onClick={() => addPromptHistory(form.prompt)}
                >
                  History
                </StudioButton>
              </div>
            </StudioSection>

            <StudioSection id="prompt-tools" title="Prompt tools">
              <section>
                <SectionHeader title="Presets" />
                <div className="flex flex-wrap gap-1.5">
                  {visiblePresets.map((preset) => (
                    <StudioChip key={preset.id} title={preset.description} onClick={() => handlePresetApply(preset)}>
                      {preset.label}
                    </StudioChip>
                  ))}
                </div>
                {recentChange && (
                  <div
                    className="mt-2 rounded-modiff-compact border border-hf-yellow/60 bg-modiff-surface p-2 text-xs text-modiff-text"
                    data-testid="studio-recent-change"
                  >
                    <p className="font-semibold text-hf-yellow">{recentChange.label}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {recentChange.fields.slice(0, 6).map((field) => (
                        <span
                          key={String(field.key)}
                          className="rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-modiff-subtle-text"
                        >
                          {field.label}: {formatStudioFieldValue(field.before)}
                          {' -> '}
                          {formatStudioFieldValue(field.after)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </section>
              <StudioDivider />
              <StudioPromptComposer form={form} template={activeTemplate} onChange={updateAndSync} />
              <StudioDivider />
              <StudioPromptEnhancer form={form} template={activeTemplate} onApply={updateAndSync} />
              {(promptHistory.length > 0 || savedSnippets.length > 0 || negativePromptPresets.length > 0) && (
                <>
                  <StudioDivider />
                  <div className="grid gap-3">
                    {savedSnippets.length > 0 && (
                      <section>
                        <SectionHeader title="Saved snippets" />
                        <div className="grid gap-1">
                          {savedSnippets.slice(0, 4).map((snippet) => (
                            <div key={snippet} className="flex gap-1">
                              <StudioButton
                                fullWidth
                                tone="ghost"
                                align="left"
                                onClick={() => {
                                  applySnippet(snippet);
                                  queueMicrotask(() => syncStudioGraphValues());
                                }}
                              >
                                {snippet}
                              </StudioButton>
                              <StudioIconButton title="Remove snippet" onClick={() => removeSnippet(snippet)}>
                                <Trash2 size={15} />
                              </StudioIconButton>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    {promptHistory.length > 0 && (
                      <section>
                        <SectionHeader title="Prompt history" />
                        <div className="grid gap-1">
                          {promptHistory.slice(0, 4).map((prompt) => (
                            <StudioButton
                              key={prompt}
                              tone="ghost"
                              align="left"
                              onClick={() => updateAndSync({ prompt })}
                            >
                              {prompt}
                            </StudioButton>
                          ))}
                        </div>
                      </section>
                    )}
                    {capability.supportsNegativePrompt !== false && (
                      <section>
                        <SectionHeader title="Negative presets" />
                        <div className="flex flex-wrap gap-1">
                          {negativePromptPresets.map((preset) => (
                            <StudioChip
                              key={preset}
                              onClick={() => {
                                applyNegativePreset(preset);
                                queueMicrotask(() => syncStudioGraphValues());
                              }}
                            >
                              {preset}
                            </StudioChip>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                </>
              )}
              <StudioDivider />
              <StudioPromptDiffPanel
                currentPrompt={form.prompt}
                promptHistory={promptHistory}
                savedSnippets={savedSnippets}
                onApplyPrompt={(prompt) => updateAndSync({ prompt })}
              />
            </StudioSection>
          </div>

          <StudioSection id="advanced-generation" title={expertResourceMode ? 'Advanced generation' : 'Generation'}>
            <section>
              <SectionHeader title={isVideoMode ? 'Video frame' : 'Image size'} />
              <div className="flex gap-2">
                <StudioSelect
                  aria-label="Aspect ratio"
                  value={form.aspectRatio}
                  onValueChange={(value) => handleAspectChange(value as StudioAspectRatio)}
                  options={[
                    ...ASPECT_OPTIONS.map((aspect) => ({ value: aspect.label, label: aspect.label })),
                    { value: 'custom', label: 'Custom' },
                  ]}
                  className="flex-1"
                />
                <StudioTextInput
                  aria-label="Width"
                  value={form.width}
                  data-testid="studio-width-input"
                  onChange={(event) =>
                    updateAndSync({ width: numberValue(event.target.value, form.width), aspectRatio: 'custom' })
                  }
                  className="w-[86px]"
                />
                <StudioTextInput
                  aria-label="Height"
                  value={form.height}
                  data-testid="studio-height-input"
                  onChange={(event) =>
                    updateAndSync({ height: numberValue(event.target.value, form.height), aspectRatio: 'custom' })
                  }
                  className="w-[86px]"
                />
              </div>
            </section>
            {form.mode === 'outpaint' && (
              <section data-testid="studio-outpaint-controls">
                <SectionHeader title="Outpaint canvas" />
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <StudioInput
                      label="Left margin"
                      value={form.outpaintLeft}
                      onChange={(value) => updateAndSync({ outpaintLeft: numberValue(value, form.outpaintLeft) })}
                    />
                    <StudioInput
                      label="Right margin"
                      value={form.outpaintRight}
                      onChange={(value) => updateAndSync({ outpaintRight: numberValue(value, form.outpaintRight) })}
                    />
                    <StudioInput
                      label="Top margin"
                      value={form.outpaintTop}
                      onChange={(value) => updateAndSync({ outpaintTop: numberValue(value, form.outpaintTop) })}
                    />
                    <StudioInput
                      label="Bottom margin"
                      value={form.outpaintBottom}
                      onChange={(value) => updateAndSync({ outpaintBottom: numberValue(value, form.outpaintBottom) })}
                    />
                  </div>
                  <ModiffFieldShell label={`Seam overlap: ${form.outpaintOverlap}`}>
                    <StudioSlider
                      min={0}
                      max={128}
                      step={4}
                      value={form.outpaintOverlap}
                      onChange={(value) => updateAndSync({ outpaintOverlap: value })}
                    />
                  </ModiffFieldShell>
                  <ModiffFieldShell label={`Mask feather: ${form.outpaintFeather}`}>
                    <StudioSlider
                      min={0}
                      max={64}
                      step={1}
                      value={form.outpaintFeather}
                      onChange={(value) => updateAndSync({ outpaintFeather: value })}
                    />
                  </ModiffFieldShell>
                  <StudioInput
                    label="Fill color"
                    value={form.outpaintFillColor}
                    onChange={(value) => updateAndSync({ outpaintFillColor: value })}
                  />
                </div>
              </section>
            )}
            <section>
              <SectionHeader title="Generation" />
              <div className="grid gap-2">
                <div data-testid="studio-seed-input">
                  <StudioInput
                    label="Seed"
                    value={form.seed}
                    onChange={(value) => updateAndSync({ seed: numberValue(value, form.seed) })}
                    disabled={form.randomSeed}
                  />
                </div>
                <StudioCheckbox
                  checked={form.randomSeed}
                  onChange={(checked) => updateAndSync({ randomSeed: checked })}
                  label="Randomize seed on export"
                />
                <ModiffFieldShell label={`Steps: ${form.steps}`}>
                  <StudioSlider
                    min={1}
                    max={80}
                    value={form.steps}
                    onChange={(value) => updateAndSync({ steps: value })}
                  />
                </ModiffFieldShell>
                <ModiffFieldShell label={`${capability.guidanceLabel}: ${form.guidanceScale}`}>
                  <StudioSlider
                    min={0}
                    max={10}
                    step={0.1}
                    value={form.guidanceScale}
                    onChange={(value) => updateAndSync({ guidanceScale: value })}
                  />
                </ModiffFieldShell>
                {isVideoMode && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <StudioInput
                        label="Frames"
                        value={form.numFrames}
                        onChange={(value) => updateAndSync({ numFrames: numberValue(value, form.numFrames) })}
                      />
                      <StudioInput
                        label="FPS"
                        value={form.fps}
                        onChange={(value) => updateAndSync({ fps: numberValue(value, form.fps) })}
                      />
                    </div>
                    <ModiffFieldShell label={`Conditioning: ${form.conditioningScale}`}>
                      <StudioSlider
                        min={0}
                        max={2}
                        step={0.05}
                        value={form.conditioningScale}
                        onChange={(value) => updateAndSync({ conditioningScale: value })}
                      />
                    </ModiffFieldShell>
                    {expertResourceMode ? (
                      <>
                        <ModiffFieldShell label={`Guidance 2: ${form.guidanceScale2}`}>
                          <StudioSlider
                            min={0}
                            max={20}
                            step={0.1}
                            value={form.guidanceScale2}
                            onChange={(value) => updateAndSync({ guidanceScale2: value })}
                          />
                        </ModiffFieldShell>
                        <div className="grid grid-cols-2 gap-2">
                          <StudioSelect
                            aria-label="Output type"
                            value={form.outputType}
                            onValueChange={(value) =>
                              updateAndSync({ outputType: value as StudioFormState['outputType'] })
                            }
                            options={[
                              { value: 'pil', label: 'Output: PIL' },
                              { value: 'np', label: 'Output: NumPy' },
                              { value: 'pt', label: 'Output: Torch' },
                            ]}
                          />
                          <StudioInput
                            label="Max tokens"
                            value={form.maxSequenceLength}
                            onChange={(value) =>
                              updateAndSync({ maxSequenceLength: numberValue(value, form.maxSequenceLength) })
                            }
                          />
                        </div>
                        <StudioInput
                          label="Attention kwargs JSON"
                          value={form.attentionKwargsJson}
                          multiline
                          onChange={(value) => updateAndSync({ attentionKwargsJson: value })}
                        />
                      </>
                    ) : null}
                  </>
                )}
                {capability.supportsImageInput && !isVideoMode && (
                  <>
                    <ModiffFieldShell label={`Strength: ${form.strength}`}>
                      <StudioSlider
                        min={0}
                        max={1}
                        step={0.05}
                        value={form.strength}
                        onChange={(value) => updateAndSync({ strength: value })}
                      />
                    </ModiffFieldShell>
                  </>
                )}
                {capability.supportsLayers && (
                  <StudioInput
                    label="Layers"
                    value={form.layers}
                    onChange={(value) => updateAndSync({ layers: numberValue(value, form.layers) })}
                  />
                )}
              </div>
            </section>
            <StudioParameterExplainers form={form} />
            <StudioVariationPlanner
              form={form}
              template={activeTemplate}
              onChange={updateAndSync}
              onRunSweep={(variations) => {
                void handleRunSweep(variations);
              }}
              disabled={isWorking || Boolean(runBlockedReason)}
            />
          </StudioSection>

          <StudioSection id="controlled-workflows" title="Controlled workflows">
            <StudioControlledWorkflows form={form} onChange={updateAndSync} disabled={isWorking} />
          </StudioSection>

          {isVideoMode && (
            <StudioSection id="video-inputs" title="Video inputs" defaultOpen>
              <div className="grid gap-2">
                {['video_to_video', 'video_inpaint', 'video_outpaint', 'video_color_edit'].includes(form.mode) && (
                  <StudioInput
                    label="Source video path"
                    value={form.sourceVideo}
                    onChange={(value) => updateAndSync({ sourceVideo: value })}
                  />
                )}
                {(form.mode === 'video_inpaint' || form.mode === 'video_outpaint') && (
                  <StudioInput
                    label="Mask video path"
                    value={form.maskVideo}
                    onChange={(value) => updateAndSync({ maskVideo: value })}
                  />
                )}
                {form.mode === 'control_to_video' && (
                  <StudioInput
                    label="Control video path"
                    value={form.controlVideo}
                    onChange={(value) => updateAndSync({ controlVideo: value })}
                  />
                )}
                {form.mode === 'image_to_video' && (
                  <p className="text-xs text-modiff-subtle-text">Use Reference inputs below for the starting image.</p>
                )}
                {form.mode === 'reference_to_video' && (
                  <p className="text-xs text-modiff-subtle-text">
                    Use Reference inputs below for subject and style images.
                  </p>
                )}
              </div>
            </StudioSection>
          )}

          {isAudioMode && (
            <StudioSection id="audio-inputs" title="Audio" defaultOpen>
              <div className="grid gap-2">
                {form.mode !== 'text_to_audio' && (
                  <StudioInput
                    label="Source audio path"
                    value={form.sourceAudio}
                    onChange={(value) => updateAndSync({ sourceAudio: value })}
                  />
                )}
                {form.mode === 'audio_variation' && (
                  <StudioInput
                    label="Reference audio path"
                    value={form.referenceAudio}
                    onChange={(value) => updateAndSync({ referenceAudio: value })}
                  />
                )}
                <StudioInput
                  label="Lyrics"
                  value={form.lyrics}
                  onChange={(value) => updateAndSync({ lyrics: value })}
                  multiline
                />
                <div className={cx('grid gap-2', expertResourceMode && 'grid-cols-2')}>
                  <ModiffFieldShell label={`Duration ${form.audioDuration}s`}>
                    <StudioSlider
                      value={form.audioDuration}
                      min={1}
                      max={240}
                      step={0.5}
                      onChange={(value) => updateAndSync({ audioDuration: value })}
                    />
                  </ModiffFieldShell>
                  {expertResourceMode ? (
                    <ModiffFieldShell label={`Shift ${form.shift}`}>
                      <StudioSlider
                        value={form.shift}
                        min={0}
                        max={10}
                        step={0.1}
                        onChange={(value) => updateAndSync({ shift: value })}
                      />
                    </ModiffFieldShell>
                  ) : null}
                </div>
                {form.mode === 'audio_continuation' && (
                  <ModiffFieldShell label={`Continuation length ${form.extensionDuration}s`}>
                    <StudioSlider
                      value={form.extensionDuration}
                      min={1}
                      max={180}
                      step={0.5}
                      onChange={(value) => updateAndSync({ extensionDuration: value })}
                    />
                  </ModiffFieldShell>
                )}
                {form.mode === 'audio_repaint' && (
                  <div className="grid grid-cols-2 gap-2">
                    <ModiffFieldShell label={`Repaint start ${form.repaintingStart}s`}>
                      <StudioSlider
                        value={form.repaintingStart}
                        min={0}
                        max={240}
                        step={0.1}
                        onChange={(value) => updateAndSync({ repaintingStart: value })}
                      />
                    </ModiffFieldShell>
                    <ModiffFieldShell label={`Repaint end ${form.repaintingEnd}s`}>
                      <StudioSlider
                        value={form.repaintingEnd}
                        min={0}
                        max={240}
                        step={0.1}
                        onChange={(value) => updateAndSync({ repaintingEnd: value })}
                      />
                    </ModiffFieldShell>
                  </div>
                )}
                {form.mode === 'audio_variation' && (
                  <ModiffFieldShell label={`Cover strength ${form.audioCoverStrength}`}>
                    <StudioSlider
                      value={form.audioCoverStrength}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(value) => updateAndSync({ audioCoverStrength: value })}
                    />
                  </ModiffFieldShell>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <StudioTextInput
                    value={form.vocalLanguage}
                    onChange={(event) => updateAndSync({ vocalLanguage: event.target.value })}
                    aria-label="Audio language"
                  />
                  <StudioTextInput
                    value={form.keyscale}
                    onChange={(event) => updateAndSync({ keyscale: event.target.value })}
                    aria-label="Audio key"
                  />
                  <StudioTextInput
                    value={form.timesignature}
                    onChange={(event) => updateAndSync({ timesignature: event.target.value })}
                    aria-label="Audio time signature"
                  />
                </div>
              </div>
            </StudioSection>
          )}

          {expertResourceMode && (
            <StudioSection id="runtime" title="Runtime">
              <section className="grid gap-2" data-testid="studio-expert-runtime-controls">
                <SectionHeader title="Expert runtime" />
                <div className="flex gap-2">
                  <StudioSelect
                    aria-label="Data type"
                    value={form.dtype}
                    onValueChange={(value) => updateAndSync({ dtype: value as StudioFormState['dtype'] })}
                    options={[
                      { value: 'bfloat16', label: 'bfloat16' },
                      { value: 'float16', label: 'float16' },
                      { value: 'float32', label: 'float32' },
                    ]}
                    className="flex-1"
                  />
                  <StudioTextInput
                    aria-label="Device"
                    value={form.device}
                    onChange={(event) => updateAndSync({ device: event.target.value })}
                    className="w-24"
                  />
                </div>
                <StudioCheckbox
                  checked={form.autoOffload}
                  onChange={(checked) => updateAndSync({ autoOffload: checked })}
                  label="Auto-offload model components"
                />
                <div className={cx('grid gap-2', expertQuantizationModes.length ? 'grid-cols-2' : 'grid-cols-1')}>
                  {expertQuantizationModes.length > 0 && (
                    <StudioSelect
                      aria-label="Quantization"
                      data-testid="studio-quantization-select"
                      value={form.quantizationMode}
                      onValueChange={(value) => {
                        const quantizationMode = value as StudioFormState['quantizationMode'];
                        updateAndSync({ quantizationMode });
                      }}
                      options={[
                        { value: 'none', label: 'No quantization' },
                        ...expertQuantizationModes.map((value) => ({
                          value,
                          label:
                            value === 'bnb_4bit'
                              ? '4-bit BnB'
                              : value === 'bnb_8bit'
                                ? '8-bit BnB'
                                : value === 'quanto_float8'
                                  ? 'Quanto float8'
                                  : 'TorchAO float8',
                        })),
                      ]}
                    />
                  )}
                  <StudioSelect
                    aria-label="Offload mode"
                    data-testid="studio-offload-mode-select"
                    value={form.offloadMode}
                    onValueChange={(value) => updateAndSync({ offloadMode: value as StudioFormState['offloadMode'] })}
                    options={capability.offloadSupport.modes.map((mode) => ({
                      value: mode,
                      label: STUDIO_OFFLOAD_LABELS[mode],
                    }))}
                  />
                </div>
              </section>
            </StudioSection>
          )}

          {(showImageTray || form.mode === 'image_to_video' || form.mode === 'reference_to_video') && (
            <StudioSection id="reference-inputs" title="Reference inputs" defaultOpen>
              <StudioImageReferenceTray />
            </StudioSection>
          )}

          {(form.mode === 'inpaint' || form.mode === 'control_image') && (
            <StudioSection
              id="mask-control"
              title={form.mode === 'inpaint' ? 'Mask draft' : 'Control image'}
              defaultOpen
            >
              <StudioInput
                label={form.mode === 'inpaint' ? 'Mask image path' : 'Control image path'}
                value={form.mode === 'inpaint' ? form.maskImage : form.controlImage}
                onChange={(value) =>
                  updateAndSync(form.mode === 'inpaint' ? { maskImage: value } : { controlImage: value })
                }
              />
              <p
                className={cx(
                  'text-xs',
                  form.mode === 'control_image' || supportsMask ? 'text-modiff-subtle-text' : 'text-hf-orange',
                )}
              >
                {form.mode === 'control_image'
                  ? 'Control image is wired to Qwen Image plus Qwen ControlNet Union. Install both models and add one control image before running.'
                  : supportsMask
                    ? 'Mask execution is supported by this model metadata.'
                    : (inpaintContract?.reason ??
                      'Brush, erase, invert, feather, clear, and fill are frontend draft controls until backend/template support is confirmed.')}
              </p>
              {form.mode === 'inpaint' && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <StudioButton tone="ghost" onClick={() => setMaskEditorOpen(true)}>
                      Open mask editor
                    </StudioButton>
                    {form.maskImage && (
                      <StudioButton tone="ghost" onClick={() => updateAndSync({ maskImage: '' })}>
                        Clear saved mask
                      </StudioButton>
                    )}
                  </div>
                  {maskEditorOpen && (
                    <StudioMaskEditor
                      sourceImage={form.referenceImages[0]}
                      maskImage={form.maskImage}
                      onSave={(maskImage) => {
                        updateAndSync({ maskImage });
                        setMaskEditorOpen(false);
                      }}
                      onCancel={() => setMaskEditorOpen(false)}
                    />
                  )}
                </>
              )}
            </StudioSection>
          )}

          {expertResourceMode ? (
            <p className="border-t border-modiff-border pt-3 text-xs text-modiff-subtle-text">
              {graphBinding
                ? 'Studio is linked to graph nodes. Expert graph edits remain visible on the canvas.'
                : 'Custom graph mode: add nodes, connect an output, or start from a template.'}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

type GraphInputCandidate = AppModeInput & {
  node: CustomNodeType;
  param: NodeParams;
};

const INSPECTOR_PREVIEW_DISPLAYS = new Set(['ui_image', 'ui_video', 'ui_audio', 'ui_text', 'ui_imagecompare']);
const inspectorDisclosureMemory = new Map<string, boolean>();

function isInspectorEditableParam(key: string, param: NodeParams) {
  const display = param.isInput ? 'input' : param.display || '';
  return (
    display !== 'input' &&
    display !== 'output' &&
    !INSPECTOR_PREVIEW_DISPLAYS.has(display) &&
    !param.hidden &&
    !param.isInput &&
    !['output', 'images', 'latents'].includes(key)
  );
}

function graphParamInputCandidates(nodes: CustomNodeType[]): GraphInputCandidate[] {
  return nodes.flatMap((node) =>
    Object.entries(node.data.params ?? {})
      .filter(([key, param]) => isInspectorEditableParam(key, param))
      .map(([key, param]) => ({
        id: `graph:${node.id}:${key}`,
        kind: 'graph-param' as const,
        label: `${node.data.label || node.id} / ${param.label || key}`,
        nodeId: node.id,
        paramKey: key,
        node,
        param,
      })),
  );
}

function GraphNodeInputs({
  candidates,
  nodes,
  onTogglePin,
  pinnedIds,
  pinnedInputs,
  selectedNodes,
  workflowId,
}: {
  candidates: GraphInputCandidate[];
  nodes: CustomNodeType[];
  onTogglePin: (id: string) => void;
  pinnedIds: string[];
  pinnedInputs: GraphInputCandidate[];
  selectedNodes: CustomNodeType[];
  workflowId: string | null;
}) {
  const [disclosureState, setDisclosureState] = useState<Record<string, boolean>>({});
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const groups = useMemo(() => {
    const byNode = new Map<string, { node: CustomNodeType; params: Record<string, NodeParams> }>();
    pinnedInputs.forEach((input) => {
      if (!input.nodeId || !input.paramKey) return;
      const group = byNode.get(input.nodeId) ?? { node: input.node, params: {} };
      group.params[input.paramKey] = input.param;
      byNode.set(input.nodeId, group);
    });

    if (selectedNode) {
      const selectedParams = Object.fromEntries(
        Object.entries(selectedNode.data.params ?? {}).filter(([key, param]) => isInspectorEditableParam(key, param)),
      );
      byNode.set(selectedNode.id, { node: selectedNode, params: selectedParams });
    }

    const orderedNodeIds = [
      ...(selectedNode ? [selectedNode.id] : []),
      ...nodes.map((node) => node.id).filter((id) => id !== selectedNode?.id),
    ];
    return orderedNodeIds.flatMap((id) => {
      const group = byNode.get(id);
      return group ? [group] : [];
    });
  }, [nodes, pinnedInputs, selectedNode]);

  const updateParam = useCallback((nodeId: string, param: string, value: unknown, key?: keyof NodeParams) => {
    useFlowStore.getState().setParamWithHistory(nodeId, param, value, key);
    syncManagedNodeControlChange(nodeId, param, value, key);
  }, []);

  return (
    <div
      className="grid gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-2"
      data-testid={selectedNodes.length > 0 ? 'studio-custom-graph-inspector' : 'studio-pinned-graph-inputs'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-modiff-text">Node controls</span>
      </div>
      {selectedNodes.length > 1 ? <StatusLine>One node at a time</StatusLine> : null}
      {groups.length > 0 ? (
        groups.map(({ node, params }, index) => {
          const selected = selectedNode?.id === node.id;
          const disclosureKey = `${workflowId ?? 'unscoped'}:${node.id}`;
          const rememberedOpen = disclosureState[disclosureKey] ?? inspectorDisclosureMemory.get(disclosureKey);
          const defaultOpen = selected || (rememberedOpen ?? index === 0);
          const label = node.data.label || `${node.data.module}.${node.data.action}`;
          const fieldCount = Object.keys(params).length;

          return (
            <ModiffDisclosure
              key={`${disclosureKey}:${selected ? 'selected' : 'idle'}`}
              aria-label={`Node controls: ${label}`}
              className={cx(
                'overflow-hidden rounded-modiff-compact border bg-modiff-bg',
                selected ? 'border-hf-yellow/60' : 'border-modiff-border',
              )}
              data-testid={`studio-node-disclosure-${node.id}`}
              defaultOpen={defaultOpen}
              label={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={label}>
                    {label}
                  </span>
                  <span className="text-xs font-normal text-modiff-subtle-text">{fieldCount}</span>
                </span>
              }
              onOpenChange={(open) => {
                inspectorDisclosureMemory.set(disclosureKey, open);
                setDisclosureState((current) =>
                  current[disclosureKey] === open ? current : { ...current, [disclosureKey]: open },
                );
              }}
              panelClassName="border-t border-modiff-border-subtle p-3"
            >
              {fieldCount > 0 ? (
                <div className="grid gap-3 [&>[data-key]]:m-0">
                  <NodeContent
                    nodeId={node.id}
                    params={params}
                    updateStore={(param, value, key) => updateParam(node.id, param, value, key)}
                    module={node.data.module}
                    action={node.data.action}
                    mode="controls"
                    hidePreviews
                    executionStatus={node.data.executionStatus}
                    progressMessage={node.data.progressMessage}
                    uiStateMessage={node.data.uiState?.validationMessage ?? node.data.uiState?.errorMessage}
                  />
                </div>
              ) : (
                <StatusLine tone="secondary">No editable params</StatusLine>
              )}
            </ModiffDisclosure>
          );
        })
      ) : (
        <StatusLine tone="secondary">No pinned inputs</StatusLine>
      )}
      {candidates.length > 0 ? (
        <ModiffDisclosure
          className="border-t border-modiff-border pt-2"
          label="Pin inputs"
          buttonClassName="min-h-0 justify-start p-0 text-xs text-modiff-subtle-text hover:bg-transparent"
          panelClassName="mt-2 grid gap-1"
        >
          {candidates.map((input) => {
            const pinned = pinnedSet.has(input.id);
            return (
              <StudioButton
                key={input.id}
                tone="ghost"
                align="left"
                fullWidth
                className="min-h-8 px-2 text-xs"
                onClick={() => onTogglePin(input.id)}
                icon={
                  pinned ? (
                    <PinOff size={14} className="text-hf-yellow" />
                  ) : (
                    <Pin size={14} className="text-modiff-subtle-text" />
                  )
                }
              >
                <span className="min-w-0 flex-1 truncate">{input.label}</span>
              </StudioButton>
            );
          })}
        </ModiffDisclosure>
      ) : null}
    </div>
  );
}

function ReadinessPill({
  children,
  disabled,
  onClick,
  progress,
  testId,
  title,
  tone = 'default',
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  progress?: number | null;
  testId?: string;
  title?: string;
  tone?: 'default' | 'success' | 'warning' | 'error';
}) {
  const label = typeof children === 'string' ? children : undefined;
  return (
    <StatusActionChip
      action={
        label === 'Installing'
          ? 'installing'
          : onClick
            ? 'install'
            : tone === 'success'
              ? 'ready'
              : tone === 'warning' || tone === 'error'
                ? 'missing'
                : 'details'
      }
      className="min-h-7 px-2 py-0.5 text-xs"
      disabled={disabled}
      label={children}
      onClick={onClick}
      progress={progress}
      testId={testId}
      title={title}
      tone={tone === 'default' ? 'neutral' : tone}
    />
  );
}
