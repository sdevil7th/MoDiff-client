import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Boxes,
  ChevronDown,
  Eraser,
  GalleryVerticalEnd,
  HardDrive,
  Image,
  LayoutTemplate,
  LoaderCircle,
  Music,
  PlaySquare,
  Settings,
  Upload,
} from 'lucide-react';
import config from '../../app.config';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { scopedOutputsForWorkflow, useStudioStore } from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { useTaskStore } from '../stores/useTaskStore';
import {
  autoPlanKeyForForm,
  autoResourceCompatibility,
  autoResourceInstallTarget,
  fetchAutoResourcePlans,
  type StudioAutoResourceInstallTarget,
  type StudioAutoResourcePlan,
} from '../studio/autoResource';
import { getStudioWorkflowArtifactRequirements } from '../studio/artifactRequirements';
import { getStudioModelCacheStatus } from '../studio/modelCache';
import {
  getDownloadPercent,
  hasHfDownloadFailed,
  isHfDownloadActive,
  isHfDownloadComplete,
} from '../studio/modelInstall';
import { getCatalogModelProfiles, getFormDefaultsForModel, STUDIO_MODEL_PROFILES } from '../studio/modelProfiles';
import { TEMPLATE_BROWSER_CATEGORIES, templateCategoryId } from '../studio/templateBrowser';
import { STUDIO_TEMPLATES } from '../studio/templates';
import type { StudioImportedAsset, StudioModelProfile } from '../studio/types';
import { ModiffButton, ModiffFileInput, StatusActionChip, type StatusActionChipTone } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import { cx } from '../utils/classNames';
import { uploadBackendFile } from '../utils/backendUpload';
import { WorkflowArtifactRequirementRow } from './WorkflowArtifactRequirementRow';
import { ModelDownloadProgressCard } from './ModelDownloadProgressCard';
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import { cleanupTemporaryMedia } from '../utils/serverActions';
import { inferImportedMediaKind, mediaAcceptString } from '../studio/mediaImport';

function LibraryShell({
  action,
  actionPlacement = 'inline',
  children,
  icon,
  meta,
  title,
}: {
  action?: ReactNode;
  actionPlacement?: 'inline' | 'stacked';
  children: ReactNode;
  icon: ReactNode;
  meta: string;
  title: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-modiff-border bg-modiff-surface px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-modiff-compact border border-modiff-border bg-modiff-bg text-hf-yellow">
              {icon}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-modiff-text">{title}</h2>
              <p className="truncate text-xs text-modiff-subtle-text">{meta}</p>
            </div>
          </div>
          {actionPlacement === 'inline' ? action : null}
        </div>
        {actionPlacement === 'stacked' && action ? <div className="mt-3 min-w-0">{action}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </div>
  );
}

function LibraryCard({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <ModiffButton
        align="left"
        className={cx('h-auto min-h-0 w-full bg-modiff-surface p-3 text-sm font-normal', className)}
        fullWidth
        onClick={onClick}
        tone="secondary"
      >
        {children}
      </ModiffButton>
    );
  }

  return (
    <div
      className={cx(
        'w-full rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3 text-left text-sm text-modiff-text',
        className,
      )}
    >
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2">
      <div className="text-xs font-semibold uppercase text-modiff-subtle-text">{label}</div>
      <div className="mt-1 text-base font-bold text-modiff-text">{value}</div>
    </div>
  );
}

type StatusPillTone = 'success' | 'warning' | 'error' | 'default';

function pillTone(tone: StatusPillTone): StatusActionChipTone {
  if (tone === 'default') return 'neutral';
  return tone;
}

function StatusPill({
  children,
  disabled,
  onClick,
  progress,
  testId,
  title,
  tone,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  progress?: number | null;
  testId?: string;
  title?: string;
  tone: StatusPillTone;
}) {
  const actionLabel = typeof children === 'string' ? children : undefined;
  return (
    <StatusActionChip
      action={
        actionLabel === 'Installing'
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
      tone={pillTone(tone)}
    />
  );
}

function modelItemText(item: unknown) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const model = item as { id?: unknown; repo_id?: unknown; rel_path?: unknown; path?: unknown; label?: unknown };
    return String(model.id ?? model.repo_id ?? model.label ?? model.rel_path ?? model.path ?? JSON.stringify(item));
  }
  return String(item ?? '');
}

function modelItemLabel(item: unknown) {
  const text = modelItemText(item);
  const parts = text.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || text;
}

