import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
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
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  Wrench,
} from 'lucide-react';
import { enqueueSnackbar } from '../ui/snackbar';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import {
  STUDIO_MODEL_LABELS,
  STUDIO_MODE_LABELS,
  getCatalogModelProfiles,
  getFormDefaultsForMode,
} from '../studio/modelProfiles';
import { autoPlanKeyForForm, fetchAutoResourcePlans, type StudioAutoResourcePlan } from '../studio/autoResource';
import {
  TEMPLATE_GALLERY_MANIFEST_PATH,
  getTemplateExampleUiState,
  templateManifestPath,
  type TemplateGalleryManifest,
} from '../studio/templateExactness';
import {
  TEMPLATE_BROWSER_CATEGORIES,
  filterStudioTemplates,
  templateMediaSlots,
  type TemplateBrowserCategoryId,
  type TemplateBrowserFilter,
  type TemplateMediaSlot,
} from '../studio/templateBrowser';
import { getTemplateReadiness, type TemplateReadinessResult } from '../studio/templateReadiness';
import { createWorkflowFromTemplate } from '../studio/templateWorkflow';
import { STUDIO_TEMPLATES } from '../studio/templates';
import type { StudioModelType, StudioTemplate } from '../studio/types';
import { IssueCard, ModiffButton, ModiffDialog, ModiffInput } from '../ui';
import { cx } from '../utils/classNames';
import { requestJson } from '../utils/requestJson';

const difficultyOptions: Array<TemplateBrowserFilter['difficulty']> = [
  'all',
  'starter',
  'intermediate',
  'advanced',
  'blocked',
];

function parseTemplateGalleryManifest(value: unknown): TemplateGalleryManifest {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 2 ||
    typeof (value as { generatedAt?: unknown }).generatedAt !== 'string' ||
    typeof (value as { runtimeFingerprint?: unknown }).runtimeFingerprint !== 'string' ||
    !Array.isArray((value as { examples?: unknown }).examples)
  ) {
    throw new Error('The template gallery manifest is invalid.');
  }
  return value as TemplateGalleryManifest;
}
const sortOptions: Array<{ value: TemplateBrowserFilter['sort']; label: string }> = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'task', label: 'Task' },
  { value: 'model', label: 'Model' },
  { value: 'runtime', label: 'Runtime' },
];

function formatDifficulty(value: TemplateBrowserFilter['difficulty']) {
  return value === 'all' ? 'All levels' : value.charAt(0).toUpperCase() + value.slice(1);
}

function outputKinds(template: StudioTemplate) {
  return template.outputKinds?.join(', ') || template.example?.mediaType || 'image';
}

function templateExampleOutputPath(template: StudioTemplate) {
  return templateManifestPath(template.example?.outputPath ?? template.example?.thumbnailPath);
}

function templateExampleThumbnailPath(template: StudioTemplate) {
  return templateManifestPath(template.example?.thumbnailPath ?? template.example?.outputPath);
}

function inputsList(template: StudioTemplate) {
  const requirements = template.inputRequirements;
  if (!requirements) return ['Prompt only'];
  const parts: string[] = [];
  if (requirements.sourceImage) parts.push('source image');
  if (requirements.referenceImages)
    parts.push(`${requirements.referenceImages} reference image${requirements.referenceImages === 1 ? '' : 's'}`);
  if (requirements.controlImage) parts.push('control image');
  if (requirements.maskImage) parts.push('mask image');
  if (requirements.sourceVideo) parts.push('source video');
  if (requirements.maskVideo) parts.push('mask video');
  if (requirements.controlVideo) parts.push('control video');
  if (requirements.loraAdapter) parts.push('LoRA adapter');
  if (requirements.upscalerModel) parts.push('upscaler model');
  if (requirements.sampleAssets?.length) parts.push(...requirements.sampleAssets);
  return parts.length > 0 ? parts : ['Prompt only'];
}

function categoryLabel(categoryId: TemplateBrowserCategoryId) {
  return TEMPLATE_BROWSER_CATEGORIES.find((category) => category.id === categoryId)?.label ?? 'Templates';
}

