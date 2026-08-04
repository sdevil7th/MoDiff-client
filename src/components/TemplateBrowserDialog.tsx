import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Clock3,
  Film,
  Image,
  Info,
  Layers3,
  LayoutGrid,
  Music2,
  Play,
  Settings,
  Sparkles,
  WandSparkles,
  Wrench,
  XCircle,
} from 'lucide-react';
import { enqueueSnackbar } from '../ui/snackbar';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { isWorkflowOperationCancelled, useStudioStore } from '../stores/useStudioStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import {
  STUDIO_MODEL_LABELS,
  STUDIO_MODE_LABELS,
  getCatalogModelProfiles,
  getFormDefaultsForMode,
} from '../studio/modelProfiles';
import {
  autoPlanKeyForForm,
  fetchAutoResourcePlans,
  localRuntimeEstimate,
  type LocalRuntimeEstimate,
  type StudioAutoResourcePlan,
} from '../studio/autoResource';
import {
  TEMPLATE_GALLERY_MANIFEST_PATH,
  findManifestEntry,
  getTemplateCardMedia,
  getTemplateLockedSettings,
  parseTemplateGalleryManifest,
  templateManifestPath,
  type TemplateGalleryManifest,
} from '../studio/templateExactness';
import {
  TEMPLATE_BROWSER_CATEGORIES,
  filterStudioTemplates,
  templateDisplayName,
  templateMediaSlots,
  type TemplateBrowserCategoryId,
  type TemplateBrowserFilter,
  type TemplateMediaSlot,
} from '../studio/templateBrowser';
import { getTemplateReadiness, type TemplateReadinessResult } from '../studio/templateReadiness';
import { resolveTemplateInputs } from '../studio/templateInputs';
import { createWorkflowFromTemplate } from '../studio/templateWorkflow';
import { getPreset, STUDIO_TEMPLATES } from '../studio/templates';
import { acknowledgementRequiredForTemplate, usagePolicyAcknowledgementKey } from '../studio/modelUsagePolicies';
import { resolveStudioResourceForm } from '../studio/resourcePlanner';
import {
  createStartupRequestCache,
  shouldRetryStartupRequest,
  shouldRetryStaticStartupRequest,
} from '../studio/startupRequest';
import type { StudioMode, StudioModelType, StudioTemplate } from '../studio/types';
import {
  IssueCard,
  ModiffButton,
  ModiffDialog,
  ModiffFieldShell,
  ModiffIconButton,
  ModiffSearchInput,
  ModiffSelect,
  ModiffTooltip,
  type ModiffSelectOption,
} from '../ui';
import { ImageCompareFrame } from '../ui/ImageCompareFrame';
import { cx } from '../utils/classNames';
import { requestJson } from '../utils/requestJson';
import { TemplateUsageTermsDialog } from './TemplateUsageTermsDialog';

const difficultyOptions: Array<TemplateBrowserFilter['difficulty']> = [
  'all',
  'starter',
  'intermediate',
  'advanced',
  'blocked',
];

const sortOptions: Array<{ value: TemplateBrowserFilter['sort']; label: string }> = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'task', label: 'Task' },
  { value: 'model', label: 'Model' },
  { value: 'runtime', label: 'Runtime' },
];

const templateModeOptions = Array.from(new Set(STUDIO_TEMPLATES.map((template) => template.mode))).sort((left, right) =>
  STUDIO_MODE_LABELS[left].localeCompare(STUDIO_MODE_LABELS[right]),
);
const TEMPLATE_BATCH_SIZE = 12;
const STARTUP_INDEX_RETRY_MS = 1_500;

type PendingTemplateTermsAction =
  | { kind: 'create'; template: StudioTemplate }
  | { kind: 'install'; template: StudioTemplate; repoId: string; repair: boolean };

function templateAutoForm(template: StudioTemplate) {
  const lockedValues = getTemplateLockedSettings(template);
  return resolveStudioResourceForm({
    ...getFormDefaultsForMode(template.mode, template.modelType),
    ...(getPreset(template.presetId)?.values ?? {}),
    ...lockedValues,
    mode: template.mode,
    modelType: template.modelType,
    prompt: template.prompt,
    negativePrompt: template.negativePrompt ?? lockedValues.negativePrompt,
  });
}

const templateAutoPlanEntries = STUDIO_TEMPLATES.map((template) => {
  const form = templateAutoForm(template);
  return { form, planKey: autoPlanKeyForForm(form), templateId: template.id };
});

const templateManifestRequest = createStartupRequestCache<TemplateGalleryManifest>(async () => {
  return requestJson(TEMPLATE_GALLERY_MANIFEST_PATH, {
    credentials: 'omit',
    parse: parseTemplateGalleryManifest,
  });
});
const templateAutoPlansRequest = createStartupRequestCache<Record<string, StudioAutoResourcePlan>>(async () => {
  const keys = templateAutoPlanEntries.map((entry) => entry.templateId);
  const forms = templateAutoPlanEntries.map((entry) => entry.form);
  const plans = await fetchAutoResourcePlans(forms, keys);
  const next: Record<string, StudioAutoResourcePlan> = {};
  plans.forEach((plan, index) => {
    const entry = templateAutoPlanEntries[index];
    if (!entry) return;
    next[entry.templateId] = plan;
    // The application-wide Auto cache intentionally ignores sampling controls
    // when reusing compatible execution plans. The template-id entry above is
    // kept separately so runtime history still matches the exact defaults.
    next[entry.planKey] ??= plan;
  });
  return next;
});

function loadTemplateManifest(refresh = false) {
  return templateManifestRequest.load(refresh);
}

function loadTemplateAutoPlans(refresh = false) {
  return templateAutoPlansRequest.load(refresh);
}

function formatDifficulty(value: TemplateBrowserFilter['difficulty']) {
  return value === 'all' ? 'All levels' : value.charAt(0).toUpperCase() + value.slice(1);
}

function outputKinds(template: StudioTemplate) {
  return template.outputKinds?.join(', ') || template.example?.mediaType || 'image';
}

function templateExampleOutputPath(template: StudioTemplate) {
  return templateManifestPath(template.example?.outputPath);
}

function templateExampleThumbnailPath(template: StudioTemplate) {
  return templateManifestPath(template.example?.thumbnailPath ?? template.example?.outputPath);
}

function inputsList(template: StudioTemplate) {
  const requirements = template.inputRequirements;
  if (!requirements) return ['Prompt only'];
  const pinnedLora = template.workflowBlockSettings?.lora?.model.source === 'hub';
  const pinnedUpscaler = template.workflowBlockSettings?.upscaler?.model.source === 'hub';
  const parts: string[] = [];
  if (requirements.sourceImage) parts.push('source image');
  if (requirements.referenceImages)
    parts.push(`${requirements.referenceImages} reference image${requirements.referenceImages === 1 ? '' : 's'}`);
  if (requirements.controlImage) parts.push('control image');
  if (requirements.maskImage) parts.push('mask image');
  if (requirements.sourceVideo) parts.push('source video');
  if (requirements.maskVideo) parts.push('mask video');
  if (requirements.controlVideo) parts.push('control video');
  if (requirements.loraAdapter && !pinnedLora) parts.push('LoRA adapter');
  if (requirements.upscalerModel && !pinnedUpscaler) parts.push('upscaler model');
  if (requirements.sampleAssets?.length) {
    parts.push(
      ...requirements.sampleAssets.filter(
        (asset) =>
          !(pinnedLora && /lora adapter/i.test(asset)) && !(pinnedUpscaler && /upscaler|real-esrgan/i.test(asset)),
      ),
    );
  }
  const uniqueParts = parts.filter(
    (part, index) =>
      parts.findIndex((candidate) => candidate.toLocaleLowerCase() === part.toLocaleLowerCase()) === index,
  );
  return uniqueParts.length > 0 ? uniqueParts : ['Prompt only'];
}