function uniqueModelItems(items: Array<{ source: 'HF' | 'Local'; item: unknown }>) {
  const seen = new Set<string>();
  return items.filter(({ item, source }) => {
    const key = `${source}:${modelItemText(item).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const MODEL_GROUP_ORDER = ['Image', 'Edit', 'Control', 'Video', 'Audio', 'Adapters', 'Components', 'Other'] as const;
type ModelGroup = (typeof MODEL_GROUP_ORDER)[number];

function supportedModelGroup(category: string | undefined): ModelGroup {
  if (category === 'Audio') return 'Audio';
  if (category === 'Video') return 'Video';
  if (category === 'Control') return 'Control';
  if (category === 'Image Edit') return 'Edit';
  if (category === 'Utility') return 'Adapters';
  if (category === 'Image') return 'Image';
  return 'Other';
}

function installedModelGroup(item: unknown): ModelGroup {
  const text = modelItemText(item).toLowerCase();
  if (
    text.includes('text_encoder') ||
    text.includes('text encoder') ||
    text.includes('vae') ||
    text.includes('tokenizer') ||
    text.includes('transformer') ||
    text.includes('diffusion_model') ||
    text.includes('clip')
  )
    return 'Components';
  if (text.includes('wan') || text.includes('video')) return 'Video';
  if (text.includes('ace') || text.includes('audio')) return 'Audio';
  if (text.includes('control') || text.includes('canny') || text.includes('depth')) return 'Control';
  if (text.includes('lora') || text.includes('adapter')) return 'Adapters';
  if (
    text.includes('edit') ||
    text.includes('inpaint') ||
    text.includes('fill') ||
    text.includes('kontext') ||
    text.includes('redux')
  )
    return 'Edit';
  if (text.includes('image') || text.includes('flux') || text.includes('z-image') || text.includes('qwen'))
    return 'Image';
  return 'Other';
}

type CatalogModelProfile = (typeof STUDIO_MODEL_PROFILES)[keyof typeof STUDIO_MODEL_PROFILES];

const MODEL_REPO_PARAM_CANDIDATES = [
  'repo_id',
  'model_id',
  'repository_id',
  'model',
  'model_name',
  'checkpoint',
  'ckpt_name',
  'path',
];

function normalizedModelText(value: unknown) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

function profileMatchesModelText(profile: CatalogModelProfile, text: string) {
  return [profile.defaultRepo, profile.alternateArtifact, profile.label, profile.displayName, profile.family].some(
    (value) => {
      const normalized = normalizedModelText(value);
      return normalized.length > 0 && (text.includes(normalized) || normalized.includes(text));
    },
  );
}

function profileForInstalledModel(item: unknown) {
  const text = normalizedModelText(modelItemText(item));
  return Object.values(STUDIO_MODEL_PROFILES).find((profile) => profileMatchesModelText(profile, text));
}

type InstalledLoaderCandidate = {
  key: string;
  identityKey?: 'model_type' | 'pipeline_class';
  identity?: string;
};

function loaderCandidatesForModel(item: unknown, capabilities: StudioModelProfile[], authoritative: boolean) {
  const profile = profileForInstalledModel(item);
  const executionProfiles = capabilities.find((item) => item.modelType === profile?.modelType)?.executionProfiles ?? [];
  if (executionProfiles.length > 0) {
    const seen = new Set<string>();
    const candidates = executionProfiles
      .map((execution): InstalledLoaderCandidate => ({
        key: `${execution.loader_module}.${execution.loader_action}`,
        identityKey: execution.loader_action === 'ModelsLoader' ? 'model_type' : 'pipeline_class',
        identity: execution.loader_action === 'ModelsLoader' ? execution.model_type : execution.pipeline_class,
      }))
      .filter((candidate) => {
        const key = `${candidate.key}:${candidate.identityKey}:${candidate.identity}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return candidates;
  }
  if (profile && authoritative) return [];

  const group = profile ? supportedModelGroup(profile.surfaceCategory) : installedModelGroup(item);
  const facade = group === 'Audio' ? 'Audio' : group === 'Video' ? 'Video' : 'Image';
  return [
    { key: `modules.Diffusers${facade}.LoadPipeline` },
    {
      key: 'modules.ModularDiffusers.ModelsLoader',
      ...(profile ? { identityKey: 'model_type' as const, identity: profile.modelType } : {}),
    },
  ];
}

function findNodeParamKey(node: CustomNodeType, candidates: string[]) {
  return candidates.find((candidate) => node.data.params[candidate]);
}

function setNodeParamValue(node: CustomNodeType, fieldKey: string, value: unknown) {
  node.data.params = {
    ...node.data.params,
    [fieldKey]: {
      ...node.data.params[fieldKey],
      value,
    },
  };
}

function modelFieldValue(source: 'HF' | 'Local', node: CustomNodeType, fieldKey: string, value: string) {
  const param = node.data.params[fieldKey];
  const currentValue = param?.value ?? param?.default;
  if (
    param?.display === 'modelselect' ||
    (currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue))
  ) {
    return { source: source === 'Local' ? 'local' : 'hub', value };
  }
  return value;
}

