import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { enqueueSnackbar } from '../ui/snackbar';
import { useShallow } from 'zustand/react/shallow';
import { ClipboardCopy, GalleryVerticalEnd, Info, Pin, PinOff, Save, Trash2, WandSparkles } from 'lucide-react';

import { latestOutputForWorkflow, scopedOutputsForWorkflow, useStudioStore } from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { useNodesStore, type NodeParams } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import {
  createOrUpdateStudioGraph,
  ensureStudioGraphReadyForRun,
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
  STUDIO_RESOURCE_DESCRIPTIONS,
  STUDIO_RESOURCE_LABELS,
  STUDIO_RESOURCE_MODES,
} from '../studio/resourcePlanner';
import { STUDIO_PRESETS, STUDIO_TEMPLATES } from '../studio/templates';
import {
  autoPlanIsReady,
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
import { diffStudioFormValues, formatStudioFieldValue, publishStudioChange } from '../studio/presetDiff';
import {
  ActionStatusRow,
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

const MODE_OPTIONS = Object.keys(STUDIO_MODE_LABELS).filter((mode) => mode !== 'advanced_workflow') as StudioMode[];
const AUTO_PIN_KEYWORDS = [
  'prompt',
  'negative',
  'model',
  'repo',
  'seed',
  'step',
  'width',
  'height',
  'guidance',
  'cfg',
  'strength',
  'source',
  'reference',
  'control',
  'mask',
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
    hfDownloadProgress,
    installHfModel,
    fetchRuntimeStatus,
  } = useNodesStore(
    useShallow((state) => ({
      hfCache: state.hfCache,
      localModels: state.localModels,
      modelCacheDiagnostics: state.modelCacheDiagnostics,
      runtimeStatus: state.runtimeStatus,
      nodesRegistry: state.nodesRegistry,
      hfDownloadProgress: state.hfDownloadProgress,
      installHfModel: state.installHfModel,
      fetchRuntimeStatus: state.fetchRuntimeStatus,
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
    applyPreset,
    addPromptHistory,
    setPinnedGraphInputIds,
    togglePinnedGraphInput,
    setAutoResourcePlan,
    saveCurrentPromptAsSnippet,
    removeSnippet,
    applySnippet,
    applyNegativePreset,
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
      applyPreset: state.applyPreset,
      addPromptHistory: state.addPromptHistory,
      setPinnedGraphInputIds: state.setPinnedGraphInputIds,
      togglePinnedGraphInput: state.togglePinnedGraphInput,
      setAutoResourcePlan: state.setAutoResourcePlan,
      saveCurrentPromptAsSnippet: state.saveCurrentPromptAsSnippet,
      removeSnippet: state.removeSnippet,
      applySnippet: state.applySnippet,
      applyNegativePreset: state.applyNegativePreset,
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
  const resourcePlan = useMemo(() => resolveStudioResourcePlan(form, { runtimeStatus }), [form, runtimeStatus]);
  const resourcePathLabel = getStudioResourceExecutionPathLabel(resourcePlan);
  const expertResourceMode = studioViewMode === 'expert';
  const selectedAutoPlanCandidate = selectedAutoCandidate(autoResourcePlan);
  const autoResourceChecking = autoPlanChecking || autoResourceCheck.status !== 'idle';
  const autoPlanReady = form.resourceMode !== 'auto' || autoPlanIsReady(autoResourcePlan);
  const autoPlanStatusLabel =
    form.resourceMode === 'auto'
      ? (autoResourceCheck.message ?? autoResourcePlan?.statusLabel ?? 'Checking hardware')
      : 'Expert controls active';
  const selectedModelName = getStudioModelDisplayName(STUDIO_MODEL_PROFILES[form.modelType]);
  const selectedModelRuntimeLabel = getStudioModelRuntimeLabel(STUDIO_MODEL_PROFILES[form.modelType], form);
  const selectedModelArtifactNote = getStudioModelArtifactNote(STUDIO_MODEL_PROFILES[form.modelType]);
  const selectedModelInfo = `${selectedModelRuntimeLabel}. ${selectedModelName} defaults to ${STUDIO_MODEL_PROFILES[form.modelType].recommendedSteps} steps, ${STUDIO_MODEL_PROFILES[form.modelType].guidanceLabel.toLowerCase()} ${STUDIO_MODEL_PROFILES[form.modelType].recommendedGuidance}, ${STUDIO_MODEL_PROFILES[form.modelType].defaultDtype}. ${selectedModelArtifactNote}`;
  const selectedAutoPlanSummary = selectedAutoPlanCandidate
    ? `${selectedAutoPlanCandidate.resolvedArtifact ?? selectedAutoPlanCandidate.artifact ?? selectedAutoPlanCandidate.modelRepo} | ${selectedAutoPlanCandidate.qualityTier ?? 'quality plan'} | ${selectedAutoPlanCandidate.generation?.width ?? form.width}x${selectedAutoPlanCandidate.generation?.height ?? form.height} | ${selectedAutoPlanCandidate.generation?.steps ?? form.steps} steps | ${selectedAutoPlanCandidate.offloadMode ?? form.offloadMode}`
    : null;
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const graphFinalization = useStudioStore((state) => state.graphFinalization);
  const graphBindingFingerprint = graphBinding?.fingerprint;
  const autoPlanCheckedAt = autoResourcePlan?.checkedAt;
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
  const graphDivergence = graphBinding ? inspectStudioGraphBindingDivergence(graphBinding) : null;
  const graphDivergenceKey = graphDivergence
    ? `${graphDivergence.kind}:${graphDivergence.details ?? graphDivergence.message}`
    : '';
  const customGraphMode = (!graphBinding && graphInspection.nodeCount > 0) || Boolean(graphDivergence);
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
  const selectedGraphNodes = useMemo(() => graphNodes.filter((node) => node.selected), [graphNodes]);
  const selectedGraphNode = selectedGraphNodes.length === 1 ? selectedGraphNodes[0] : null;
  const selectedGraphNodeId = selectedGraphNode?.id ?? null;
  const selectedGraphNodeLabel = selectedGraphNode
    ? selectedGraphNode.data.label || `${selectedGraphNode.data.module}.${selectedGraphNode.data.action}`
    : '';
  const selectedGraphNodeEditableCount = selectedGraphNode
    ? Object.values(selectedGraphNode.data.params).filter((param) => {
        const display = param.isInput ? 'input' : param.display || '';
        return display !== 'input' && display !== 'output' && !param.hidden;
      }).length
    : 0;
  const graphInputCandidates = useMemo(() => graphParamInputCandidates(graphNodes), [graphNodes]);
  const autoPinnedGraphInputIds = useMemo(() => autoPinnedInputIds(graphInputCandidates), [graphInputCandidates]);
  const effectivePinnedGraphInputIds =
    pinnedGraphInputIds.length > 0
      ? pinnedGraphInputIds.filter((id) => graphInputCandidates.some((input) => input.id === id))
      : autoPinnedGraphInputIds;
  const pinnedGraphInputs = useMemo(() => {
    const ids = new Set(effectivePinnedGraphInputIds);
    return graphInputCandidates.filter((input) => ids.has(input.id));
  }, [effectivePinnedGraphInputIds, graphInputCandidates]);
  useEffect(() => {
    if (pinnedGraphInputIds.length > 0 || autoPinnedGraphInputIds.length === 0 || graphNodes.length === 0) return;
    setPinnedGraphInputIds(autoPinnedGraphInputIds);
  }, [autoPinnedGraphInputIds, graphNodes.length, pinnedGraphInputIds.length, setPinnedGraphInputIds]);
  const updateSelectedGraphNodeParam = useCallback(
    (param: string, value: unknown, key?: keyof NodeParams) => {
      if (!selectedGraphNodeId) return;
      useFlowStore.getState().setParam(selectedGraphNodeId, param, value, key);
    },
    [selectedGraphNodeId],
  );
  const { capability, compatibleModels, showImageTray, supportsMask, inpaintContract, missingInstallTarget } =
    useStudioReadiness({
      form,
      hfCache,
      localModels,
      modelCacheDiagnostics,
      runtimeStatus,
      nodesRegistry,
      hfDownloadProgress,
      isConnected,
      autoResourcePlan,
    });
  const runBlockedReason = runReadiness.blockingIssues[0]?.message ?? '';
  const runControlsBlocked = !runReadiness.canRun;
  const showPinnedInputs = selectedGraphNodes.length === 0 && graphNodes.length > 0;
  const showFullStudioForm = !customGraphMode && graphNodes.length === 0;
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
  ]);

  useEffect(() => {
    if (!graphBinding || !graphDivergence || graphFinalization?.status === 'pending') return;
    useStudioStore.getState().clearGraphBinding();
  }, [graphBinding, graphDivergenceKey, graphDivergence, graphFinalization?.status]);

  useEffect(() => {
    if (isConnected) {
      void fetchRuntimeStatus();
    }
  }, [fetchRuntimeStatus, isConnected]);

  useEffect(() => {
    let cancelled = false;
    if (form.resourceMode !== 'auto') {
      setAutoResourcePlan(null);
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(() => {
      void fetchAutoResourcePlan(form)
        .then((plan) => {
          if (!cancelled) setAutoResourcePlan(plan);
        })
        .catch((error) => {
          if (!cancelled) {
            setAutoResourcePlan({
              error: true,
              status: 'needs_setup',
              statusLabel: 'Needs setup',
              message: String(error),
            });
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form, setAutoResourcePlan]);

  useEffect(() => {
    if (form.resourceMode !== 'auto' || !graphBindingFingerprint || !autoPlanIsReady(autoResourcePlan)) return;
    const candidate = selectedAutoCandidate(autoResourcePlan);
    const currentForm = useStudioStore.getState().form;
    const patch = formPatchForAutoCandidate(candidate, currentForm);
    const changed = Object.entries(patch).some(([key, value]) => currentForm[key as keyof StudioFormState] !== value);
    if (changed) {
      useStudioStore.getState().updateForm(patch);
      useStudioStore.getState().setAutoResourcePlan(autoResourcePlan);
    }
    const nextForm = useStudioStore.getState().form;
    syncStudioGraphValues(nextForm);
    void createOrUpdateStudioGraph(nextForm).catch((error) => {
      useStudioStore.getState().setLastError(String(error));
    });
  }, [autoPlanCheckedAt, form.resourceMode, graphBindingFingerprint, autoResourcePlan]);

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
    setAutoPlanChecking(true);
    try {
      const currentPlan = autoPlanIsReady(useStudioStore.getState().autoResourcePlan)
        ? useStudioStore.getState().autoResourcePlan
        : await fetchAutoResourcePlan(useStudioStore.getState().form);
      useStudioStore.getState().setAutoResourcePlan(currentPlan);

      if (!currentPlan || !autoPlanIsReady(currentPlan)) {
        const message =
          currentPlan?.blockingReason || currentPlan?.message || 'Auto could not choose a runnable local plan yet.';
        useStudioStore.getState().setLastError(message);
        enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
        return null;
      }

      const candidate = selectedAutoCandidate(currentPlan);
      const patch = formPatchForAutoCandidate(candidate, useStudioStore.getState().form);
      if (Object.keys(patch).length > 0) {
        useStudioStore.getState().updateForm(patch);
        useStudioStore.getState().setAutoResourcePlan(currentPlan);
        const nextForm = useStudioStore.getState().form;
        syncStudioGraphValues(nextForm);
        await createOrUpdateStudioGraph(nextForm);
      }
      enqueueSnackbar('Auto plan refreshed.', { variant: 'success', autoHideDuration: 2200 });
      return currentPlan;
    } catch (error) {
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
      const profile = STUDIO_MODEL_PROFILES[before.modelType];
      const appliedPreset =
        preset.id === 'low_vram'
          ? {
              ...preset,
              values: {
                ...preset.values,
                resourceMode: 'auto' as const,
                ...(profile.family === 'Qwen Image'
                  ? {
                      width: profile.lowVram.width ?? profile.defaultSize.width,
                      height: profile.lowVram.height ?? profile.defaultSize.height,
                    }
                  : {}),
                quantizationMode: 'none' as StudioFormState['quantizationMode'],
                offloadMode: (profile.lowVram.offloadMode ??
                  profile.offloadSupport.lowVram) as StudioFormState['offloadMode'],
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
      const autoReady = await ensureStudioAutoPlanReadyForRun();
      if (!autoReady) return;
      await coordinateGraphRun({
        sid,
        studioContext: { forceDeterministic: !latest.formSnapshot.randomSeed },
      });
    } catch (error) {
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
      const variationGroupId = `sweep-${Date.now()}`;
      setIsWorking(true);
      useStudioStore.getState().addPromptHistory(baseForm.prompt);

      try {
        for (const variation of variations) {
          const nextValues = { ...variation.values, randomSeed: false };
          const nextForm = { ...useStudioStore.getState().form, ...nextValues };
          useStudioStore.getState().updateForm(nextValues);
          syncStudioGraphValues(nextForm);
          await ensureStudioGraphReadyForRun(nextForm);
          const autoReady = await ensureStudioAutoPlanReadyForRun();
          if (!autoReady) break;
          const { response } = await coordinateGraphRun({
            sid,
            studioContext: {
              forceDeterministic: true,
              variation: {
                variationGroupId,
                variationLabel: variation.label,
              },
            },
          });
          if (response.error) {
            useStudioStore.getState().setLastError(response.message || 'MoDiff could not queue this sweep variation.');
            break;
          }
        }
        enqueueSnackbar('Variation sweep queued', { variant: 'success', autoHideDuration: 2200 });
      } catch (error) {
        const message = String(error);
        useStudioStore.getState().setLastError(message);
        enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
      } finally {
        useStudioStore.getState().updateForm(baseForm);
        syncStudioGraphValues(baseForm);
        await createOrUpdateStudioGraph(baseForm).catch(() => undefined);
        setIsWorking(false);
      }
    },
    [isConnected, runBlockedReason, sid],
  );

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="studio-panel">
      <div className="sticky top-0 z-20 -mx-3 -mt-3 grid gap-2 border-b border-modiff-border bg-modiff-bg/95 p-3 shadow-modiff-node">
        {showStudioResourceHeader &&
          !customGraphMode &&
          (expertResourceMode ? (
            <div className="grid gap-1.5 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="studio-header-resource-mode"
                  className="text-xs font-semibold uppercase text-modiff-muted"
                >
                  Resource mode
                </label>
                <span
                  data-testid="studio-resource-path-badge"
                  className="shrink-0 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 py-1 text-xs font-semibold text-modiff-muted"
                >
                  {resourcePathLabel}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StudioSelect
                  id="studio-header-resource-mode"
                  aria-label="Resource mode"
                  className="flex-1"
                  data-testid="studio-header-resource-mode-select"
                  value={form.resourceMode}
                  onChange={(event) => {
                    void handleResourceModeChange(event.target.value as StudioResourceMode);
                  }}
                >
                  {STUDIO_RESOURCE_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {STUDIO_RESOURCE_LABELS[mode]}
                    </option>
                  ))}
                </StudioSelect>
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
                    <span className={autoPlanReady ? 'text-modiff-green' : 'text-modiff-muted'}>
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
                        <ReadinessPill tone="success" title={selectedAutoPlanSummary ?? undefined}>
                          Auto plan
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
            </div>
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
        {graphFinalization && graphFinalization.status !== 'complete' && graphFinalization.status !== 'idle' && (
          <StatusBox
            severity={
              graphFinalization.status === 'error'
                ? 'error'
                : graphFinalization.status === 'warning'
                  ? 'warning'
                  : 'info'
            }
            testId="studio-graph-finalization"
          >
            <p className="text-xs font-semibold text-modiff-text">
              {graphFinalization.status === 'pending'
                ? 'Finalizing graph...'
                : graphFinalization.status === 'warning'
                  ? 'Graph still finalizing'
                  : 'Graph finalization failed'}
            </p>
            <p className="mt-1 text-xs text-modiff-muted">
              {graphFinalization.message || 'Preparing dynamic fields and managed links in the background.'}
            </p>
          </StatusBox>
        )}
        {lastError && (
          <StatusBox severity="error">
            <div className="flex items-start gap-2">
              <details className="min-w-0 flex-1">
                <summary className="cursor-pointer list-none text-xs font-semibold text-modiff-red">Last error</summary>
                <p className="mt-1 max-h-28 overflow-auto break-words text-xs text-modiff-red">{lastError}</p>
              </details>
              <StudioIconButton title="Copy error" onClick={() => copyText(lastError, 'Error')}>
                <ClipboardCopy size={15} />
              </StudioIconButton>
            </div>
          </StatusBox>
        )}
      </div>

      <StudioSection id="task" title="Task" defaultOpen>
        <div className="grid gap-2">
          <div
            className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
            data-testid="studio-task-model-summary"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-modiff-muted">
                  {customGraphMode ? 'Current graph' : 'Current task'}
                </p>
                <h2 className="truncate text-base font-bold text-modiff-text">
                  {customGraphMode ? 'Custom graph' : STUDIO_MODE_LABELS[form.mode]}
                </h2>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-xs font-semibold uppercase text-modiff-muted">
                  {customGraphMode ? 'Graph models' : 'Selected model'}
                </p>
                <div className="flex items-center justify-end gap-1">
                  <h3 className="truncate text-base font-bold text-hf-yellow">
                    {customGraphMode ? customGraphModelText : selectedModelName}
                  </h3>
                  {!customGraphMode && (
                    <StudioIconButton className="size-6" title={selectedModelInfo}>
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
                value={form.mode}
                data-testid="studio-task-select"
                onChange={(event) => {
                  void handleModeChange(event.target.value as StudioMode);
                }}
              >
                {MODE_OPTIONS.map((mode) => (
                  <option key={mode} value={mode}>
                    {STUDIO_MODE_LABELS[mode]}
                  </option>
                ))}
              </StudioSelect>
              <StudioSelect
                value={form.modelType}
                data-testid="studio-model-select"
                onChange={(event) => {
                  handleModelTypeChange(event.target.value as StudioModelType);
                }}
              >
                {compatibleModels.map((modelType) => (
                  <option key={modelType} value={modelType}>
                    {STUDIO_MODEL_LABELS[modelType]}
                  </option>
                ))}
              </StudioSelect>
            </>
          )}
          <ActionStatusRow
            tone={runReadinessSummary.tone}
            title={
              studioReadinessMeta ? `${runReadinessSummary.title} - ${studioReadinessMeta}` : runReadinessSummary.title
            }
            meta={runReadiness.primaryIssue?.message}
            testId="studio-run-readiness"
            onClick={runReadiness.issues.length > 0 ? handleReviewRunIssues : undefined}
          />
          {selectedGraphNodes.length > 0 ? (
            <div
              className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
              data-testid="studio-custom-graph-inspector"
            >
              {selectedGraphNodes.length > 1 ? (
                <StatusLine>One node at a time</StatusLine>
              ) : selectedGraphNode ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase text-modiff-muted">Selected node</span>
                    <span
                      className="min-w-0 truncate text-sm font-semibold text-modiff-text"
                      title={selectedGraphNodeLabel}
                    >
                      {selectedGraphNodeLabel}
                    </span>
                  </div>
                  {selectedGraphNodeEditableCount > 0 ? (
                    <div className="grid gap-1">
                      <NodeContent
                        nodeId={selectedGraphNode.id}
                        params={selectedGraphNode.data.params}
                        updateStore={updateSelectedGraphNodeParam}
                        module={selectedGraphNode.data.module}
                        action={selectedGraphNode.data.action}
                        hideHandles
                        executionStatus={selectedGraphNode.data.executionStatus}
                        progressMessage={selectedGraphNode.data.progressMessage}
                        uiStateMessage={
                          selectedGraphNode.data.uiState?.validationMessage ??
                          selectedGraphNode.data.uiState?.errorMessage
                        }
                      />
                    </div>
                  ) : (
                    <StatusLine>No editable params</StatusLine>
                  )}
                </div>
              ) : null}
            </div>
          ) : showPinnedInputs ? (
            <PinnedGraphInputs
              candidates={graphInputCandidates}
              pinnedInputs={pinnedGraphInputs}
              pinnedIds={effectivePinnedGraphInputIds}
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
      </StudioSection>

      {showFullStudioForm && (
        <>
          <div className="relative grid gap-3">
            <StudioSection
              id="prompt"
              title="Prompt"
              defaultOpen
              className="sticky top-32 z-10 rounded-modiff-panel border border-modiff-border bg-modiff-bg/95 px-2 pb-2 shadow-modiff-node backdrop-blur"
            >
              <div data-testid="studio-prompt-input">
                <StudioInput
                  label="Prompt"
                  value={form.prompt}
                  multiline
                  onChange={(value) => updateAndSync({ prompt: value })}
                />
              </div>
              <div data-testid="studio-negative-prompt-input">
                <StudioInput
                  label="Negative prompt"
                  value={form.negativePrompt}
                  multiline
                  onChange={(value) => updateAndSync({ negativePrompt: value })}
                />
              </div>
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
                          className="rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-gray-300"
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

          <StudioSection id="advanced-generation" title="Advanced generation">
            <section>
              <SectionHeader title={isVideoMode ? 'Video frame' : 'Image size'} />
              <div className="flex gap-2">
                <StudioSelect
                  value={form.aspectRatio}
                  onChange={(event) => handleAspectChange(event.target.value as StudioAspectRatio)}
                  className="flex-1"
                >
                  {ASPECT_OPTIONS.map((aspect) => (
                    <option key={aspect.label} value={aspect.label}>
                      {aspect.label}
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </StudioSelect>
                <StudioTextInput
                  value={form.width}
                  data-testid="studio-width-input"
                  onChange={(event) =>
                    updateAndSync({ width: numberValue(event.target.value, form.width), aspectRatio: 'custom' })
                  }
                  className="w-[86px]"
                />
                <StudioTextInput
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
                  <p className="text-xs text-gray-400">Seam overlap: {form.outpaintOverlap}</p>
                  <StudioSlider
                    min={0}
                    max={128}
                    step={4}
                    value={form.outpaintOverlap}
                    onChange={(value) => updateAndSync({ outpaintOverlap: value })}
                  />
                  <p className="text-xs text-gray-400">Mask feather: {form.outpaintFeather}</p>
                  <StudioSlider
                    min={0}
                    max={64}
                    step={1}
                    value={form.outpaintFeather}
                    onChange={(value) => updateAndSync({ outpaintFeather: value })}
                  />
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
                <p className="text-xs text-gray-400">Steps: {form.steps}</p>
                <StudioSlider
                  min={1}
                  max={80}
                  value={form.steps}
                  onChange={(value) => updateAndSync({ steps: value })}
                />
                <p className="text-xs text-gray-400">
                  {capability.guidanceLabel}: {form.guidanceScale}
                </p>
                <StudioSlider
                  min={0}
                  max={10}
                  step={0.1}
                  value={form.guidanceScale}
                  onChange={(value) => updateAndSync({ guidanceScale: value })}
                />
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
                    <p className="text-xs text-gray-400">Conditioning: {form.conditioningScale}</p>
                    <StudioSlider
                      min={0}
                      max={2}
                      step={0.05}
                      value={form.conditioningScale}
                      onChange={(value) => updateAndSync({ conditioningScale: value })}
                    />
                    <p className="text-xs text-gray-400">Guidance 2: {form.guidanceScale2}</p>
                    <StudioSlider
                      min={0}
                      max={20}
                      step={0.1}
                      value={form.guidanceScale2}
                      onChange={(value) => updateAndSync({ guidanceScale2: value })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <StudioSelect
                        value={form.outputType}
                        onChange={(event) =>
                          updateAndSync({ outputType: event.target.value as StudioFormState['outputType'] })
                        }
                      >
                        <option value="pil">Output: PIL</option>
                        <option value="np">Output: NumPy</option>
                        <option value="pt">Output: Torch</option>
                      </StudioSelect>
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
                )}
                {capability.supportsImageInput && !isVideoMode && (
                  <>
                    <p className="text-xs text-gray-400">Strength: {form.strength}</p>
                    <StudioSlider
                      min={0}
                      max={1}
                      step={0.05}
                      value={form.strength}
                      onChange={(value) => updateAndSync({ strength: value })}
                    />
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
                  <p className="text-xs text-gray-400">Use Reference inputs below for the starting image.</p>
                )}
                {form.mode === 'reference_to_video' && (
                  <p className="text-xs text-gray-400">Use Reference inputs below for subject and style images.</p>
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
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-xs text-modiff-muted">
                    <span>Duration {form.audioDuration}s</span>
                    <StudioSlider
                      value={form.audioDuration}
                      min={1}
                      max={240}
                      step={0.5}
                      onChange={(value) => updateAndSync({ audioDuration: value })}
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-modiff-muted">
                    <span>Shift {form.shift}</span>
                    <StudioSlider
                      value={form.shift}
                      min={0}
                      max={10}
                      step={0.1}
                      onChange={(value) => updateAndSync({ shift: value })}
                    />
                  </label>
                </div>
                {form.mode === 'audio_continuation' && (
                  <label className="grid gap-1 text-xs text-modiff-muted">
                    <span>Continuation length {form.extensionDuration}s</span>
                    <StudioSlider
                      value={form.extensionDuration}
                      min={1}
                      max={180}
                      step={0.5}
                      onChange={(value) => updateAndSync({ extensionDuration: value })}
                    />
                  </label>
                )}
                {form.mode === 'audio_repaint' && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-xs text-modiff-muted">
                      <span>Repaint start {form.repaintingStart}s</span>
                      <StudioSlider
                        value={form.repaintingStart}
                        min={0}
                        max={240}
                        step={0.1}
                        onChange={(value) => updateAndSync({ repaintingStart: value })}
                      />
                    </label>
                    <label className="grid gap-1 text-xs text-modiff-muted">
                      <span>Repaint end {form.repaintingEnd}s</span>
                      <StudioSlider
                        value={form.repaintingEnd}
                        min={0}
                        max={240}
                        step={0.1}
                        onChange={(value) => updateAndSync({ repaintingEnd: value })}
                      />
                    </label>
                  </div>
                )}
                {form.mode === 'audio_variation' && (
                  <label className="grid gap-1 text-xs text-modiff-muted">
                    <span>Cover strength {form.audioCoverStrength}</span>
                    <StudioSlider
                      value={form.audioCoverStrength}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(value) => updateAndSync({ audioCoverStrength: value })}
                    />
                  </label>
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
              <section>
                <SectionHeader title="Resource mode" />
                <StudioSelect
                  data-testid="studio-resource-mode-select"
                  value={form.resourceMode}
                  onChange={(event) => {
                    void handleResourceModeChange(event.target.value as StudioResourceMode);
                  }}
                >
                  {STUDIO_RESOURCE_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {STUDIO_RESOURCE_LABELS[mode]}
                    </option>
                  ))}
                </StudioSelect>
                <StatusBox severity={autoPlanReady ? 'success' : 'info'}>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <ReadinessPill tone={autoPlanReady ? 'success' : 'default'} title={resourcePlan.summary}>
                      {resourcePathLabel}
                    </ReadinessPill>
                    <ReadinessPill title={STUDIO_RESOURCE_DESCRIPTIONS[form.resourceMode]}>
                      {STUDIO_RESOURCE_LABELS[form.resourceMode]}
                    </ReadinessPill>
                    {resourcePlan.executionPath === 'direct-qwen-image' ? (
                      <ReadinessPill title="Auto uses a compact direct Diffusers Qwen pipeline for local reliability. Switch Resource mode to Expert to build the expanded Modular Diffusers graph.">
                        Direct Qwen
                      </ReadinessPill>
                    ) : null}
                    {form.resourceMode === 'auto' && selectedAutoPlanCandidate ? (
                      <ReadinessPill
                        title={`Auto recipe: ${selectedAutoPlanSummary ?? 'selected candidate'} | ${selectedAutoPlanCandidate.pipelineClass ?? 'pipeline'} | readiness ${selectedAutoPlanCandidate.proof?.status ?? 'unknown'}.`}
                      >
                        Recipe
                      </ReadinessPill>
                    ) : null}
                  </div>
                </StatusBox>
              </section>
              <section className="grid gap-2" data-testid="studio-expert-runtime-controls">
                <SectionHeader title="Expert runtime" />
                <div className="flex gap-2">
                  <StudioSelect
                    value={form.dtype}
                    onChange={(event) => updateAndSync({ dtype: event.target.value as StudioFormState['dtype'] })}
                    className="flex-1"
                  >
                    <option value="bfloat16">bfloat16</option>
                    <option value="float16">float16</option>
                    <option value="float32">float32</option>
                  </StudioSelect>
                  <StudioTextInput
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
                <div
                  className={cx(
                    'grid gap-2',
                    capability.family === 'Qwen Image' || capability.family === 'FLUX Image'
                      ? 'grid-cols-2'
                      : 'grid-cols-1',
                  )}
                >
                  {(capability.family === 'Qwen Image' || capability.family === 'FLUX Image') && (
                    <StudioSelect
                      data-testid="studio-quantization-select"
                      value={form.quantizationMode}
                      onChange={(event) => {
                        const quantizationMode = event.target.value as StudioFormState['quantizationMode'];
                        updateAndSync({ quantizationMode });
                        void createOrUpdateStudioGraph({ ...form, quantizationMode });
                      }}
                    >
                      <option value="none">No quantization</option>
                      <option value="bnb_4bit">4-bit BnB</option>
                      {capability.family === 'FLUX Image' && (
                        <>
                          <option value="bnb_8bit">8-bit BnB</option>
                          <option value="quanto_float8">Quanto float8</option>
                          <option value="torchao_float8">TorchAO float8</option>
                        </>
                      )}
                    </StudioSelect>
                  )}
                  <StudioSelect
                    data-testid="studio-offload-mode-select"
                    value={form.offloadMode}
                    onChange={(event) =>
                      updateAndSync({ offloadMode: event.target.value as StudioFormState['offloadMode'] })
                    }
                  >
                    {capability.offloadSupport.modes.map((mode) => (
                      <option key={mode} value={mode}>
                        {STUDIO_OFFLOAD_LABELS[mode]}
                      </option>
                    ))}
                  </StudioSelect>
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
                  form.mode === 'control_image' || supportsMask ? 'text-gray-400' : 'text-hf-orange',
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
            <p className="border-t border-modiff-border pt-3 text-xs text-gray-400">
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

function graphParamInputCandidates(nodes: CustomNodeType[]): GraphInputCandidate[] {
  return nodes.flatMap((node) =>
    Object.entries(node.data.params ?? {})
      .filter(
        ([key, param]) =>
          param.display !== 'input' &&
          param.display !== 'output' &&
          !param.hidden &&
          !param.isInput &&
          !['output', 'images', 'latents'].includes(key),
      )
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

function autoPinnedInputIds(candidates: GraphInputCandidate[]) {
  return candidates
    .filter((input) => {
      const haystack = `${input.paramKey ?? ''} ${input.label}`.toLowerCase();
      return AUTO_PIN_KEYWORDS.some((keyword) => haystack.includes(keyword));
    })
    .slice(0, 12)
    .map((input) => input.id);
}

function PinnedGraphInputs({
  candidates,
  onTogglePin,
  pinnedIds,
  pinnedInputs,
}: {
  candidates: GraphInputCandidate[];
  onTogglePin: (id: string) => void;
  pinnedIds: string[];
  pinnedInputs: GraphInputCandidate[];
}) {
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const groups = useMemo(() => {
    const byNode = new Map<string, { node: CustomNodeType; params: Record<string, NodeParams> }>();
    pinnedInputs.forEach((input) => {
      if (!input.nodeId || !input.paramKey) return;
      const group = byNode.get(input.nodeId) ?? { node: input.node, params: {} };
      group.params[input.paramKey] = input.param;
      byNode.set(input.nodeId, group);
    });
    return Array.from(byNode.values());
  }, [pinnedInputs]);

  const updateParam = useCallback((nodeId: string, param: string, value: unknown, key?: keyof NodeParams) => {
    useFlowStore.getState().setParam(nodeId, param, value, key);
  }, []);

  return (
    <div
      className="grid gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
      data-testid="studio-pinned-graph-inputs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-modiff-text">Graph inputs</span>
        <span className="text-xs text-modiff-muted">{pinnedInputs.length}</span>
      </div>
      {groups.length > 0 ? (
        groups.map(({ node, params }) => (
          <div key={node.id} className="grid gap-1 border-t border-modiff-border pt-2 first:border-t-0 first:pt-0">
            <div className="truncate text-xs font-semibold text-modiff-muted" title={node.data.label || node.id}>
              {node.data.label || node.id}
            </div>
            <NodeContent
              nodeId={node.id}
              params={params}
              updateStore={(param, value, key) => updateParam(node.id, param, value, key)}
              module={node.data.module}
              action={node.data.action}
              hideHandles
              executionStatus={node.data.executionStatus}
              progressMessage={node.data.progressMessage}
              uiStateMessage={node.data.uiState?.validationMessage ?? node.data.uiState?.errorMessage}
            />
          </div>
        ))
      ) : (
        <StatusLine tone="secondary">No pinned inputs</StatusLine>
      )}
      {candidates.length > 0 ? (
        <details className="border-t border-modiff-border pt-2">
          <summary className="cursor-pointer list-none text-xs font-semibold text-modiff-muted">Pin inputs</summary>
          <div className="mt-2 grid gap-1">
            {candidates.map((input) => {
              const pinned = pinnedSet.has(input.id);
              return (
                <button
                  key={input.id}
                  type="button"
                  className="flex min-h-8 items-center gap-2 rounded-modiff-compact px-2 text-left text-xs text-modiff-text transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
                  onClick={() => onTogglePin(input.id)}
                >
                  {pinned ? (
                    <PinOff size={14} className="text-hf-yellow" />
                  ) : (
                    <Pin size={14} className="text-modiff-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{input.label}</span>
                </button>
              );
            })}
          </div>
        </details>
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
      className="min-h-6 px-2 py-0.5 text-xs"
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