function templateInputPresentation(template: StudioTemplate) {
  const resolution = resolveTemplateInputs(template);
  const included = resolution.templateDefaultBindings.map((binding) => ({
    included: true,
    key: binding.id,
    label: binding.label.replace(/^Reviewed\s+/i, ''),
  }));
  const missing = resolution.missingLabels.map((label) => ({
    included: false,
    key: `missing:${label}`,
    label,
  }));
  if (included.length > 0 || missing.length > 0) {
    return {
      title: missing.length === 0 ? 'Included inputs' : 'Required inputs',
      items: [...included, ...missing],
    };
  }
  return {
    title: 'Required inputs',
    items: inputsList(template).map((label) => ({
      included: false,
      key: `legacy:${label}`,
      label,
    })),
  };
}

function categoryLabel(categoryId: TemplateBrowserCategoryId) {
  return TEMPLATE_BROWSER_CATEGORIES.find((category) => category.id === categoryId)?.label ?? 'Templates';
}

function templateHasPublishedMedia(template: StudioTemplate, manifest: TemplateGalleryManifest | null) {
  if (manifest) {
    const entry = findManifestEntry(template, manifest);
    if (!entry) return false;
    return entry.mediaType !== 'video' || Boolean(entry.cardPreviewPath && entry.cardPreviewSha256);
  }
  const status = template.verificationStatus ?? template.example?.status;
  if (template.example?.mediaType === 'video' || template.outputKinds?.includes('video')) return false;
  return (
    (status === 'reviewed' || status === 'exact') &&
    Boolean(templateExampleThumbnailPath(template) || templateExampleOutputPath(template))
  );
}

function templatePublishedSourceEntry(template: StudioTemplate, manifest: TemplateGalleryManifest | null) {
  return manifest?.examples.find(
    (entry) =>
      entry.templateId === template.id &&
      ['approved_reviewed', 'approved_exact'].includes(entry.qualityReviewStatus) &&
      Boolean(entry.beforePath && entry.beforeMediaHash),
  );
}

const AUDIO_WAVEFORM_BAR_CLASSES = [
  'h-3',
  'h-7',
  'h-5',
  'h-10',
  'h-6',
  'h-12',
  'h-8',
  'h-14',
  'h-9',
  'h-5',
  'h-11',
  'h-7',
  'h-12',
  'h-8',
  'h-4',
  'h-9',
];

const SHOWCASE_TEMPLATE_PRIORITY = [
  'qwen_low_vram_product_concept',
  'qwen_poster_logo_text',
  'qwen_text_rendering',
  'qwen_product_mockup',
  'qwen_low_vram_poster_layout',
  'qwen_low_vram_text_rendering',
  'z_image_product_mockup',
  'z_image_poster',
  'z_image_cinematic_contact_sheet',
  'z_image_quick_concept',
  'wan_vace_cinematic_text_to_video',
  'low_vram',
  'high_quality',
];

function showcasePriority(templateId: string) {
  const index = SHOWCASE_TEMPLATE_PRIORITY.indexOf(templateId);
  return index === -1 ? SHOWCASE_TEMPLATE_PRIORITY.length : index;
}