function insertPositionForViewport(viewport: ReturnType<typeof useFlowStore.getState>['viewport'], nodeCount: number) {
  const zoom = viewport.zoom || 1;
  const offset = (nodeCount % 6) * 36;
  return {
    x: (-viewport.x + 220 + offset) / zoom,
    y: (-viewport.y + 140 + offset) / zoom,
  };
}

function groupedItems<T>(items: T[], groupFor: (item: T) => ModelGroup) {
  const groups = new Map<ModelGroup, T[]>();
  MODEL_GROUP_ORDER.forEach((group) => groups.set(group, []));
  items.forEach((item) => groups.get(groupFor(item))?.push(item));
  return MODEL_GROUP_ORDER.map((group) => [group, groups.get(group) ?? []] as const).filter(
    ([, values]) => values.length > 0,
  );
}

function mediaIcon(displayType: string | undefined) {
  if (displayType === 'audio') return <Music size={14} />;
  if (displayType === 'video') return <PlaySquare size={14} />;
  return <Image size={14} />;
}

function importedDisplayType(file: File): StudioImportedAsset['displayType'] {
  return inferImportedMediaKind(file, ['image', 'video', 'audio']) ?? 'unknown';
}

function importedBackendType(displayType: StudioImportedAsset['displayType']) {
  if (displayType === 'audio') return 'audio';
  if (displayType === 'video') return 'videos';
  return 'images';
}

async function uploadImportedAsset(file: File, displayType: StudioImportedAsset['displayType']) {
  const [backendPath] = await uploadBackendFile(file, importedBackendType(displayType));
  if (!backendPath) throw new Error('Imported asset upload did not return a file path.');
  return backendPath;
}