function templateHasPublishedMedia(template: StudioTemplate, manifest: TemplateGalleryManifest | null) {
  if (manifest?.examples.some((entry) => entry.templateId === template.id)) return true;
  if (templateExampleThumbnailPath(template) || templateExampleOutputPath(template)) return true;
  return template.mediaSlots?.some((slot) => Boolean(slot.path || slot.posterPath)) ?? false;
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
  const studioViewMode = useSettingsStore((state) => state.studioViewMode);
  const form = useStudioStore((state) => state.form);
  const activeTemplateId = useStudioStore((state) => state.activeTemplateId);
  const autoResourcePlans = useStudioStore((state) => state.autoResourcePlans);
  const setAutoResourcePlans = useStudioStore((state) => state.setAutoResourcePlans);
  const sid = useWebsocketStore((state) => state.sid);
  const hfCache = useNodesStore((state) => state.hfCache);
  const localModels = useNodesStore((state) => state.localModels);
  const modelCacheDiagnostics = useNodesStore((state) => state.modelCacheDiagnostics);
  const runtimeStatus = useNodesStore((state) => state.runtimeStatus);
  const nodesRegistry = useNodesStore((state) => state.nodesRegistry);
  const installHfModel = useNodesStore((state) => state.installHfModel);
  const refreshModelIndexes = useNodesStore((state) => state.refreshModelIndexes);
  const [manifest, setManifest] = useState<TemplateGalleryManifest | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [installingRepo, setInstallingRepo] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TemplateBrowserFilter>({
    category: 'recommended',
    query: '',
    modelType: 'all',
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    requestJson(TEMPLATE_GALLERY_MANIFEST_PATH, {
      signal: controller.signal,
      parse: parseTemplateGalleryManifest,
    })
      .then((payload) => {
        setManifest(payload);
      })
      .catch(() => {
        if (!controller.signal.aborted) setManifest(null);
      });
    return () => {
      controller.abort();
    };
  }, [open]);

  const readinessContext = useMemo(
    () => ({
      form,
      hfCache,
      localModels,
      modelCacheDiagnostics,
      runtimeStatus,
      nodesRegistry,
    }),
    [form, hfCache, localModels, modelCacheDiagnostics, nodesRegistry, runtimeStatus],
  );

  const effectiveFilter = useMemo(
    () => ({
      ...filter,
      includeBlocked: studioViewMode === 'expert',
    }),
    [filter, studioViewMode],
  );
  const filteredTemplates = useMemo(
    () => filterStudioTemplates(STUDIO_TEMPLATES, form, effectiveFilter),
    [effectiveFilter, form],
  );
  const publishedTemplateCount = useMemo(
    () => STUDIO_TEMPLATES.filter((template) => templateHasPublishedMedia(template, manifest)).length,
    [manifest],
  );
  const exactTemplateCount =
    manifest?.examples.filter((entry) => entry.qualityReviewStatus === 'approved_exact').length ?? 0;
  const reviewedTemplateCount =
    manifest?.examples.filter((entry) => entry.qualityReviewStatus === 'approved_reviewed').length ?? 0;
  const templates = useMemo(() => {
    const isUnfilteredRecommendation =
      filter.category === 'recommended' &&
      filter.query.trim().length === 0 &&
      filter.modelType === 'all' &&
      filter.difficulty === 'all';
    if (!isUnfilteredRecommendation) return filteredTemplates;
    const published = filteredTemplates.filter((template) => templateHasPublishedMedia(template, manifest));
    if (published.length === 0) return filteredTemplates;
    if (filter.sort !== 'recommended') return published;
    return [...published].sort((left, right) => showcasePriority(left.id) - showcasePriority(right.id));
  }, [filter.category, filter.difficulty, filter.modelType, filter.query, filter.sort, filteredTemplates, manifest]);
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

  const templateAutoForm = useCallback(
    (template: StudioTemplate) => ({
      ...getFormDefaultsForMode(template.mode, template.modelType),
      prompt: template.prompt,
      negativePrompt: template.negativePrompt ?? '',
    }),
    [],
  );

  const autoPlanForTemplate = useCallback(
    (template: StudioTemplate) => autoResourcePlans[autoPlanKeyForForm(templateAutoForm(template))],
    [autoResourcePlans, templateAutoForm],
  );

  useEffect(() => {
    if (!open || templates.length === 0) return;
    let cancelled = false;
    const forms = templates.map(templateAutoForm);
    const keys = forms.map(autoPlanKeyForForm);
    void fetchAutoResourcePlans(forms, keys)
      .then((plans) => {
        if (cancelled) return;
        const next: Record<string, StudioAutoResourcePlan> = {};
        plans.forEach((plan, index) => {
          const key = plan.planKey ?? keys[index];
          if (key) {
            next[key] = plan;
          }
        });
        setAutoResourcePlans(next);
      })
      .catch((error) => console.error(error));
    return () => {
      cancelled = true;
    };
  }, [open, setAutoResourcePlans, templateAutoForm, templates]);

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
          `${template.label} recipe graph created with ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}`,
          { variant: 'warning', autoHideDuration: 7000 },
        );
        return;
      }
      enqueueSnackbar(`${template.label} recipe graph created`, { variant: 'success', autoHideDuration: 2600 });
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setIsApplying(false);
    }
  };

  const installRepo = async (repoId: string, repair = false) => {
    setInstallingRepo(repoId);
    try {
      await installHfModel(repoId, sid, { repair });
      await refreshModelIndexes(true);
    } catch (error) {
      console.error(error);
    } finally {
      setInstallingRepo(null);
    }
  };

  const openSetup = () => {
    setRightPanelOpen(true);
    setRightPanelTab('setup');
    setOpen(false);
  };

  const openModels = () => {
    setModelManagerOpener({ nodeId: null, fieldKey: null });
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
    <ModiffDialog
      open={open}
      onClose={() => setOpen(false)}
      title={
        <span className="inline-flex items-center gap-2">
          <WandSparkles size={18} className="text-hf-yellow" />
          Creative recipes
          <span className="rounded-full border border-modiff-border bg-modiff-panel px-2 py-0.5 text-xs font-semibold text-modiff-muted">
            {publishedTemplateCount} showcased
          </span>
        </span>
      }
      panelClassName="max-w-[1540px]"
      bodyClassName="h-[86vh] max-h-[900px] overflow-hidden p-0"
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="min-h-0 overflow-x-auto border-b border-modiff-border bg-modiff-bg p-2 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-3">
          <div className="mb-4 hidden rounded-modiff-panel border border-hf-yellow/20 bg-gradient-to-br from-hf-yellow/15 via-modiff-panel to-modiff-bg p-3 lg:block">
            <div className="mb-2 grid size-9 place-items-center rounded-full bg-hf-yellow text-black shadow-modiff-node">
              <Sparkles size={17} />
            </div>
            <p className="text-sm font-semibold text-modiff-text">Find your starting point</p>
            <p className="mt-1 text-xs leading-5 text-modiff-muted">
              Begin with a generated showcase or explore every modular recipe.
            </p>
          </div>
          <div className="mb-2 hidden items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide text-modiff-muted lg:flex">
            <LayoutGrid size={14} />
            Browse by intent
          </div>
          <div className="flex min-w-max gap-1 lg:grid lg:min-w-0">
            {visibleCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                data-testid={`template-browser-category-${category.id}`}
                onClick={() => {
                  setFilter((current) => ({ ...current, category: category.id }));
                  setSelectedTemplateId(null);
                }}
                className={cx(
                  'flex min-h-10 shrink-0 items-center justify-between gap-2 rounded-modiff-compact px-3 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow lg:w-full',
                  filter.category === category.id
                    ? 'bg-hf-yellow font-semibold text-black shadow-modiff-node'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white',
                )}
              >
                <span className="truncate">{category.label}</span>
                <span
                  className={cx(
                    'min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs',
                    filter.category === category.id ? 'bg-black/15' : 'bg-modiff-panel text-modiff-muted',
                  )}
                >
                  {categoryCounts.get(category.id) ?? 0}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-modiff-surface">
          <div className="border-b border-modiff-border bg-gradient-to-br from-modiff-panel via-modiff-surface to-modiff-bg p-3 lg:p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3 lg:mb-5 lg:gap-4">
              <div className="max-w-2xl">
                <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-hf-yellow">
                  <Sparkles size={13} />
                  {filter.category === 'recommended' ? 'Generated showcase' : categoryLabel(filter.category)}
                </div>
                <h1 className="text-xl font-bold tracking-tight text-white lg:text-2xl">
                  {filter.category === 'recommended'
                    ? 'Start with something remarkable'
                    : `Explore ${categoryLabel(filter.category)}`}
                </h1>
                <p className="mt-2 text-sm leading-6 text-modiff-muted">
                  Production-minded prompts, model-aware defaults, and reusable graphs for image, video, and audio
                  creation.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <GalleryStat label="Showcased" value={publishedTemplateCount} />
                <GalleryStat label="Reviewed" value={reviewedTemplateCount} tone="success" />
                <GalleryStat label="Exact" value={exactTemplateCount} tone="success" />
                <GalleryStat label="Recipes" value={STUDIO_TEMPLATES.length} />
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label className="flex h-10 min-w-64 flex-1 items-center gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg/80 px-3 text-sm text-modiff-text shadow-modiff-node focus-within:border-hf-yellow">
                <Search size={16} className="shrink-0 text-gray-400" />
                <ModiffInput
                  data-testid="template-browser-search"
                  value={filter.query}
                  onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
                  placeholder="Search recipes, models, prompts, or techniques"
                  className="h-auto border-0 bg-transparent px-0 focus:border-transparent"
                />
              </label>
              <TemplateSelect
                label="Model"
                value={filter.modelType}
                onChange={(value) =>
                  setFilter((current) => ({ ...current, modelType: value as StudioModelType | 'all' }))
                }
              >
                <option value="all">All models</option>
                {getCatalogModelProfiles({ currentModelType: form.modelType }).map((profile) => (
                  <option key={profile.modelType} value={profile.modelType}>
                    {profile.label}
                  </option>
                ))}
              </TemplateSelect>
              <TemplateSelect
                label="Level"
                value={filter.difficulty}
                onChange={(value) =>
                  setFilter((current) => ({ ...current, difficulty: value as TemplateBrowserFilter['difficulty'] }))
                }
              >
                {difficultyOptions.map((difficulty) => (
                  <option key={difficulty} value={difficulty}>
                    {formatDifficulty(difficulty)}
                  </option>
                ))}
              </TemplateSelect>
              <TemplateSelect
                label="Sort"
                value={filter.sort}
                onChange={(value) =>
                  setFilter((current) => ({ ...current, sort: value as TemplateBrowserFilter['sort'] }))
                }
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </TemplateSelect>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-modiff-muted">
              <span className="inline-flex items-center gap-1 rounded-full border border-modiff-border bg-modiff-bg px-2.5 py-1">
                <SlidersHorizontal size={13} />
                {categoryLabel(filter.category)}
              </span>
              <span className="rounded-full border border-modiff-border bg-modiff-bg px-2.5 py-1">
                {templates.length} recipe{templates.length === 1 ? '' : 's'}
              </span>
              <span className="rounded-full border border-modiff-border bg-modiff-bg px-2.5 py-1">
                Current task: {STUDIO_MODE_LABELS[form.mode]}
              </span>
              {filter.category === 'recommended' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-modiff-green/40 bg-modiff-green/10 px-2.5 py-1 text-gray-200">
                  <CheckCircle2 size={12} className="text-modiff-green" />
                  Asset-backed only
                </span>
              ) : null}
            </div>
          </div>

          <div className={cx('grid h-full min-h-0', selectedTemplate && 'xl:grid-cols-[minmax(0,1fr)_440px]')}>
            <div className={cx('min-h-0 overflow-y-auto p-4', selectedTemplate && 'hidden xl:block')}>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
                {templates.map((template, index) => (
                  <TemplateBrowserCard
                    key={template.id}
                    active={activeTemplateId === template.id}
                    disabled={isApplying}
                    featured={filter.category === 'recommended' && index === 0 && templates.length > 2}
                    manifest={manifest}
                    readiness={getTemplateReadiness(template, {
                      ...readinessContext,
                      autoResourcePlan: autoPlanForTemplate(template),
                    })}
                    selected={selectedTemplateId === template.id}
                    template={template}
                    onCreate={() => {
                      void createFromTemplate(template);
                    }}
                    onView={() => setSelectedTemplateId(template.id)}
                  />
                ))}
                {templates.length === 0 && (
                  <div className="col-span-full rounded-modiff-compact border border-modiff-border bg-modiff-bg p-4 text-sm text-modiff-muted">
                    No templates match the current filters.
                  </div>
                )}
              </div>
            </div>

            {selectedTemplate ? (
              <TemplateRecipeDetail
                disabled={isApplying}
                installingRepo={installingRepo}
                manifest={manifest}
                readiness={getTemplateReadiness(selectedTemplate, {
                  ...readinessContext,
                  autoResourcePlan: autoPlanForTemplate(selectedTemplate),
                })}
                template={selectedTemplate}
                onBack={() => setSelectedTemplateId(null)}
                onCreate={() => {
                  void createFromTemplate(selectedTemplate);
                }}
                onInstallRepo={(repoId, repair) => {
                  void installRepo(repoId, repair);
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
  );
}

function TemplateSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-modiff-muted">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-32 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 text-sm text-modiff-text focus:border-hf-yellow focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

function GalleryStat({
  label,
  tone = 'default',
  value,
}: {
  label: string;
  tone?: 'default' | 'success';
  value: number;
}) {
  return (
    <div
      className={cx(
        'min-w-20 rounded-modiff-compact border bg-modiff-bg/80 px-3 py-2 text-right shadow-modiff-node',
        tone === 'success' ? 'border-modiff-green/40' : 'border-modiff-border',
      )}
    >
      <div className={cx('text-lg font-bold leading-none', tone === 'success' ? 'text-modiff-green' : 'text-white')}>
        {value}
      </div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-modiff-muted">{label}</div>
    </div>
  );
}

function TemplateBrowserCard({
  active,
  disabled,
  featured,
  manifest,
  onCreate,
  onView,
  readiness,
  selected,
  template,
}: {
  active: boolean;
  disabled: boolean;
  featured: boolean;
  manifest: TemplateGalleryManifest | null;
  onCreate: () => void;
  onView: () => void;
  readiness: TemplateReadinessResult;
  selected: boolean;
  template: StudioTemplate;
}) {
  const state = getTemplateExampleUiState(
    template,
    useStudioStore.getState().form,
    useStudioStore.getState().activeTemplateId,
    manifest,
  );
  const thumbnailPath =
    templateManifestPath(state.manifestEntry?.thumbnailPath ?? state.manifestEntry?.posterPath) ??
    templateExampleThumbnailPath(template);
  const beforePath = templateManifestPath(state.manifestEntry?.beforePath);
  const afterPath =
    templateManifestPath(state.manifestEntry?.afterPath ?? state.manifestEntry?.outputPath) ??
    templateExampleOutputPath(template);

  return (
    <article
      data-testid={`template-browser-card-${template.id}`}
      title="Double-click to use this recipe"
      onDoubleClick={(event) => {
        event.preventDefault();
        if (event.target instanceof HTMLElement && event.target.closest('button')) return;
        if (!disabled) onCreate();
      }}
      className={cx(
        'group overflow-hidden rounded-modiff-panel border bg-modiff-bg shadow-modiff-node transition duration-300 hover:-translate-y-0.5 hover:border-hf-yellow/60',
        !disabled && 'cursor-pointer',
        featured && 'xl:col-span-2',
        selected || active ? 'border-hf-yellow ring-1 ring-hf-yellow/40' : 'border-modiff-border',
      )}
    >
      <div className="relative overflow-hidden bg-modiff-panel">
        <TemplateBrowserPreview
          afterPath={afterPath}
          beforePath={beforePath}
          featured={featured}
          mediaKind={template.outputKinds?.[0]}
          slots={templateMediaSlots(template)}
          thumbnailPath={thumbnailPath}
          variant={template.thumbnailVariant}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-modiff-bg/80 to-transparent p-3">
          <TemplateStateBadge status={state.status} label={state.label} />
          <span className="rounded-full border border-white/10 bg-modiff-bg/80 px-2 py-1 text-xs font-semibold text-gray-200 backdrop-blur">
            {outputKinds(template)}
          </span>
        </div>
        {featured ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-modiff-bg via-modiff-bg/70 to-transparent p-4 pt-16">
            <div className="mb-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-hf-yellow">
              <Sparkles size={12} /> Featured recipe
            </div>
            <h3 className="text-xl font-bold text-white">{template.label}</h3>
            <p className="mt-1 line-clamp-1 max-w-xl text-sm text-gray-200">
              {template.recipeSummary ?? template.description}
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 p-4">
        {!featured ? (
          <div className="min-w-0">
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className="truncate text-base font-bold text-modiff-text">{template.label}</h3>
              <TemplateReadinessBadge readiness={readiness} />
            </div>
            <p className="text-xs font-semibold text-hf-gray">
              {STUDIO_MODE_LABELS[template.mode]} · {STUDIO_MODEL_LABELS[template.modelType]}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-hf-gray">
              {STUDIO_MODE_LABELS[template.mode]} · {STUDIO_MODEL_LABELS[template.modelType]}
            </p>
            <TemplateReadinessBadge readiness={readiness} />
          </div>
        )}

        {!featured ? (
          <p className="line-clamp-2 min-h-10 text-sm leading-5 text-gray-300">
            {template.recipeSummary ?? template.description}
          </p>
        ) : null}

        <div className="grid min-w-0 gap-2 border-t border-modiff-border pt-3">
          <div className="inline-flex min-w-0 items-center gap-2 text-xs text-modiff-muted">
            <Clock3 size={13} className="shrink-0 text-hf-yellow" />
            <span className="truncate">
              {template.runtimeEstimate ?? template.example?.runtimeEstimate ?? 'Runtime TBD'}
            </span>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <ModiffButton
              tone={selected ? 'primary' : 'ghost'}
              icon={<ArrowUpRight size={15} />}
              disabled={disabled}
              data-testid={`template-browser-use-${template.id}`}
              onClick={onView}
            >
              Explore
            </ModiffButton>
            <ModiffButton
              tone="primary"
              icon={<Play size={14} />}
              disabled={disabled}
              data-testid={`template-browser-create-card-${template.id}`}
              onClick={onCreate}
            >
              Use recipe
            </ModiffButton>
          </div>
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
  template: StudioTemplate;
}) {
  const state = getTemplateExampleUiState(
    template,
    useStudioStore.getState().form,
    useStudioStore.getState().activeTemplateId,
    manifest,
  );
  const thumbnailPath =
    templateManifestPath(state.manifestEntry?.thumbnailPath ?? state.manifestEntry?.posterPath) ??
    templateExampleThumbnailPath(template);
  const beforePath = templateManifestPath(state.manifestEntry?.beforePath);
  const afterPath =
    templateManifestPath(state.manifestEntry?.afterPath ?? state.manifestEntry?.outputPath) ??
    templateExampleOutputPath(template);
  const createLabel =
    readiness.status === 'planning'
      ? 'Open planning recipe'
      : readiness.status === 'needs_backend'
        ? 'Open blocked recipe'
        : 'Create graph';
  const hasInputAction = readiness.issues.some((issue) => issue.action === 'open_assets');
  const hasBackendAction = readiness.issues.some((issue) => issue.action === 'open_setup');
  const hasLowVramAction = readiness.issues.some((issue) => issue.action === 'apply_low_vram');

  return (
    <aside
      className="min-h-0 overflow-y-auto bg-modiff-bg p-4 xl:border-l xl:border-modiff-border"
      data-testid={`template-detail-${template.id}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1 rounded-modiff-compact px-2 text-sm font-semibold text-gray-300 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
          onClick={onBack}
        >
          <ArrowLeft size={15} />
          Recipes
        </button>
        <TemplateStateBadge status={state.status} label={state.label} />
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
              <h2 className="break-words text-xl font-bold tracking-tight text-white">{template.label}</h2>
              <p className="mt-1 text-xs font-semibold text-modiff-muted">{STUDIO_MODEL_LABELS[template.modelType]}</p>
            </div>
            <TemplateReadinessBadge readiness={readiness} />
          </div>
          <p className="mt-3 text-sm leading-6 text-gray-300">{template.userGoal}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <InfoTile label="Runtime" value={template.runtimeEstimate ?? template.example?.runtimeEstimate ?? 'TBD'} />
          <InfoTile label="VRAM" value={template.vramEstimate ?? 'TBD'} />
          <InfoTile label="Output" value={outputKinds(template)} />
          <InfoTile label="Level" value={template.difficulty ?? 'starter'} />
        </div>

        <section className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3">
          <h3 className="text-sm font-semibold text-modiff-text">What this creates</h3>
          <p className="mt-1 text-xs leading-5 text-gray-300">{template.recipeSummary ?? template.description}</p>
        </section>

        <section className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3">
          <h3 className="text-sm font-semibold text-modiff-text">Required inputs</h3>
          <div className="mt-2 flex flex-wrap gap-1">
            {inputsList(template).map((input) => (
              <span
                key={input}
                className="rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-xs font-semibold text-gray-300"
              >
                {input}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3">
          <h3 className="text-sm font-semibold text-modiff-text">Prompt recipe</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-gray-200">{template.prompt}</p>
          {template.negativePrompt ? (
            <>
              <h4 className="mt-3 text-xs font-semibold uppercase text-modiff-muted">Negative prompt</h4>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-gray-300">
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
              readiness.status === 'planning' || readiness.status === 'needs_backend' ? (
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
      <div className="text-xs font-semibold uppercase text-modiff-muted">{label}</div>
      <div className="mt-1 break-words text-xs font-semibold text-modiff-text">{value}</div>
    </div>
  );
}

function TemplateBrowserPreview({
  afterPath,
  beforePath,
  detail = false,
  featured = false,
  mediaKind = 'image',
  slots,
  thumbnailPath,
  variant,
}: {
  afterPath?: string;
  beforePath?: string;
  detail?: boolean;
  featured?: boolean;
  mediaKind?: string;
  slots: TemplateMediaSlot[];
  thumbnailPath?: string;
  variant?: StudioTemplate['thumbnailVariant'];
}) {
  if (variant === 'compareSlider' && mediaKind === 'image' && beforePath && afterPath) {
    return <ComparisonMedia afterPath={afterPath} beforePath={beforePath} detail={detail} />;
  }

  if (variant === 'hoverDissolve' && mediaKind === 'image' && beforePath && afterPath) {
    return <DissolveMedia afterPath={afterPath} beforePath={beforePath} />;
  }

  if (mediaKind === 'image' && beforePath && afterPath) {
    return <SideBySideMedia afterPath={afterPath} beforePath={beforePath} />;
  }

  if (slots.length === 2 && slots.some((slot) => slot.kind === 'compare-before')) {
    return (
      <div className="grid aspect-video grid-cols-2 overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-border">
        <MediaSlotView
          slot={mediaKind === 'video' ? { ...slots[0]!, kind: 'video' } : slots[0]!}
          path={beforePath}
          detail={detail}
        />
        <MediaSlotView
          slot={mediaKind === 'video' ? { ...slots[1]!, kind: 'video', posterPath: thumbnailPath } : slots[1]!}
          path={afterPath ?? thumbnailPath}
          detail={detail}
        />
      </div>
    );
  }

  if (slots.length > 1) {
    return (
      <div className="grid aspect-video grid-cols-2 gap-px overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-border">
        {slots.slice(0, 4).map((slot, index) => (
          <MediaSlotView
            key={slot.id}
            slot={slot}
            path={index === 0 ? thumbnailPath : slot.path}
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
      path={playbackMedia ? (afterPath ?? primarySlot.path) : (thumbnailPath ?? primarySlot.path)}
      detail={detail}
      featured={featured}
      large
    />
  );
}

function SideBySideMedia({ afterPath, beforePath }: { afterPath: string; beforePath: string }) {
  return (
    <div className="grid aspect-video grid-cols-2 gap-px overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-border">
      <div className="relative overflow-hidden bg-modiff-panel">
        <img src={beforePath} alt="Before" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        <span className="absolute bottom-2 left-2 rounded-full bg-modiff-bg/80 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
          Before
        </span>
      </div>
      <div className="relative overflow-hidden bg-modiff-panel">
        <img src={afterPath} alt="After" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        <span className="absolute bottom-2 left-2 rounded-full bg-modiff-bg/80 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
          After
        </span>
      </div>
    </div>
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
  const clipId = `template-compare-${useId().replace(/:/g, '')}`;

  return (
    <div className="relative aspect-video overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-panel">
      <svg viewBox="0 0 100 56.25" className="h-full w-full" role="img" aria-label="Before and after comparison">
        <image href={beforePath} width="100" height="56.25" preserveAspectRatio="xMidYMid slice" />
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={position} height="56.25" />
          </clipPath>
        </defs>
        <image
          href={afterPath}
          width="100"
          height="56.25"
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
        <line x1={position} x2={position} y1="0" y2="56.25" strokeWidth="0.5" className="stroke-hf-yellow" />
        <circle cx={position} cy="28.125" r="2.4" className="fill-hf-yellow stroke-modiff-bg" strokeWidth="0.6" />
      </svg>
      <span className="absolute bottom-2 left-2 rounded-full bg-modiff-bg/80 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
        After
      </span>
      <span className="absolute bottom-2 right-2 rounded-full bg-modiff-bg/80 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
        Before
      </span>
      <input
        type="range"
        min="0"
        max="100"
        value={position}
        aria-label="Reveal before or after image"
        onChange={(event) => setPosition(Number(event.target.value))}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
      {detail ? (
        <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-modiff-bg/80 px-2 py-1 text-xs font-semibold text-gray-200 backdrop-blur">
          Drag to compare
        </span>
      ) : null}
    </div>
  );
}

function DissolveMedia({ afterPath, beforePath }: { afterPath: string; beforePath: string }) {
  return (
    <div className="group relative aspect-video overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-panel">
      <img src={beforePath} alt="Before" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      <img
        src={afterPath}
        alt="After"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-focus-within:opacity-100"
      />
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-modiff-bg/80 px-2 py-1 text-xs font-semibold text-gray-200 backdrop-blur">
        Hover to reveal
      </span>
    </div>
  );
}

function MediaSlotView({
  compact = false,
  detail = false,
  featured = false,
  large = false,
  path,
  slot,
}: {
  compact?: boolean;
  detail?: boolean;
  featured?: boolean;
  large?: boolean;
  path?: string;
  slot: TemplateMediaSlot;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const usablePath = path && failedPath !== path ? path : undefined;
  const isVideo = slot.kind === 'video';
  const isAudio = slot.kind === 'audio';
  const isJson = slot.kind === 'json';
  const Icon = isVideo || slot.kind === 'gif' ? Film : isAudio ? Music2 : isJson ? LayoutGrid : Image;

  const playVideoPreview = () => {
    if (detail || !videoRef.current) return;
    void videoRef.current.play().catch(() => undefined);
  };

  const pauseVideoPreview = () => {
    if (detail || !videoRef.current) return;
    videoRef.current.pause();
  };

  return (
    <div
      className={cx(
        'relative grid place-items-center overflow-hidden bg-gradient-to-br from-modiff-panel via-modiff-bg to-modiff-surface',
        large && 'rounded-modiff-panel border border-modiff-border',
        large && (featured ? 'aspect-[21/9]' : 'aspect-video'),
      )}
      onMouseEnter={playVideoPreview}
      onMouseLeave={pauseVideoPreview}
    >
      {usablePath && isVideo ? (
        <video
          ref={videoRef}
          src={usablePath}
          poster={slot.posterPath}
          muted={!detail}
          loop={!detail}
          controls={detail}
          playsInline
          preload="metadata"
          aria-label={slot.label}
          className="h-full w-full object-cover"
          onError={() => setFailedPath(usablePath)}
        />
      ) : usablePath && isAudio ? (
        <div className="grid h-full w-full content-center gap-4 bg-gradient-to-br from-hf-yellow/15 via-modiff-panel to-modiff-bg p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-hf-yellow text-black">
              <Music2 size={18} />
            </div>
            <div className="flex h-16 flex-1 items-center justify-center gap-1 overflow-hidden">
              {AUDIO_WAVEFORM_BAR_CLASSES.map((heightClass, index) => (
                <span key={`${heightClass}-${index}`} className={cx('w-1 rounded-full bg-hf-yellow/80', heightClass)} />
              ))}
            </div>
          </div>
          <audio
            src={usablePath}
            controls
            preload="metadata"
            className="h-9 w-full"
            aria-label={slot.label}
            onError={() => setFailedPath(usablePath)}
          />
        </div>
      ) : usablePath && !isJson ? (
        large ? (
          <>
            <img
              src={usablePath}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-xl"
              onError={() => setFailedPath(usablePath)}
            />
            <img
              src={usablePath}
              alt={slot.label}
              loading="lazy"
              decoding="async"
              className="relative h-full w-full object-contain p-1.5"
              onError={() => setFailedPath(usablePath)}
            />
          </>
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
            <div className="mx-auto mb-2 grid size-9 place-items-center rounded-full border border-modiff-border bg-modiff-bg/70 text-hf-gray">
              <Icon size={compact ? 16 : 19} />
            </div>
            <p className="text-xs font-semibold text-gray-300">
              {path ? 'Preview unavailable' : 'Example generation queued'}
            </p>
            {!compact ? <p className="mt-1 text-xs text-modiff-muted">{slot.placeholder}</p> : null}
          </div>
        </div>
      )}
      {!isAudio && detail ? (
        <span className="absolute left-2 top-2 rounded-full border border-white/10 bg-modiff-bg/75 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
          {slot.label}
        </span>
      ) : null}
    </div>
  );
}

function TemplateStateBadge({ label, status }: { label: string; status: string }) {
  const blocked = status === 'blocked';
  const exact = status === 'exact';
  const reviewed = status === 'reviewed';
  const approved = exact || reviewed;
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-modiff-compact border px-1.5 py-0.5 text-xs font-semibold',
        approved && 'border-modiff-green/70 text-modiff-green',
        blocked && 'border-hf-orange/70 text-hf-orange',
        !approved && !blocked && 'border-modiff-border text-hf-gray',
      )}
    >
      {approved ? <CheckCircle2 size={12} /> : blocked ? <AlertTriangle size={12} /> : <Image size={12} />}
      {label}
    </span>
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
        readiness.tone === 'default' && 'border-modiff-border text-hf-gray',
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