export default function TemplateBrowserDialog() {
  const open = useSettingsStore((state) => state.templateBrowserOpen);
  const setOpen = useSettingsStore((state) => state.setTemplateBrowserOpen);
  const initialCategory = useSettingsStore((state) => state.templateBrowserInitialCategory);
  const clearInitialCategory = useSettingsStore((state) => state.clearTemplateBrowserInitialCategory);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const setModelManagerOpener = useSettingsStore((state) => state.setModelManagerOpener);
  const setGalleryLibraryOpen = useSettingsStore((state) => state.setGalleryLibraryOpen);
  const modelTermsAcknowledgements = useSettingsStore((state) => state.modelTermsAcknowledgements);
  const acknowledgeModelTerms = useSettingsStore((state) => state.acknowledgeModelTerms);
  const form = useStudioStore((state) => state.form);
  const activeTemplateId = useStudioStore((state) => state.activeTemplateId);
  const autoResourcePlans = useStudioStore((state) => state.autoResourcePlans);
  const setAutoResourcePlans = useStudioStore((state) => state.setAutoResourcePlans);
  const latestCompletedRunAt = useTaskStore((state) =>
    state.sessionRuns.reduce(
      (latest, run) => (run.status === 'completed' ? Math.max(latest, run.completedAtMs ?? 0) : latest),
      0,
    ),
  );
  const sid = useWebsocketStore((state) => state.sid);
  const hfCache = useNodesStore((state) => state.hfCache);
  const localModels = useNodesStore((state) => state.localModels);
  const modelCacheDiagnostics = useNodesStore((state) => state.modelCacheDiagnostics);
  const runtimeStatus = useNodesStore((state) => state.runtimeStatus);
  const nodesRegistry = useNodesStore((state) => state.nodesRegistry);
  const installHfModel = useNodesStore((state) => state.installHfModel);
  const modelIndexesRefreshing = useNodesStore((state) =>
    ['nodes', 'runtime', 'hfCache', 'localModels', 'modelCache', 'capabilities'].some((key) => {
      const status = state.discoveryRequests[key as keyof typeof state.discoveryRequests].status;
      return status === 'idle' || status === 'loading';
    }),
  );
  const [manifest, setManifest] = useState<TemplateGalleryManifest | null>(null);
  const [manifestStartupFailed, setManifestStartupFailed] = useState(false);
  const [autoPlansStartupFailed, setAutoPlansStartupFailed] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [installingRepo, setInstallingRepo] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [pendingTermsAction, setPendingTermsAction] = useState<PendingTemplateTermsAction | null>(null);
  const [visibleTemplateCount, setVisibleTemplateCount] = useState(TEMPLATE_BATCH_SIZE);
  const categoryButtonRefs = useRef(new Map<TemplateBrowserCategoryId, HTMLButtonElement>());
  const manifestStartupRetryAttempted = useRef(false);
  const autoPlanStartupRetryAttempted = useRef(false);
  const runtimePlanHistoryRefreshedAt = useRef(latestCompletedRunAt);
  const [galleryScrollElement, setGalleryScrollElement] = useState<HTMLDivElement | null>(null);
  const [loadMoreSentinelElement, setLoadMoreSentinelElement] = useState<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState<TemplateBrowserFilter>({
    category: 'recommended',
    query: '',
    modelType: 'all',
    mode: 'all',
    difficulty: 'all',
    sort: 'recommended',
  });

  useEffect(() => {
    if (!open || !initialCategory) return;
    setFilter((current) => ({ ...current, category: initialCategory }));
    setSelectedTemplateId(null);
    clearInitialCategory();
  }, [clearInitialCategory, initialCategory, open]);

  useEffect(() => {
    if (open) return;
    setSelectedTemplateId(null);
    setVisibleTemplateCount(TEMPLATE_BATCH_SIZE);
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    void loadTemplateManifest()
      .then((payload) => {
        if (!cancelled) {
          setManifest(payload);
          setManifestStartupFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setManifest(null);
          setManifestStartupFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      !shouldRetryStaticStartupRequest({
        attempted: manifestStartupRetryAttempted.current,
        failed: manifestStartupFailed && templateManifestRequest.hasRejected(),
      })
    ) {
      return;
    }

    manifestStartupRetryAttempted.current = true;
    let cancelled = false;
    const timeoutId = globalThis.setTimeout(() => {
      void loadTemplateManifest()
        .then((payload) => {
          if (!cancelled) {
            setManifest(payload);
            setManifestStartupFailed(false);
          }
        })
        .catch((error) => console.error(error));
    }, STARTUP_INDEX_RETRY_MS);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeoutId);
      manifestStartupRetryAttempted.current = false;
    };
  }, [manifestStartupFailed]);

  useEffect(() => {
    let cancelled = false;
    void loadTemplateAutoPlans()
      .then((plans) => {
        if (!cancelled) {
          setAutoResourcePlans(plans);
          setAutoPlansStartupFailed(false);
        }
      })
      .catch((error) => {
        if (!cancelled) setAutoPlansStartupFailed(true);
        console.error(error);
      });
    return () => {
      cancelled = true;
    };
  }, [setAutoResourcePlans]);

  useEffect(() => {
    if (
      !shouldRetryStartupRequest({
        attempted: autoPlanStartupRetryAttempted.current,
        backendReady: Boolean(sid),
        discoveryRefreshing: modelIndexesRefreshing,
        failed: autoPlansStartupFailed && templateAutoPlansRequest.hasRejected(),
      })
    ) {
      return;
    }

    autoPlanStartupRetryAttempted.current = true;
    let cancelled = false;
    const timeoutId = globalThis.setTimeout(() => {
      void loadTemplateAutoPlans()
        .then((plans) => {
          if (!cancelled) {
            setAutoResourcePlans(plans);
            setAutoPlansStartupFailed(false);
          }
        })
        .catch((error) => console.error(error));
    }, STARTUP_INDEX_RETRY_MS);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeoutId);
      autoPlanStartupRetryAttempted.current = false;
    };
  }, [autoPlansStartupFailed, modelIndexesRefreshing, setAutoResourcePlans, sid]);

  useEffect(() => {
    if (!latestCompletedRunAt || latestCompletedRunAt <= runtimePlanHistoryRefreshedAt.current) return;
    runtimePlanHistoryRefreshedAt.current = latestCompletedRunAt;
    let cancelled = false;
    const timeoutId = globalThis.setTimeout(() => {
      void loadTemplateAutoPlans(true)
        .then((plans) => {
          if (!cancelled) setAutoResourcePlans(plans);
        })
        .catch((error) => console.error(error));
    }, 250);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeoutId);
    };
  }, [latestCompletedRunAt, setAutoResourcePlans]);

  const readinessContext = useMemo(
    () => ({
      hfCache,
      localModels,
      modelCacheDiagnostics,
      runtimeStatus,
      nodesRegistry,
      modelIndexesRefreshing,
    }),
    [hfCache, localModels, modelCacheDiagnostics, modelIndexesRefreshing, nodesRegistry, runtimeStatus],
  );

  const effectiveFilter = useMemo(
    () => ({
      ...filter,
      includeBlocked: true,
    }),
    [filter],
  );
  const autoPlanForTemplate = useCallback(
    (template: StudioTemplate) =>
      autoResourcePlans[template.id] ?? autoResourcePlans[autoPlanKeyForForm(templateAutoForm(template))],
    [autoResourcePlans],
  );
  const runtimeEstimateForTemplate = useCallback(
    (template: StudioTemplate) => localRuntimeEstimate(autoPlanForTemplate(template)),
    [autoPlanForTemplate],
  );
  const filteredTemplates = useMemo(
    () =>
      filterStudioTemplates(
        STUDIO_TEMPLATES,
        form,
        effectiveFilter,
        (template) => runtimeEstimateForTemplate(template)?.observedSeconds ?? null,
      ),
    [effectiveFilter, form, runtimeEstimateForTemplate],
  );
  const catalogTemplates = useMemo(
    () =>
      filterStudioTemplates(
        STUDIO_TEMPLATES,
        form,
        {
          ...effectiveFilter,
          category: 'all',
          query: '',
          modelType: 'all',
          mode: 'all',
          difficulty: 'all',
        },
        (template) => runtimeEstimateForTemplate(template)?.observedSeconds ?? null,
      ),
    [effectiveFilter, form, runtimeEstimateForTemplate],
  );
  const publishedTemplateCount = useMemo(
    () => catalogTemplates.filter((template) => templateHasPublishedMedia(template, manifest)).length,
    [catalogTemplates, manifest],
  );
  const templates = useMemo(() => {
    const isUnfilteredRecommendation =
      filter.category === 'recommended' &&
      filter.query.trim().length === 0 &&
      filter.modelType === 'all' &&
      filter.mode === 'all' &&
      filter.difficulty === 'all';
    if (!isUnfilteredRecommendation) return filteredTemplates;
    const published = filteredTemplates.filter((template) => templateHasPublishedMedia(template, manifest));
    if (published.length === 0) return filteredTemplates;
    if (filter.sort !== 'recommended') return published;
    return [...published].sort((left, right) => showcasePriority(left.id) - showcasePriority(right.id));
  }, [
    filter.category,
    filter.difficulty,
    filter.mode,
    filter.modelType,
    filter.query,
    filter.sort,
    filteredTemplates,
    manifest,
  ]);
  const selectedTemplate = useMemo(
    () => STUDIO_TEMPLATES.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId],
  );
  const categoryCounts = useMemo(
    () =>
      new Map(
        TEMPLATE_BROWSER_CATEGORIES.map((category) => {
          if (category.id === 'recommended' && publishedTemplateCount > 0) {
            return [category.id, publishedTemplateCount];
          }
          return [
            category.id,
            filterStudioTemplates(STUDIO_TEMPLATES, form, {
              ...effectiveFilter,
              category: category.id,
              query: '',
              modelType: 'all',
              mode: 'all',
              difficulty: 'all',
            }).length,
          ];
        }),
      ),
    [effectiveFilter, form, publishedTemplateCount],
  );
  const visibleCategories = useMemo(
    () =>
      TEMPLATE_BROWSER_CATEGORIES.filter(
        (category) =>
          category.id === 'recommended' || category.id === 'all' || (categoryCounts.get(category.id) ?? 0) > 0,
      ),
    [categoryCounts],
  );

  useLayoutEffect(() => {
    if (!open) return;
    categoryButtonRefs.current.get(filter.category)?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [filter.category, open, visibleCategories]);

  useEffect(() => {
    setVisibleTemplateCount(TEMPLATE_BATCH_SIZE);
    if (galleryScrollElement) galleryScrollElement.scrollTop = 0;
  }, [
    filter.category,
    filter.difficulty,
    filter.mode,
    filter.modelType,
    filter.query,
    filter.sort,
    galleryScrollElement,
  ]);

  const visibleTemplates = useMemo(() => templates.slice(0, visibleTemplateCount), [templates, visibleTemplateCount]);
  const hasMoreTemplates = visibleTemplates.length < templates.length;

  useEffect(() => {
    if (!open || !hasMoreTemplates) return;
    if (!galleryScrollElement || !loadMoreSentinelElement || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setVisibleTemplateCount((current) => Math.min(current + TEMPLATE_BATCH_SIZE, templates.length));
      },
      {
        root: galleryScrollElement,
        rootMargin: '320px 0px',
        threshold: 0.01,
      },
    );
    observer.observe(loadMoreSentinelElement);
    return () => observer.disconnect();
  }, [
    galleryScrollElement,
    hasMoreTemplates,
    loadMoreSentinelElement,
    open,
    templates.length,
    visibleTemplates.length,
  ]);

  const createFromTemplate = async (template: StudioTemplate) => {
    setIsApplying(true);
    try {
      const result = await createWorkflowFromTemplate(template);
      setOpen(false);
      if (result.graphError) {
        enqueueSnackbar(`${template.label} opened, but graph creation needs attention: ${result.graphError}`, {
          variant: 'warning',
          autoHideDuration: 7000,
        });
        return;
      }
      if (result.warnings.length > 0) {
        enqueueSnackbar(
          `${templateDisplayName(template)} template created with ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}`,
          { variant: 'warning', autoHideDuration: 7000 },
        );
        return;
      }
      enqueueSnackbar(`${templateDisplayName(template)} template created`, {
        variant: 'success',
        autoHideDuration: 2600,
      });
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setIsApplying(false);
    }
  };

  const templateNeedsTermsReview = useCallback(
    (template: StudioTemplate) => {
      const key = usagePolicyAcknowledgementKey(acknowledgementRequiredForTemplate(template));
      return Boolean(key && !modelTermsAcknowledgements[key]);
    },
    [modelTermsAcknowledgements],
  );

  const requestCreateFromTemplate = (template: StudioTemplate) => {
    if (templateNeedsTermsReview(template)) {
      setPendingTermsAction({ kind: 'create', template });
      return;
    }
    void createFromTemplate(template);
  };

  const pendingTermsTemplate = pendingTermsAction?.template ?? null;
  const pendingTermsPolicies = pendingTermsTemplate ? acknowledgementRequiredForTemplate(pendingTermsTemplate) : [];

  const installRepo = async (repoId: string, repair = false) => {
    setInstallingRepo(repoId);
    try {
      await installHfModel(repoId, sid, { repair });
      setAutoResourcePlans(await loadTemplateAutoPlans(true));
    } catch (error) {
      console.error(error);
    } finally {
      setInstallingRepo(null);
    }
  };

  const requestInstallRepo = (template: StudioTemplate, repoId: string, repair = false) => {
    if (templateNeedsTermsReview(template)) {
      setPendingTermsAction({ kind: 'install', template, repoId, repair });
      return;
    }
    void installRepo(repoId, repair);
  };

  const confirmUsageTerms = () => {
    if (!pendingTermsAction) return;
    const action = pendingTermsAction;
    const key = usagePolicyAcknowledgementKey(pendingTermsPolicies);
    if (key) acknowledgeModelTerms(key);
    setPendingTermsAction(null);
    if (action.kind === 'install') {
      void installRepo(action.repoId, action.repair);
      return;
    }
    void createFromTemplate(action.template);
  };

  const openSetup = () => {
    setRightPanelOpen(true);
    setRightPanelTab('setup');
    setOpen(false);
  };

  const openModels = () => {
    setModelManagerOpener({ nodeId: null, fieldKey: null });
  };

  const openTemplateModel = (template: StudioTemplate, readiness: TemplateReadinessResult) => {
    const repo = readiness.modelInstallTargets[0]?.repoId ?? readiness.missingModelRepos[0];
    setModelManagerOpener({
      nodeId: null,
      fieldKey: null,
      focus: {
        modelType: template.modelType,
        repo,
        label: STUDIO_MODEL_LABELS[template.modelType],
        source: 'template',
      },
    });
    setOpen(false);
  };

  const openAssets = () => {
    setGalleryLibraryOpen(true);
  };

  const selectLowVramTemplate = () => {
    const fallback = STUDIO_TEMPLATES.find((template) => template.id === 'low_vram');
    if (!fallback) return;
    setFilter((current) => ({ ...current, category: 'performance', query: '' }));
    setSelectedTemplateId(fallback.id);
  };

  return (
    <>
      <ModiffDialog
        open={open}
        onClose={() => setOpen(false)}
        testId="template-browser-dialog"
        title={
          <span className="inline-flex items-center gap-2">
            <WandSparkles size={18} className="text-hf-yellow" />
            Templates
          </span>
        }
        panelClassName="!h-[80vh] !w-[82vw] !max-h-[80vh] !max-w-[82vw]"
        bodyClassName="!h-[calc(80vh-49px)] !max-h-[calc(80vh-49px)] overflow-hidden p-0"
      >
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[190px_minmax(0,1fr)] lg:grid-rows-1">
          <aside className="min-h-0 overflow-x-auto border-b border-modiff-border bg-modiff-bg p-2 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-3">
            <div className="flex min-w-max gap-1 lg:grid lg:min-w-0" role="group" aria-label="Template categories">
              {visibleCategories.map((category) => {
                const selected = filter.category === category.id;
                return (
                  <ModiffButton
                    key={category.id}
                    ref={(element) => {
                      if (element) categoryButtonRefs.current.set(category.id, element);
                      else categoryButtonRefs.current.delete(category.id);
                    }}
                    tone={selected ? 'primary' : 'ghost'}
                    size="prominent"
                    align="left"
                    aria-pressed={selected}
                    data-testid={`template-browser-category-${category.id}`}
                    onClick={() => {
                      setFilter((current) => ({ ...current, category: category.id }));
                      setSelectedTemplateId(null);
                    }}
                    className="shrink-0 !justify-between px-3 lg:w-full"
                  >
                    <span className="truncate">{category.label}</span>
                    <span
                      className={cx(
                        'min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs',
                        selected
                          ? 'bg-modiff-selected-surface text-hf-yellow'
                          : 'bg-modiff-panel text-modiff-subtle-text',
                      )}
                    >
                      {categoryCounts.get(category.id) ?? 0}
                    </span>
                  </ModiffButton>
                );
              })}
            </div>
          </aside>

          <section className="@container grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-modiff-surface">
            <div className="border-b border-modiff-border bg-modiff-panel p-3" data-testid="template-browser-header">
              <h1 className="mb-2 text-xl font-bold tracking-tight text-modiff-text">
                {filter.category === 'recommended' ? 'Recommended templates' : categoryLabel(filter.category)}
              </h1>
              <div className="flex flex-wrap items-end gap-2">
                <ModiffSearchInput
                  data-testid="template-browser-search"
                  value={filter.query}
                  onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
                  onClear={filter.query ? () => setFilter((current) => ({ ...current, query: '' })) : undefined}
                  placeholder="Search templates, models, prompts, or techniques"
                  aria-label="Search templates"
                  controlSize="prominent"
                  className="min-w-52 flex-1"
                />
                <TemplateFilterSelect
                  label="Model"
                  value={filter.modelType}
                  onValueChange={(value) =>
                    setFilter((current) => ({ ...current, modelType: value as StudioModelType | 'all' }))
                  }
                  options={[
                    { value: 'all', label: 'All models' },
                    ...getCatalogModelProfiles({ currentModelType: form.modelType, includeWorkflowOnly: true }).map(
                      (profile) => ({
                        value: profile.modelType,
                        label: profile.label,
                      }),
                    ),
                  ]}
                />
                <TemplateFilterSelect
                  label="Operation"
                  value={filter.mode ?? 'all'}
                  onValueChange={(value) => setFilter((current) => ({ ...current, mode: value as StudioMode | 'all' }))}
                  options={[
                    { value: 'all', label: 'All operations' },
                    ...templateModeOptions.map((mode) => ({ value: mode, label: STUDIO_MODE_LABELS[mode] })),
                  ]}
                />
                <TemplateFilterSelect
                  label="Level"
                  value={filter.difficulty}
                  onValueChange={(value) =>
                    setFilter((current) => ({ ...current, difficulty: value as TemplateBrowserFilter['difficulty'] }))
                  }
                  options={difficultyOptions.map((difficulty) => ({
                    value: difficulty,
                    label: formatDifficulty(difficulty),
                  }))}
                />
                <TemplateFilterSelect
                  label="Sort"
                  value={filter.sort}
                  onValueChange={(value) =>
                    setFilter((current) => ({ ...current, sort: value as TemplateBrowserFilter['sort'] }))
                  }
                  options={sortOptions}
                />
              </div>
            </div>

            <div
              className={cx(
                'grid h-full min-h-0',
                selectedTemplate && '@[1024px]:grid-cols-[minmax(0,1fr)_minmax(420px,28vw)]',
              )}
            >
              <div
                ref={setGalleryScrollElement}
                className={cx('min-h-0 overflow-y-auto p-3', selectedTemplate && 'hidden @[1024px]:block')}
                data-testid="template-browser-gallery-scroll"
              >
                <div className="grid items-stretch gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))] max-[1400px]:[grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
                  {visibleTemplates.map((template, index) => (
                    <TemplateBrowserCard
                      key={template.id}
                      active={activeTemplateId === template.id}
                      disabled={isApplying}
                      featured={filter.category === 'recommended' && index === 0 && templates.length > 2}
                      manifest={manifest}
                      readiness={getTemplateReadiness(template, {
                        ...readinessContext,
                        form: templateAutoForm(template),
                        autoResourcePlan: autoPlanForTemplate(template),
                      })}
                      selected={selectedTemplateId === template.id}
                      template={template}
                      runtimeEstimate={runtimeEstimateForTemplate(template)}
                      requiresTermsReview={templateNeedsTermsReview(template)}
                      onCreate={() => {
                        requestCreateFromTemplate(template);
                      }}
                      onView={() => setSelectedTemplateId(template.id)}
                      onReadinessAction={(readiness) => {
                        if (readiness.status === 'needs_model') {
                          openTemplateModel(template, readiness);
                        } else if (readiness.status === 'needs_input') {
                          openAssets();
                          setOpen(false);
                        } else if (readiness.status === 'needs_backend') {
                          openSetup();
                        } else if (readiness.status === 'needs_setup') {
                          openSetup();
                        }
                      }}
                    />
                  ))}
                  {templates.length === 0 && (
                    <div className="col-span-full rounded-modiff-compact border border-modiff-border bg-modiff-bg p-4 text-sm text-modiff-subtle-text">
                      No templates match the current filters.
                    </div>
                  )}
                </div>
                {hasMoreTemplates ? (
                  <div
                    ref={setLoadMoreSentinelElement}
                    aria-hidden="true"
                    className="h-px w-full"
                    data-testid="template-browser-load-sentinel"
                  />
                ) : null}
                <span className="sr-only" role="status" aria-live="polite">
                  {visibleTemplates.length} of {templates.length} templates loaded
                </span>
              </div>

              {selectedTemplate ? (
                <TemplateRecipeDetail
                  disabled={isApplying}
                  installingRepo={installingRepo}
                  manifest={manifest}
                  readiness={getTemplateReadiness(selectedTemplate, {
                    ...readinessContext,
                    form: templateAutoForm(selectedTemplate),
                    autoResourcePlan: autoPlanForTemplate(selectedTemplate),
                  })}
                  runtimeEstimate={runtimeEstimateForTemplate(selectedTemplate)}
                  requiresTermsReview={templateNeedsTermsReview(selectedTemplate)}
                  template={selectedTemplate}
                  onBack={() => setSelectedTemplateId(null)}
                  onCreate={() => {
                    requestCreateFromTemplate(selectedTemplate);
                  }}
                  onInstallRepo={(repoId, repair) => {
                    requestInstallRepo(selectedTemplate, repoId, repair);
                  }}
                  onOpenAssets={openAssets}
                  onOpenModels={openModels}
                  onOpenSetup={openSetup}
                  onUseLowVram={selectLowVramTemplate}
                />
              ) : null}
            </div>
          </section>
        </div>
      </ModiffDialog>
      <TemplateUsageTermsDialog
        open={Boolean(pendingTermsAction)}
        policies={pendingTermsPolicies}
        action={pendingTermsAction?.kind === 'install' ? 'install' : 'create'}
        onCancel={() => setPendingTermsAction(null)}
        onConfirm={confirmUsageTerms}
      />
    </>
  );
}