async function importedAssetsFromFiles(files: FileList | null): Promise<StudioImportedAsset[]> {
  if (!files) return [];
  const values = await Promise.all(
    Array.from(files).map(async (file, index): Promise<StudioImportedAsset | null> => {
      const displayType = importedDisplayType(file);
      if (displayType === 'unknown') return null;
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${index}-${file.name}`;
      try {
        const backendPath = await uploadImportedAsset(file, displayType);
        return {
          id,
          kind: 'imported' as const,
          name: file.name,
          url: `${config.serverAddress}/file?file=${encodeURIComponent(backendPath)}`,
          backendPath,
          displayType,
          mimeType: file.type,
          byteSize: file.size,
          createdAt: Date.now() - index,
          source: 'upload' as const,
          storage: 'backend' as const,
        };
      } catch (error) {
        throw new Error(
          `${file.name}: ${error instanceof Error ? error.message : 'The backend could not validate this media file.'}`,
        );
      }
    }),
  );
  return values.filter((asset): asset is StudioImportedAsset => asset !== null);
}

export function TemplateLibraryPanel() {
  const setTemplateBrowserOpen = useSettingsStore((state) => state.setTemplateBrowserOpen);
  const openTemplateBrowser = useSettingsStore((state) => state.openTemplateBrowser);
  const blockedCount = STUDIO_TEMPLATES.filter(
    (template) => template.difficulty === 'blocked' || template.example?.status === 'blocked',
  ).length;
  const readyCount = STUDIO_TEMPLATES.length - blockedCount;
  const categoryCounts = new Map(
    TEMPLATE_BROWSER_CATEGORIES.map((category) => [
      category.id,
      category.id === 'all'
        ? readyCount
        : STUDIO_TEMPLATES.filter(
            (template) =>
              templateCategoryId(template) === category.id &&
              template.difficulty !== 'blocked' &&
              template.example?.status !== 'blocked',
          ).length,
    ]),
  );
  const visibleCategories = TEMPLATE_BROWSER_CATEGORIES.filter(
    (category) =>
      category.id !== 'recommended' && (category.id === 'all' || (categoryCounts.get(category.id) ?? 0) > 0),
  );

  return (
    <LibraryShell
      title="Templates"
      meta={`${readyCount} usable, ${blockedCount} blocked`}
      icon={<LayoutTemplate size={18} />}
      action={
        <ModiffButton
          className="h-8 px-2 text-xs"
          data-testid="left-open-template-browser"
          icon={<LayoutTemplate size={14} />}
          onClick={() => openTemplateBrowser('recommended')}
          tone="primary"
        >
          Browse
        </ModiffButton>
      }
    >
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Templates" value={STUDIO_TEMPLATES.length} />
          <Metric label="Planning" value={blockedCount} />
        </div>
        <LibraryCard className="flex-col items-stretch gap-2" onClick={() => setTemplateBrowserOpen(true)}>
          <div className="flex items-center gap-2 font-semibold">
            <LayoutTemplate size={16} className="text-hf-yellow" />
            Template browser
          </div>
          <p className="text-xs leading-5 text-modiff-subtle-text">
            Search by task, model, inputs, media type, and backend requirement.
          </p>
        </LibraryCard>
        <div className="grid gap-1">
          {visibleCategories.map((category) => (
            <ModiffButton
              key={category.id}
              align="left"
              className="min-h-9 justify-between bg-modiff-bg px-2 font-normal"
              fullWidth
              onClick={() => openTemplateBrowser(category.id)}
              tone="secondary"
            >
              <span className="truncate">{category.label}</span>
              <span className="rounded-modiff-compact border border-modiff-border bg-modiff-surface px-1.5 py-0.5 text-xs font-semibold text-modiff-subtle-text">
                {categoryCounts.get(category.id) ?? 0}
              </span>
            </ModiffButton>
          ))}
        </div>
      </div>
    </LibraryShell>
  );
}

export function AssetsLibraryPanel() {
  const setGalleryLibraryOpen = useSettingsStore((state) => state.setGalleryLibraryOpen);
  const outputs = useStudioStore((state) => state.outputs);
  const importedAssets = useStudioStore((state) => state.importedAssets);
  const addImportedAssets = useStudioStore((state) => state.addImportedAssets);
  const sendImportedAssetToReference = useStudioStore((state) => state.useImportedAssetAsReference);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const taskCount = useTaskStore((state) => state.taskCount);
  const [isCleaning, setIsCleaning] = useState(false);
  const workflowOutputs = useMemo(
    () => scopedOutputsForWorkflow(outputs, activeWorkflowTabId),
    [activeWorkflowTabId, outputs],
  );
  const videoCount = workflowOutputs.filter((output) => output.displayType === 'video').length;
  const audioCount = workflowOutputs.filter((output) => output.displayType === 'audio').length;
  const recentOutputs = workflowOutputs.slice(0, 9);
  const recentImported = importedAssets.slice(0, 6);

  const handleImportFiles = async (files: FileList | null) => {
    try {
      const assets = await importedAssetsFromFiles(files);
      addImportedAssets(assets);
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'The selected media could not be imported.', {
        variant: 'error',
        autoHideDuration: 6000,
      });
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleCleanup = async () => {
    if (isCleaning || taskCount > 0) return;
    setIsCleaning(true);
    try {
      const result = await cleanupTemporaryMedia();
      enqueueSnackbar(
        result.removed.length === 0
          ? 'No unprotected temporary media to clean'
          : `Removed ${result.removed.length} temporary media ${result.removed.length === 1 ? 'file' : 'files'}`,
        { variant: 'success', autoHideDuration: 3000 },
      );
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 6000 });
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <LibraryShell
      title="Assets"
      meta={`${workflowOutputs.length} generated, ${importedAssets.length} imported`}
      icon={<GalleryVerticalEnd size={18} />}
      actionPlacement="stacked"
      action={
        <div className="grid min-w-0 grid-cols-3 gap-1">
          <ModiffFileInput
            ref={importInputRef}
            aria-label="Import assets"
            className="hidden"
            multiple
            onChange={(event) => {
              void handleImportFiles(event.currentTarget.files);
            }}
            accept={mediaAcceptString(['image', 'video', 'audio'])}
          />
          <ModiffButton
            className="h-8 min-w-0 px-1.5 text-xs"
            data-testid="left-clean-temporary-media"
            disabled={isCleaning || taskCount > 0}
            icon={isCleaning ? <LoaderCircle size={14} className="animate-spin" /> : <Eraser size={14} />}
            onClick={() => void handleCleanup()}
            tone="secondary"
            title={taskCount > 0 ? 'Wait for the active generation to finish' : 'Remove unprotected temporary media'}
          >
            Clean
          </ModiffButton>
          <ModiffButton
            className="h-8 min-w-0 px-1.5 text-xs"
            data-testid="left-import-assets"
            icon={<Upload size={14} />}
            onClick={() => importInputRef.current?.click()}
            tone="secondary"
            title="Import local media. Assets are persisted through the backend when connected."
          >
            Import
          </ModiffButton>
          <ModiffButton
            className="h-8 min-w-0 px-1.5 text-xs"
            data-testid="left-open-gallery-library"
            icon={<GalleryVerticalEnd size={14} />}
            onClick={() => setGalleryLibraryOpen(true)}
            tone="primary"
          >
            Open
          </ModiffButton>
        </div>
      }
    >
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Generated" value={workflowOutputs.length} />
          <Metric label="Imported" value={importedAssets.length} />
          <Metric label="Videos" value={videoCount} />
          <Metric label="Audio" value={audioCount} />
        </div>
        <div className="flex items-center justify-between gap-2 px-1 text-xs font-semibold uppercase text-modiff-subtle-text">
          <span>Generated</span>
          <StatusPill tone="default">{workflowOutputs.length}</StatusPill>
        </div>
        <div className="grid grid-cols-3 gap-1" data-testid="left-gallery-thumbnails">
          {recentOutputs.length === 0 ? (
            <div className="col-span-3 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3 text-xs text-modiff-subtle-text">
              No outputs yet.
            </div>
          ) : (
            recentOutputs.map((output, index) => (
              <ModiffButton
                key={output.id}
                data-testid={`left-gallery-output-${index}`}
                title={`${output.modelLabel}${output.prompt ? ` | ${output.prompt}` : ''}`}
                aria-label={`Open gallery item from ${output.modelLabel}`}
                className="aspect-square h-auto min-h-0 overflow-hidden bg-modiff-bg !p-0"
                onClick={() => setGalleryLibraryOpen(true)}
                tone="secondary"
              >
                {output.displayType === 'audio' || output.displayType === 'video' ? (
                  <span className="grid h-full w-full place-items-center text-hf-yellow">
                    {mediaIcon(output.displayType)}
                  </span>
                ) : (
                  <img src={output.url} alt="" className="h-full w-full object-cover" />
                )}
              </ModiffButton>
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-1 text-xs font-semibold uppercase text-modiff-subtle-text">
          <span>Imported</span>
          <StatusPill tone="default">{importedAssets.length}</StatusPill>
        </div>
        <div className="grid grid-cols-3 gap-1" data-testid="left-imported-thumbnails">
          {recentImported.length === 0 ? (
            <ModiffButton
              align="left"
              className="col-span-3 h-auto min-h-0 border-dashed bg-modiff-bg p-3 text-xs text-modiff-subtle-text"
              fullWidth
              onClick={() => importInputRef.current?.click()}
              tone="secondary"
              title="Import local media. Assets are persisted through the backend when connected."
            >
              Import assets
            </ModiffButton>
          ) : (
            recentImported.map((asset, index) => (
              <ModiffButton
                key={asset.id}
                data-testid={`left-imported-asset-${index}`}
                title={asset.name}
                aria-label={`Use imported asset ${asset.name}`}
                className="aspect-square h-auto min-h-0 overflow-hidden bg-modiff-bg !p-0"
                onClick={() => sendImportedAssetToReference(asset)}
                tone="secondary"
              >
                {asset.displayType === 'image' ? (
                  <img src={asset.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full w-full place-items-center text-hf-yellow">
                    {mediaIcon(asset.displayType)}
                  </span>
                )}
              </ModiffButton>
            ))
          )}
        </div>
        <LibraryCard onClick={() => setGalleryLibraryOpen(true)}>
          <div className="flex items-center justify-between gap-2 font-semibold">
            <span className="flex min-w-0 items-center gap-2">
              <Image size={16} className="text-hf-yellow" />
              <span className="truncate">Open gallery</span>
            </span>
            <StatusPill tone="default">{workflowOutputs.length}</StatusPill>
          </div>
        </LibraryCard>
      </div>
    </LibraryShell>
  );
}

export function ModelsLibraryPanel() {
  const hfCache = useNodesStore((state) => state.hfCache);
  const localModels = useNodesStore((state) => state.localModels);
  const modelCacheDiagnostics = useNodesStore((state) => state.modelCacheDiagnostics);
  const hfDownloadProgress = useNodesStore((state) => state.hfDownloadProgress);
  const nodesRegistry = useNodesStore((state) => state.nodesRegistry);
  const studioModelCapabilities = useNodesStore((state) => state.studioModelCapabilities);
  const studioModelCapabilitiesAuthoritative = useNodesStore((state) => state.studioModelCapabilitiesAuthoritative);
  const installHfModel = useNodesStore((state) => state.installHfModel);
  const fetchRuntimeStatus = useNodesStore((state) => state.fetchRuntimeStatus);
  const fetchHfCache = useNodesStore((state) => state.fetchHfCache);
  const fetchLocalModels = useNodesStore((state) => state.fetchLocalModels);
  const fetchModelCacheDiagnostics = useNodesStore((state) => state.fetchModelCacheDiagnostics);
  const setModelManagerOpener = useSettingsStore((state) => state.setModelManagerOpener);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const form = useStudioStore((state) => state.form);
  const activeTemplateId = useStudioStore((state) => state.activeTemplateId);
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const sourceOutputId = useStudioStore((state) => state.sourceOutputId);
  const autoResourcePlans = useStudioStore((state) => state.autoResourcePlans);
  const setAutoResourcePlans = useStudioStore((state) => state.setAutoResourcePlans);
  const sid = useWebsocketStore((state) => state.sid);
  const addNode = useFlowStore((state) => state.addNode);
  const viewport = useFlowStore((state) => state.viewport);
  const nodeCount = useFlowStore((state) => state.nodes.length);
  const [openModelGroups, setOpenModelGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetchRuntimeStatus();
    void fetchHfCache(false);
    void fetchLocalModels(false);
    void fetchModelCacheDiagnostics(false);
  }, [fetchHfCache, fetchLocalModels, fetchModelCacheDiagnostics, fetchRuntimeStatus]);

  const hasWorkflowModelContext = Boolean(activeTemplateId || graphBinding || sourceOutputId);
  const workflowProfile = STUDIO_MODEL_PROFILES[form.modelType];
  const supportedProfiles = useMemo(
    () =>
      getCatalogModelProfiles({
        currentModelType: hasWorkflowModelContext ? form.modelType : null,
        includeWorkflowOnly: true,
      }),
    [form.modelType, hasWorkflowModelContext],
  );
  const supportedPlanForms = useMemo(
    () => supportedProfiles.map((profile) => getFormDefaultsForModel(profile.modelType)),
    [supportedProfiles],
  );
  const supportedPlanKeys = useMemo(
    () => supportedPlanForms.map((planForm) => autoPlanKeyForForm(planForm)),
    [supportedPlanForms],
  );
  const installedItems = useMemo(
    () =>
      uniqueModelItems([
        ...hfCache.map((item) => ({ source: 'HF' as const, item })),
        ...localModels.map((item) => ({ source: 'Local' as const, item })),
      ]),
    [hfCache, localModels],
  );
  const installedGroups = useMemo(
    () => groupedItems(installedItems, ({ item }) => installedModelGroup(item)),
    [installedItems],
  );
  const visibleDownloads = useMemo(
    () =>
      Object.values(hfDownloadProgress)
        .filter(
          (progress) => isHfDownloadActive(progress) || hasHfDownloadFailed(progress) || isHfDownloadComplete(progress),
        )
        .sort(
          (left, right) =>
            (right.updated_at ?? right.completed_at ?? right.started_at ?? 0) -
            (left.updated_at ?? left.completed_at ?? left.started_at ?? 0),
        ),
    [hfDownloadProgress],
  );
  const missingSupportedProfiles = useMemo(
    () =>
      supportedProfiles.filter(
        (profile) => !getStudioModelCacheStatus(profile, hfCache, localModels, modelCacheDiagnostics).runnable,
      ),
    [hfCache, localModels, modelCacheDiagnostics, supportedProfiles],
  );
  const supportedGroups = useMemo(
    () => groupedItems(missingSupportedProfiles, (profile) => supportedModelGroup(profile.surfaceCategory)),
    [missingSupportedProfiles],
  );
  const visibleInstalledGroups = installedGroups;
  const workflowRequirements =
    hasWorkflowModelContext && workflowProfile
      ? getStudioWorkflowArtifactRequirements({
          form,
          autoResourcePlan: autoResourcePlans[autoPlanKeyForForm(form)],
          hfCache,
          localModels,
          modelCacheDiagnostics,
          includePipeline: false,
        })
      : [];

  useEffect(() => {
    if (supportedPlanForms.length === 0) return;
    let cancelled = false;
    void fetchAutoResourcePlans(supportedPlanForms, supportedPlanKeys)
      .then((plans) => {
        if (cancelled) return;
        const next: Record<string, StudioAutoResourcePlan> = {};
        plans.forEach((plan, index) => {
          const key = plan.planKey ?? supportedPlanKeys[index];
          if (key) next[key] = plan;
        });
        setAutoResourcePlans(next);
      })
      .catch((error) => {
        console.error(error);
      });
    return () => {
      cancelled = true;
    };
  }, [setAutoResourcePlans, supportedPlanForms, supportedPlanKeys]);

  const openSetup = () => {
    setRightPanelOpen(true);
    setRightPanelTab('setup');
  };

  const toggleModelGroup = useCallback((group: string) => {
    setOpenModelGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const handleInstall = async (target: StudioAutoResourceInstallTarget) => {
    try {
      await installHfModel(target.repo, sid, {
        repair: target.repair,
        revision: target.revision,
        files: target.files,
      });
    } catch (error) {
      console.error(error);
    }
  };

  const handleInsertInstalledModel = useCallback(
    (item: unknown, source: 'HF' | 'Local') => {
      const modelText = modelItemText(item);
      const candidates = loaderCandidatesForModel(item, studioModelCapabilities, studioModelCapabilitiesAuthoritative);
      const position = insertPositionForViewport(viewport, nodeCount);
      const selected = candidates
        .map((candidate) => ({ candidate, node: createNodeFromRegistry(candidate.key, nodesRegistry, position) }))
        .find(
          ({ candidate, node }) =>
            node &&
            (findNodeParamKey(node, MODEL_REPO_PARAM_CANDIDATES) || findNodeParamKey(node, ['model_type'])) &&
            (!candidate.identityKey || findNodeParamKey(node, [candidate.identityKey])),
        );
      const node = selected?.node;

      if (!node) {
        enqueueSnackbar('No matching loader node is available yet.', { variant: 'error', autoHideDuration: 2800 });
        return;
      }

      const identityKey = selected.candidate.identityKey;
      if (identityKey && selected.candidate.identity) {
        setNodeParamValue(node, identityKey, selected.candidate.identity);
      }

      const modelFieldKey = findNodeParamKey(node, MODEL_REPO_PARAM_CANDIDATES);
      if (modelFieldKey) {
        setNodeParamValue(node, modelFieldKey, modelFieldValue(source, node, modelFieldKey, modelText));
      }

      addNode({ ...node, selected: true });
      enqueueSnackbar(`Added ${modelItemLabel(item)} loader`, { variant: 'success', autoHideDuration: 1800 });
    },
    [addNode, nodeCount, nodesRegistry, studioModelCapabilities, studioModelCapabilitiesAuthoritative, viewport],
  );

  return (
    <LibraryShell
      title="Models"
      meta={`${installedItems.length} installed, ${missingSupportedProfiles.length} available`}
      icon={<Boxes size={18} />}
      action={
        <ModiffButton
          className="h-8 px-2 text-xs"
          data-testid="left-open-model-manager"
          icon={<Settings size={14} />}
          onClick={() => setModelManagerOpener({ nodeId: null, fieldKey: null })}
          tone="primary"
        >
          Models
        </ModiffButton>
      }
    >
      <div className="grid gap-2">
        {visibleDownloads.length > 0 ? (
          <section className="grid gap-1" data-testid="left-model-downloads">
            <div className="flex items-center justify-between gap-2 px-1 text-xs font-semibold uppercase text-modiff-subtle-text">
              <span>Downloads</span>
              <span>{visibleDownloads.filter(isHfDownloadActive).length} active</span>
            </div>
            {visibleDownloads.slice(0, 3).map((progress) => (
              <ModelDownloadProgressCard
                key={progress.repo_id}
                compact
                progress={progress}
                showTechnicalDetails={false}
                testId={`left-model-download-${progress.repo_id}`}
              />
            ))}
            {visibleDownloads.length > 3 ? (
              <ModiffButton tone="ghost" onClick={() => setModelManagerOpener({ nodeId: null, fieldKey: null })}>
                View all {visibleDownloads.length} downloads
              </ModiffButton>
            ) : null}
          </section>
        ) : null}
        {hasWorkflowModelContext && workflowProfile ? (
          <section className="grid gap-1" data-testid="left-model-current">
            <div className="flex items-center justify-between gap-2 px-1 text-xs font-semibold uppercase text-modiff-subtle-text">
              <span>Current</span>
            </div>
            <SupportedModelRow
              autoPlan={autoResourcePlans[autoPlanKeyForForm(form)]}
              installProgress={hfDownloadProgress}
              onInstall={handleInstall}
              onOpenSetup={openSetup}
              profile={workflowProfile}
              status={getStudioModelCacheStatus(workflowProfile, hfCache, localModels, modelCacheDiagnostics)}
            />
            {workflowRequirements.map((requirement) => (
              <WorkflowArtifactRequirementRow
                key={requirement.id}
                actionTestId={`left-install-requirement-${requirement.id}`}
                compact
                installProgress={hfDownloadProgress}
                onInstall={handleInstall}
                onUseLocal={() =>
                  setModelManagerOpener({
                    nodeId: null,
                    fieldKey: null,
                    focus: {
                      repo: requirement.repo,
                      requirementId: requirement.id,
                      label: requirement.label,
                      source: 'workflow',
                    },
                  })
                }
                requirement={requirement}
                testId={`left-model-requirement-${requirement.id}`}
              />
            ))}
          </section>
        ) : null}
        <section className="grid gap-1" data-testid="left-model-installed">
          <div className="px-1 text-xs font-semibold uppercase text-modiff-subtle-text">
            Installed ({installedItems.length})
          </div>
          {installedItems.length === 0 || visibleInstalledGroups.length === 0 ? (
            <div className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3 text-xs text-modiff-subtle-text">
              No visible model artifacts indexed yet.
            </div>
          ) : (
            visibleInstalledGroups.map(([group, items]) => {
              const groupId = `installed:${group}`;
              const isOpen = openModelGroups.has(groupId);
              return (
                <div key={group} className="rounded-modiff-compact border border-modiff-border bg-modiff-bg">
                  <ModiffButton
                    align="left"
                    className="min-h-9 justify-between rounded-none border-0 bg-transparent px-2"
                    fullWidth
                    tone="ghost"
                    onClick={() => toggleModelGroup(groupId)}
                  >
                    <span className="truncate">{group}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-modiff-subtle-text">
                      {items.length}
                      <ChevronDown size={15} className={cx('transition-transform', isOpen && 'rotate-180')} />
                    </span>
                  </ModiffButton>
                  {isOpen ? (
                    <div className="grid gap-1 border-t border-modiff-border p-1">
                      {items.map(({ item, source }) => (
                        <ModiffButton
                          align="left"
                          fullWidth
                          key={`${source}-${modelItemText(item)}`}
                          title={modelItemText(item)}
                          onClick={() => handleInsertInstalledModel(item, source)}
                          className="min-h-10 justify-between bg-modiff-bg p-2 font-normal"
                          tone="secondary"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <HardDrive size={15} className="shrink-0 text-modiff-subtle-text" />
                            <span className="min-w-0 truncate text-sm font-semibold text-modiff-text">
                              {modelItemLabel(item)}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-modiff-subtle-text">{source}</span>
                        </ModiffButton>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </section>
        {missingSupportedProfiles.length > 0 ? (
          <section className="grid gap-1" data-testid="left-model-supported">
            <div className="px-1 text-xs font-semibold uppercase text-modiff-subtle-text">
              Available ({missingSupportedProfiles.length})
            </div>
            {supportedGroups.map(([group, profiles]) => {
              const groupId = `available:${group}`;
              const isOpen = openModelGroups.has(groupId);
              return (
                <div key={group} className="rounded-modiff-compact border border-modiff-border bg-modiff-bg">
                  <ModiffButton
                    align="left"
                    className="min-h-9 justify-between rounded-none border-0 bg-transparent px-2"
                    fullWidth
                    onClick={() => toggleModelGroup(groupId)}
                    tone="ghost"
                  >
                    <span className="truncate">{group}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-modiff-subtle-text">
                      {profiles.length}
                      <ChevronDown size={15} className={cx('transition-transform', isOpen && 'rotate-180')} />
                    </span>
                  </ModiffButton>
                  {isOpen ? (
                    <div className="grid gap-1 border-t border-modiff-border p-1">
                      {profiles.map((profile) => {
                        const planKey = autoPlanKeyForForm(getFormDefaultsForModel(profile.modelType));
                        return (
                          <SupportedModelRow
                            key={profile.modelType}
                            autoPlan={autoResourcePlans[planKey]}
                            installProgress={hfDownloadProgress}
                            onInstall={handleInstall}
                            onOpenSetup={openSetup}
                            profile={profile}
                            status={getStudioModelCacheStatus(profile, hfCache, localModels, modelCacheDiagnostics)}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}
      </div>
    </LibraryShell>
  );
}

function SupportedModelRow({
  autoPlan,
  installProgress,
  onInstall,
  onOpenSetup,
  profile,
  status,
}: {
  autoPlan?: StudioAutoResourcePlan;
  installProgress: ReturnType<typeof useNodesStore.getState>['hfDownloadProgress'];
  onInstall: (target: StudioAutoResourceInstallTarget) => Promise<void>;
  onOpenSetup: () => void;
  profile: (typeof STUDIO_MODEL_PROFILES)[keyof typeof STUDIO_MODEL_PROFILES];
  status: ReturnType<typeof getStudioModelCacheStatus>;
}) {
  const installTarget = autoResourceInstallTarget(autoPlan) ?? {
    repo: profile.defaultRepo,
    label: profile.label,
    actionLabel: 'Install',
  };
  const progress = installProgress[installTarget.repo];
  const compatibility = autoResourceCompatibility(autoPlan);
  const installing =
    progress?.status === 'queued' || progress?.status === 'running' || progress?.status === 'downloading';
  const blocked = compatibility.state === 'unsuitable' && !status.runnable;
  const tone = blocked ? 'error' : 'warning';
  const statusLabel = installing ? 'Installing' : (installTarget.actionLabel ?? 'Install');
  const statusTitle = installTarget.reason || `Install ${installTarget.repo}`;

  return (
    <div
      data-testid={`left-model-${profile.modelType}`}
      className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2"
    >
      <div className="flex items-start justify-between gap-2">
        <ModiffButton
          align="left"
          className="h-auto min-h-0 min-w-0 flex-1 bg-transparent p-0 font-normal"
          tone="ghost"
          title={`${profile.defaultRepo} | ${compatibility.summary} | ${compatibility.detail}`}
          onClick={onOpenSetup}
        >
          <div className="truncate text-sm font-semibold text-modiff-text">{profile.label}</div>
          <div className="mt-0.5 truncate text-xs text-modiff-subtle-text">{profile.family}</div>
        </ModiffButton>
        {!status.runnable && (
          <StatusPill
            tone={tone}
            testId={`left-install-${profile.modelType}`}
            title={statusTitle}
            disabled={installing}
            progress={installing ? getDownloadPercent(progress) : null}
            onClick={() => {
              void onInstall(installTarget);
            }}
          >
            {statusLabel}
          </StatusPill>
        )}
      </div>
    </div>
  );
}