function TemplateFilterSelect({
  label,
  onValueChange,
  options,
  value,
}: {
  label: string;
  onValueChange: (value: string) => void;
  options: readonly ModiffSelectOption[];
  value: string;
}) {
  const id = useId();
  return (
    <ModiffFieldShell className={cx(label === 'Sort' ? 'w-36' : 'w-32', 'shrink-0')} htmlFor={id} label={label}>
      <ModiffSelect
        id={id}
        data-testid={`template-browser-${label.toLowerCase()}-filter`}
        size="normal"
        value={value}
        onValueChange={onValueChange}
        options={options}
        optionsClassName="!min-w-44"
      />
    </ModiffFieldShell>
  );
}

function TemplateBrowserCard({
  active,
  disabled,
  featured,
  manifest,
  onCreate,
  onReadinessAction,
  onView,
  readiness,
  runtimeEstimate,
  requiresTermsReview,
  selected,
  template,
}: {
  active: boolean;
  disabled: boolean;
  featured: boolean;
  manifest: TemplateGalleryManifest | null;
  onCreate: () => void;
  onReadinessAction: (readiness: TemplateReadinessResult) => void;
  onView: () => void;
  readiness: TemplateReadinessResult;
  runtimeEstimate: LocalRuntimeEstimate | null;
  requiresTermsReview: boolean;
  selected: boolean;
  template: StudioTemplate;
}) {
  const { beforePath, mediaPath: cardMediaPath, thumbnailPath } = getTemplateCardMedia(template, manifest);
  const hasUsageRestrictions = acknowledgementRequiredForTemplate(template).length > 0;

  return (
    <article
      data-testid={`template-browser-card-${template.id}`}
      data-active-template={active ? 'true' : 'false'}
      data-inspected={selected ? 'true' : 'false'}
      className={cx(
        'group relative flex h-full min-h-0 flex-col overflow-hidden rounded-modiff-panel border bg-modiff-bg shadow-modiff-node',
        selected
          ? 'border-hf-yellow ring-1 ring-hf-yellow/40'
          : active
            ? 'border-modiff-blue ring-1 ring-modiff-blue/30'
            : 'border-modiff-border',
      )}
    >
      <ModiffButton
        tone="ghost"
        disabled={disabled}
        aria-label={`View details for ${templateDisplayName(template)}`}
        aria-current={active ? 'true' : undefined}
        aria-pressed={selected}
        onClick={onView}
        onFocus={onView}
        className="absolute inset-0 z-0 !h-auto !w-full !rounded-modiff-panel !border-0 !bg-transparent !p-0"
      >
        <span className="sr-only">View template details</span>
      </ModiffButton>

      <div className="pointer-events-none relative z-10 overflow-hidden bg-modiff-panel">
        <TemplateBrowserPreview
          afterPath={cardMediaPath}
          beforePath={beforePath}
          mediaKind={template.outputKinds?.[0]}
          slots={templateMediaSlots(template)}
          thumbnailPath={thumbnailPath}
          variant={template.thumbnailVariant}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end gap-2 bg-gradient-to-b from-modiff-bg/80 to-transparent p-3">
          {hasUsageRestrictions ? (
            <ModiffTooltip<HTMLSpanElement> content="Usage restrictions — review before use">
              {(tooltipProps) => (
                <span
                  {...tooltipProps}
                  aria-label="Usage restrictions — review before use"
                  className="pointer-events-auto grid size-7 place-items-center rounded-full border border-hf-orange/70 bg-modiff-bg/85 text-hf-orange backdrop-blur"
                  data-testid={`template-usage-warning-${template.id}`}
                  role="img"
                  tabIndex={0}
                >
                  <AlertTriangle aria-hidden="true" size={14} />
                </span>
              )}
            </ModiffTooltip>
          ) : null}
          <span className="rounded-full border border-modiff-overlay-text/10 bg-modiff-bg/80 px-2 py-1 text-xs font-semibold text-modiff-text backdrop-blur">
            {outputKinds(template)}
          </span>
        </div>
        {featured ? (
          <div
            className="pointer-events-none absolute left-3 top-3 grid size-7 place-items-center rounded-full border border-hf-yellow/50 bg-modiff-bg/85 text-hf-yellow backdrop-blur"
            title="Featured template"
          >
            <Sparkles size={13} />
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <div className="mb-1 flex min-h-12 items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1">
              <ModiffButton
                tone="ghost"
                size="compact"
                align="left"
                disabled={disabled}
                data-testid={`template-browser-use-${template.id}`}
                onClick={onView}
                className="pointer-events-auto !h-auto min-w-0 max-w-full !justify-start !rounded-none !p-0 text-base !font-bold !leading-6 text-modiff-text hover:bg-transparent"
              >
                <span className="line-clamp-2">{templateDisplayName(template)}</span>
              </ModiffButton>
            </h3>
            <TemplateReadinessIcon
              readiness={readiness}
              testId={`template-card-readiness-${template.id}`}
              onAction={() => onReadinessAction(readiness)}
            />
          </div>
          <p className="truncate text-sm font-semibold text-modiff-subtle-text">
            {STUDIO_MODEL_LABELS[template.modelType]} · {STUDIO_MODE_LABELS[template.mode]}
          </p>
        </div>

        <p className="line-clamp-2 min-h-10 text-sm leading-5 text-modiff-subtle-text">
          {template.recipeSummary ?? template.description}
        </p>

        <div className="mt-auto grid min-w-0 gap-2 border-t border-modiff-border pt-3">
          {runtimeEstimate ? (
            <div
              className="inline-flex min-w-0 items-center gap-2 text-xs text-modiff-subtle-text"
              data-testid={`template-runtime-${template.id}`}
              title={runtimeEstimate.title}
            >
              <Clock3 size={13} className="shrink-0 text-hf-yellow" />
              <span className="truncate">{runtimeEstimate.label}</span>
            </div>
          ) : null}
          <ModiffButton
            tone="primary"
            className="pointer-events-auto w-full"
            icon={<Play size={14} />}
            disabled={disabled}
            data-testid={`template-browser-create-card-${template.id}`}
            onClick={(event) => {
              event.stopPropagation();
              onCreate();
            }}
          >
            {requiresTermsReview ? 'Review terms' : 'Use template'}
          </ModiffButton>
        </div>
      </div>
    </article>
  );
}

function TemplateRecipeDetail({
  disabled,
  installingRepo,
  manifest,
  onBack,
  onCreate,
  onInstallRepo,
  onOpenAssets,
  onOpenModels,
  onOpenSetup,
  onUseLowVram,
  readiness,
  runtimeEstimate,
  requiresTermsReview,
  template,
}: {
  disabled: boolean;
  installingRepo: string | null;
  manifest: TemplateGalleryManifest | null;
  onBack: () => void;
  onCreate: () => void;
  onInstallRepo: (repoId: string, repair?: boolean) => void;
  onOpenAssets: () => void;
  onOpenModels: () => void;
  onOpenSetup: () => void;
  onUseLowVram: () => void;
  readiness: TemplateReadinessResult;
  runtimeEstimate: LocalRuntimeEstimate | null;
  requiresTermsReview: boolean;
  template: StudioTemplate;
}) {
  const detailManifestEntry = findManifestEntry(template, manifest, { requireCardPreview: false });
  // Source inputs have their own reviewed hash and do not become invalid merely
  // because a prompt, graph, or generated-output lock changes. Keep the strict
  // exactness gate for the result, but resolve the published source separately
  // so a template detail never drops its valid included example.
  const sourceEntry = detailManifestEntry ?? templatePublishedSourceEntry(template, manifest);
  const bundledSourcePreview = template.inputBindings
    ?.filter((binding) => binding.origin === 'template')
    .flatMap((binding) => binding.defaultAssets)
    .find((asset) => asset.previewPath)?.previewPath;
  const thumbnailPath =
    templateManifestPath(detailManifestEntry?.thumbnailPath ?? detailManifestEntry?.posterPath) ??
    templateExampleThumbnailPath(template);
  const beforePath = templateManifestPath(sourceEntry?.beforePath ?? bundledSourcePreview);
  const afterPath = templateManifestPath(detailManifestEntry?.afterPath ?? detailManifestEntry?.outputPath);
  const inputPresentation = templateInputPresentation(template);
  const createLabel = requiresTermsReview ? 'Review terms' : 'Use template';
  const hasInputAction = readiness.issues.some((issue) => issue.action === 'open_assets');
  const hasBackendAction = readiness.issues.some((issue) => issue.action === 'open_setup');
  const hasLowVramAction = readiness.issues.some((issue) => issue.action === 'apply_low_vram');

  return (
    <aside
      className="min-h-0 overflow-y-auto bg-modiff-bg p-4 @[1024px]:border-l @[1024px]:border-modiff-border"
      data-testid={`template-detail-${template.id}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <ModiffButton tone="ghost" size="dense" icon={<ArrowLeft size={15} />} onClick={onBack}>
          Templates
        </ModiffButton>
      </div>

      <TemplateBrowserPreview
        afterPath={afterPath}
        beforePath={beforePath}
        detail
        mediaKind={template.outputKinds?.[0]}
        slots={templateMediaSlots(template)}
        thumbnailPath={thumbnailPath}
        variant={template.thumbnailVariant}
      />

      <div className="mt-4 grid gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-modiff-border bg-modiff-panel px-2.5 py-1 text-xs font-semibold text-hf-yellow">
            <Layers3 size={12} />
            {STUDIO_MODE_LABELS[template.mode]}
          </div>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="break-words text-xl font-bold tracking-tight text-modiff-text">
                {templateDisplayName(template)}
              </h2>
              <p className="mt-1 text-sm font-semibold text-modiff-subtle-text">
                {STUDIO_MODEL_LABELS[template.modelType]} · {STUDIO_MODE_LABELS[template.mode]}
              </p>
            </div>
            <TemplateReadinessBadge readiness={readiness} />
          </div>
          <p className="mt-3 text-sm leading-6 text-modiff-subtle-text">{template.userGoal}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          {runtimeEstimate ? <InfoTile label="Local runtime" value={runtimeEstimate.label} /> : null}
          <InfoTile label="VRAM" value={template.vramEstimate ?? 'TBD'} />
          <InfoTile label="Output" value={outputKinds(template)} />
          <InfoTile label="Level" value={template.difficulty ?? 'starter'} />
        </div>

        <section className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3">
          <h3 className="text-sm font-semibold text-modiff-text">What this creates</h3>
          <p className="mt-1 text-xs leading-5 text-modiff-subtle-text">
            {template.recipeSummary ?? template.description}
          </p>
        </section>

        <section className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3">
          <h3 className="text-sm font-semibold text-modiff-text">{inputPresentation.title}</h3>
          <div className="mt-2 flex flex-wrap gap-1">
            {inputPresentation.items.map((input) => (
              <span
                key={input.key}
                className="inline-flex items-center gap-1 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-xs font-semibold text-modiff-subtle-text"
              >
                {input.included ? <CheckCircle2 aria-hidden="true" className="text-modiff-green" size={12} /> : null}
                {input.label}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3">
          <h3 className="text-sm font-semibold text-modiff-text">Default prompt</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-modiff-text">{template.prompt}</p>
          {template.negativePrompt ? (
            <>
              <h4 className="mt-3 text-xs font-semibold uppercase text-modiff-subtle-text">Negative prompt</h4>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-modiff-subtle-text">
                {template.negativePrompt}
              </p>
            </>
          ) : null}
        </section>

        <section className="grid gap-2" data-testid={`template-readiness-${template.id}`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-modiff-text">Preflight</h3>
            <TemplateReadinessBadge readiness={readiness} />
          </div>
          {readiness.issues.length === 0 ? (
            <IssueCard tone="success" title="Ready now" meta={readiness.summary}>
              Create a graph tab, build the graph, and then run when you are ready.
            </IssueCard>
          ) : (
            readiness.issues.map((issue) => (
              <IssueCard key={issue.id} tone={issue.tone} title={issue.title} meta={issue.detail} />
            ))
          )}
        </section>

        <div className="flex flex-wrap gap-2">
          {readiness.modelInstallTargets.map((target) => (
            <ModiffButton
              key={target.repoId}
              icon={<Boxes size={15} />}
              disabled={installingRepo === target.repoId}
              aria-label={`Install ${target.repoId}`}
              onClick={() => onInstallRepo(target.repoId, target.repair)}
            >
              {installingRepo === target.repoId ? 'Installing...' : (target.actionLabel ?? 'Install')}
            </ModiffButton>
          ))}
          {hasInputAction ? (
            <ModiffButton icon={<Image size={15} />} onClick={onOpenAssets}>
              Open assets
            </ModiffButton>
          ) : null}
          {hasBackendAction ? (
            <ModiffButton icon={<Wrench size={15} />} onClick={onOpenSetup}>
              Open setup
            </ModiffButton>
          ) : null}
          {hasLowVramAction ? (
            <ModiffButton icon={<Sparkles size={15} />} onClick={onUseLowVram}>
              Try Low VRAM
            </ModiffButton>
          ) : null}
          <ModiffButton icon={<Settings size={15} />} onClick={onOpenModels}>
            Models
          </ModiffButton>
        </div>

        <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-modiff-bg via-modiff-bg to-transparent px-4 pb-1 pt-5">
          <ModiffButton
            tone="primary"
            className="h-10 w-full"
            icon={
              readiness.status === 'planning' ||
              readiness.status === 'needs_backend' ||
              readiness.status === 'needs_setup' ? (
                <AlertTriangle size={15} />
              ) : (
                <Play size={15} />
              )
            }
            disabled={disabled}
            data-testid={`template-browser-create-${template.id}`}
            onClick={onCreate}
          >
            {createLabel}
          </ModiffButton>
        </div>
      </div>
    </aside>
  );
}

function InfoTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-2">
      <div className="text-xs font-semibold uppercase text-modiff-subtle-text">{label}</div>
      <div className="mt-1 break-words text-xs font-semibold text-modiff-text">{value}</div>
    </div>
  );
}

function TemplateBrowserPreview({
  afterPath,
  beforePath,
  detail = false,
  mediaKind = 'image',
  slots,
  thumbnailPath,
}: {
  afterPath?: string;
  beforePath?: string;
  detail?: boolean;
  mediaKind?: string;
  slots: TemplateMediaSlot[];
  thumbnailPath?: string;
  variant?: StudioTemplate['thumbnailVariant'];
}) {
  if (mediaKind === 'image' && beforePath && afterPath) {
    return <ComparisonMedia afterPath={afterPath} beforePath={beforePath} detail={detail} />;
  }

  // A poster is honest browsing artwork, not current generation proof. When the
  // locked generation no longer matches the template, keep its reviewed media
  // hidden and show only the published poster instead of empty placeholders.
  if (!afterPath && !beforePath && thumbnailPath) {
    return (
      <MediaSlotView
        slot={{
          id: 'editorial-poster',
          label: 'Template preview',
          kind: 'poster',
          placeholder: 'template poster pending',
        }}
        path={thumbnailPath}
        detail={detail}
        large
      />
    );
  }

  const hasComparisonSlots = slots.length === 2 && slots.some((slot) => slot.kind === 'compare-before');

  // Card previews should request only the lightweight reviewed derivative.
  // The complete source/output comparison remains available in the detail view.
  if (hasComparisonSlots && mediaKind === 'video' && !detail && afterPath) {
    return (
      <MediaSlotView
        slot={{
          id: 'published-result',
          label: 'Generated video preview',
          kind: 'video',
          posterPath: thumbnailPath,
          placeholder: 'video preview pending',
        }}
        path={afterPath}
        large
      />
    );
  }

  if (hasComparisonSlots) {
    const comparisonKind = (path: string | undefined, fallback: 'image' | 'video') => {
      if (!path) return fallback;
      const cleanPath = path.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
      if (/\.(mp4|webm|mov|mkv)$/.test(cleanPath)) return 'video' as const;
      if (/\.(png|jpe?g|webp|gif|avif)$/.test(cleanPath)) return 'image' as const;
      return fallback;
    };
    return (
      <div className="grid aspect-video grid-cols-2 overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-border">
        <MediaSlotView
          slot={mediaKind === 'video' ? { ...slots[0]!, kind: comparisonKind(beforePath, 'image') } : slots[0]!}
          path={beforePath}
          detail={detail}
        />
        <MediaSlotView
          slot={
            mediaKind === 'video'
              ? {
                  ...slots[1]!,
                  kind: comparisonKind(afterPath ?? thumbnailPath, afterPath ? 'video' : 'image'),
                  posterPath: thumbnailPath,
                }
              : slots[1]!
          }
          path={afterPath ?? thumbnailPath}
          detail={detail}
        />
      </div>
    );
  }

  // A published contact sheet or multi-reference result is already composed
  // for browsing. Show that complete result rather than mixing one real tile
  // with empty input/output placeholders.
  if (slots.length > 1 && (afterPath || thumbnailPath)) {
    const resultKind = mediaKind === 'video' ? 'video' : mediaKind === 'audio' ? 'audio' : 'image';
    return (
      <MediaSlotView
        slot={{
          id: 'published-result',
          label: 'Generated result',
          kind: resultKind,
          posterPath: thumbnailPath,
          placeholder: `${resultKind} preview pending`,
        }}
        path={resultKind === 'image' ? (thumbnailPath ?? afterPath) : (afterPath ?? thumbnailPath)}
        detail={detail}
        large
      />
    );
  }

  if (slots.length > 1) {
    return (
      <div className="grid aspect-video grid-cols-2 gap-px overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-border">
        {slots.slice(0, 4).map((slot, index) => (
          <MediaSlotView
            key={slot.id}
            slot={slot}
            path={slot.path ?? (index === 0 ? thumbnailPath : undefined)}
            compact
            detail={detail}
          />
        ))}
      </div>
    );
  }

  const primarySlot = slots[0]!;
  const playbackMedia = mediaKind === 'video' || mediaKind === 'audio';
  const resolvedSlot =
    mediaKind === 'video'
      ? { ...primarySlot, kind: 'video' as const, posterPath: primarySlot.posterPath ?? thumbnailPath }
      : mediaKind === 'audio'
        ? { ...primarySlot, kind: 'audio' as const }
        : primarySlot;

  return (
    <MediaSlotView
      slot={resolvedSlot}
      path={playbackMedia ? (afterPath ?? beforePath ?? primarySlot.path) : (thumbnailPath ?? primarySlot.path)}
      detail={detail}
      large
    />
  );
}

function ComparisonMedia({
  afterPath,
  beforePath,
  detail,
}: {
  afterPath: string;
  beforePath: string;
  detail: boolean;
}) {
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const updateFromClientX = (element: HTMLElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const nextPosition = ((clientX - bounds.left) / bounds.width) * 100;
    setPosition(Math.max(0, Math.min(100, nextPosition)));
  };

  return (
    <div className="relative aspect-video overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-panel">
      <ImageCompareFrame
        ref={comparisonRef}
        aria-label="Before and after comparison"
        testId="template-ab-comparison"
        imageFrom={beforePath}
        imageTo={afterPath}
        sliderPosition={position}
        onSliderPositionChange={setPosition}
        onError={(event) => {
          event.currentTarget.src = '/assets/modiff-icon-256.png';
        }}
        onMouseDown={(event) => {
          setDragging(true);
          updateFromClientX(event.currentTarget, event.clientX);
        }}
        onMouseEnter={(event) => {
          updateFromClientX(event.currentTarget, event.clientX);
        }}
        onMouseMove={(event) => {
          updateFromClientX(event.currentTarget, event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse') updateFromClientX(event.currentTarget, event.clientX);
        }}
        onMouseUp={() => setDragging(false)}
        onTouchStart={(event) => {
          setDragging(true);
          updateFromClientX(event.currentTarget, event.touches[0]?.clientX ?? 0);
        }}
        onTouchMove={(event) => {
          if (dragging) updateFromClientX(event.currentTarget, event.touches[0]?.clientX ?? 0);
        }}
        onTouchEnd={() => setDragging(false)}
      />
      {detail ? (
        <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-modiff-bg/80 px-2 py-1 text-xs font-semibold text-modiff-text backdrop-blur">
          Hover or drag to compare
        </span>
      ) : null}
    </div>
  );
}

function MediaSlotView({
  compact = false,
  detail = false,
  large = false,
  path,
  slot,
}: {
  compact?: boolean;
  detail?: boolean;
  large?: boolean;
  path?: string;
  slot: TemplateMediaSlot;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const [nearViewport, setNearViewport] = useState(detail);
  const [motionRestricted, setMotionRestricted] = useState(false);
  const [playRequested, setPlayRequested] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const usablePath = path && failedPath !== path ? path : undefined;
  const isVideo = slot.kind === 'video';
  const isAudio = slot.kind === 'audio';
  const isJson = slot.kind === 'json';
  const Icon = isVideo || slot.kind === 'gif' ? Film : isAudio ? Music2 : isJson ? LayoutGrid : Image;
  const attachVideo = detail || (nearViewport && (!motionRestricted || playRequested));
  const autoplayVideo = !detail && nearViewport && (!motionRestricted || playRequested);

  useEffect(() => {
    if (detail || !isVideo || !usablePath) return;
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setNearViewport(Boolean(entry?.isIntersecting)), {
      rootMargin: '160px 0px',
      threshold: 0.01,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [detail, isVideo, usablePath]);

  useEffect(() => {
    if (detail || !isVideo) return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (
      navigator as Navigator & {
        connection?: {
          saveData?: boolean;
          addEventListener?: (type: 'change', listener: () => void) => void;
          removeEventListener?: (type: 'change', listener: () => void) => void;
        };
      }
    ).connection;
    const updatePreference = () => setMotionRestricted(mediaQuery.matches || connection?.saveData === true);
    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    connection?.addEventListener?.('change', updatePreference);
    return () => {
      mediaQuery.removeEventListener('change', updatePreference);
      connection?.removeEventListener?.('change', updatePreference);
    };
  }, [detail, isVideo]);

  useEffect(() => {
    if (detail || !videoRef.current) return;
    if (!attachVideo || !autoplayVideo) {
      videoRef.current.pause();
      return;
    }
    void videoRef.current.play().catch(() => undefined);
  }, [attachVideo, autoplayVideo, detail]);

  useEffect(() => {
    setFailedPath(null);
    setPlayRequested(false);
    setVideoReady(false);
  }, [path]);

  return (
    <div
      ref={containerRef}
      className={cx(
        'relative grid place-items-center overflow-hidden bg-gradient-to-br from-modiff-panel via-modiff-bg to-modiff-surface',
        large && 'rounded-modiff-panel border border-modiff-border',
        large && 'aspect-video',
      )}
    >
      {usablePath && isVideo ? (
        <>
          {slot.posterPath ? (
            <img
              src={slot.posterPath}
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
          <video
            ref={videoRef}
            src={attachVideo ? usablePath : undefined}
            poster={slot.posterPath}
            muted={!detail}
            loop={!detail}
            controls={detail}
            autoPlay={autoplayVideo}
            playsInline
            preload={detail || attachVideo ? 'metadata' : 'none'}
            aria-label={slot.label}
            data-testid={detail ? 'template-detail-video' : 'template-card-video'}
            data-preview-attached={attachVideo ? 'true' : 'false'}
            className={cx(
              'relative h-full w-full object-cover transition-opacity duration-150',
              videoReady || !slot.posterPath ? 'opacity-100' : 'opacity-0',
            )}
            onError={() => setFailedPath(usablePath)}
            onLoadedData={() => setVideoReady(true)}
            onPlaying={() => setVideoReady(true)}
            onCanPlay={() => {
              if (autoplayVideo) void videoRef.current?.play().catch(() => undefined);
            }}
          />
        </>
      ) : isVideo && slot.posterPath ? (
        <img
          src={slot.posterPath}
          alt={slot.label}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : isAudio ? (
        <div className="grid h-full w-full content-center gap-4 bg-gradient-to-br from-hf-yellow/15 via-modiff-panel to-modiff-bg p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-hf-yellow text-modiff-on-accent">
              <Music2 size={18} />
            </div>
            <div className="flex h-16 flex-1 items-center justify-center gap-1 overflow-hidden">
              {AUDIO_WAVEFORM_BAR_CLASSES.map((heightClass, index) => (
                <span key={`${heightClass}-${index}`} className={cx('w-1 rounded-full bg-hf-yellow/80', heightClass)} />
              ))}
            </div>
          </div>
          {usablePath ? (
            <audio
              src={usablePath}
              controls
              preload={detail ? 'metadata' : 'none'}
              className="pointer-events-auto h-9 w-full"
              aria-label={slot.label}
              onError={() => setFailedPath(usablePath)}
            />
          ) : (
            <p className="text-center text-xs font-semibold text-modiff-subtle-text">No preview yet</p>
          )}
        </div>
      ) : usablePath && !isJson ? (
        large ? (
          detail ? (
            <>
              <img
                src={usablePath}
                alt=""
                aria-hidden="true"
                loading="eager"
                decoding="async"
                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-xl"
                onError={() => setFailedPath(usablePath)}
              />
              <img
                src={usablePath}
                alt={slot.label}
                loading="eager"
                decoding="async"
                className="relative h-full w-full object-contain p-1.5"
                onError={() => setFailedPath(usablePath)}
              />
            </>
          ) : (
            <img
              src={usablePath}
              alt={slot.label}
              loading="eager"
              decoding="async"
              className="h-full w-full object-cover"
              onError={() => setFailedPath(usablePath)}
            />
          )
        ) : (
          <img
            src={usablePath}
            alt={slot.label}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setFailedPath(usablePath)}
          />
        )
      ) : (
        <div className="grid h-full min-h-28 w-full place-items-center p-3 text-center">
          <div>
            <div className="mx-auto mb-2 grid size-9 place-items-center rounded-full border border-modiff-border bg-modiff-bg/70 text-modiff-subtle-text">
              <Icon size={compact ? 16 : 19} />
            </div>
            <p className="text-xs font-semibold text-modiff-subtle-text">
              {path ? 'Preview unavailable' : 'No preview yet'}
            </p>
            {!compact ? (
              <p className="mt-1 text-xs text-modiff-subtle-text">
                {path && failedPath === path ? 'The published media could not be decoded' : slot.placeholder}
              </p>
            ) : null}
          </div>
        </div>
      )}
      {!isAudio && detail ? (
        <span className="absolute left-2 top-2 rounded-full border border-modiff-overlay-text/10 bg-modiff-bg/75 px-2 py-1 text-xs font-semibold text-modiff-overlay-text backdrop-blur">
          {slot.label}
        </span>
      ) : null}
      {isVideo && usablePath && !detail && motionRestricted && !playRequested ? (
        <ModiffIconButton
          label="Play video preview"
          onClick={(event) => {
            event.stopPropagation();
            setPlayRequested(true);
          }}
          className="pointer-events-auto absolute inset-0 m-auto !size-10 rounded-full border border-modiff-overlay-text/20 bg-modiff-bg/80 text-modiff-overlay-text shadow-modiff-node backdrop-blur hover:border-hf-yellow hover:text-hf-yellow"
        >
          <Play size={17} fill="currentColor" />
        </ModiffIconButton>
      ) : null}
    </div>
  );
}

function TemplateReadinessIcon({
  onAction,
  readiness,
  testId,
}: {
  onAction: () => void;
  readiness: TemplateReadinessResult;
  testId?: string;
}) {
  const actionable = ['needs_input', 'needs_model', 'needs_backend', 'needs_setup'].includes(readiness.status);
  const icon =
    readiness.status === 'ready' ? (
      <CheckCircle2 size={18} />
    ) : readiness.status === 'needs_backend' ? (
      <XCircle size={18} />
    ) : readiness.status === 'preparing' || readiness.status === 'planning' ? (
      <Info size={18} />
    ) : (
      <AlertTriangle size={18} />
    );
  const className = cx(
    'pointer-events-auto relative grid size-8 shrink-0 place-items-center rounded-full border bg-modiff-panel/90 transition',
    readiness.tone === 'success' && 'border-modiff-green/70 text-modiff-green',
    readiness.tone === 'warning' && 'border-hf-orange/70 text-hf-orange',
    readiness.tone === 'error' && 'border-modiff-red/70 text-modiff-red',
    readiness.tone === 'info' && 'border-modiff-blue/70 text-modiff-blue',
    readiness.tone === 'default' && 'border-modiff-border text-modiff-subtle-text',
    actionable && 'hover:scale-105 hover:bg-modiff-surface-hover',
  );
  const title = `${readiness.label}: ${readiness.summary}`;

  return actionable ? (
    <ModiffIconButton label={title} className={className} data-testid={testId} onClick={onAction}>
      {icon}
    </ModiffIconButton>
  ) : (
    <ModiffTooltip<HTMLSpanElement> content={title}>
      {(tooltipProps) => (
        <span {...tooltipProps} className={className} data-testid={testId} aria-label={title} role="img" tabIndex={0}>
          {icon}
        </span>
      )}
    </ModiffTooltip>
  );
}

function TemplateReadinessBadge({ readiness }: { readiness: TemplateReadinessResult }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-modiff-compact border px-1.5 py-0.5 text-xs font-semibold',
        readiness.tone === 'success' && 'border-modiff-green/70 text-modiff-green',
        readiness.tone === 'warning' && 'border-hf-orange/70 text-hf-orange',
        readiness.tone === 'error' && 'border-modiff-red/70 text-modiff-red',
        readiness.tone === 'info' && 'border-modiff-blue/70 text-modiff-blue',
        readiness.tone === 'default' && 'border-modiff-border text-modiff-subtle-text',
      )}
    >
      {readiness.tone === 'success' ? (
        <CheckCircle2 size={12} />
      ) : readiness.tone === 'error' ? (
        <AlertTriangle size={12} />
      ) : (
        <Info size={12} />
      )}
      {readiness.label}
    </span>
  );
}
