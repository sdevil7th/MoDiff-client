// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  HardDrive,
  KeyRound,
  LoaderCircle,
  Power,
  RefreshCw,
  Settings,
  Trash2,
} from 'lucide-react';

import config from '../../app.config';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import {
  autoPlanKeyForForm,
  autoResourceCompatibility,
  autoResourceHealthBadge,
  autoResourceInstallTarget,
  fetchAutoResourcePlans,
  modelInstallIsReady,
  type StudioAutoResourceInstallTarget,
  type StudioAutoResourcePlan,
} from '../studio/autoResource';
import { getStudioWorkflowArtifactRequirements } from '../studio/artifactRequirements';
import { getRepoCacheStatus, getStudioModelCacheStatus, reviewedExpertInstallTarget } from '../studio/modelCache';
import {
  classifyHfDownloadFailure,
  getDownloadPercent,
  hasHfDownloadFailed,
  isHfDownloadActive,
  isHfDownloadComplete,
} from '../studio/modelInstall';
import {
  getCatalogModelProfiles,
  expandArtifactSelectionProfiles,
  getFormDefaultsForMode,
  getPrimaryModeForProfile,
  getStudioModelRuntimeKind,
  isStudioModelDiffusersBacked,
  STUDIO_MODEL_PROFILES,
} from '../studio/modelProfiles';
import type { FocusedModelManagerTarget, StudioFormState } from '../studio/types';
import { acknowledgementRequiredForRepository, repositoryRequiresHuggingFaceGate } from '../studio/modelUsagePolicies';
import { useModelUsageTermsGate } from '../studio/useModelUsageTerms';
import {
  ModiffButton,
  ModiffDialog,
  ModiffDisclosure,
  ModiffIconButton,
  ModiffInput,
  ModiffPasswordInput,
  ModiffSearchInput,
  ModiffTabs,
  StatusActionChip,
  type StatusActionChipTone,
} from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import { cx } from '../utils/classNames';
import { createLatestRequestGate, formatRequestError, requestJson } from '../utils/requestJson';
import {
  cleanupHfIncompleteFiles,
  deleteHfCacheEntry,
  fetchHfCacheDeletionPlan,
  fetchHfIncompleteCleanupPlan,
  type HfCacheDeletionPlan,
  type HfIncompleteCleanupPlan,
} from '../utils/serverActions';
import { ModelDownloadProgressCard } from './ModelDownloadProgressCard';
import { TemplateUsageTermsDialog } from './TemplateUsageTermsDialog';
import { WorkflowArtifactRequirementRow } from './WorkflowArtifactRequirementRow';

interface Revision {
  hash: string;
  size: number;
  last_modified: number;
}

interface HFModel {
  id: string;
  type: string;
  size: number;
  last_accessed: number;
  revisions: Revision[];
  class_names: string[];
  cached?: boolean;
  installed?: boolean;
  complete?: boolean;
  repair_required?: boolean;
  install_reason?: string;
  active_files?: string[];
}

const fullHfCacheGate = createLatestRequestGate<'fullCache'>();

const inventoryViews = [
  { value: 'all', label: 'All models' },
  { value: 'installed', label: 'Installed' },
  { value: 'supported', label: 'Supported' },
  { value: 'downloads', label: 'Downloads' },
] as const;
type InventoryView = (typeof inventoryViews)[number]['value'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseFullHfCache(value: unknown) {
  if (!Array.isArray(value)) throw new Error('The Hugging Face cache response must be an array.');
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !Array.isArray(item.revisions)) {
      throw new Error(`Hugging Face cache entry ${index + 1} is invalid.`);
    }
    if (item.revisions.some((revision) => !isRecord(revision) || typeof revision.hash !== 'string')) {
      throw new Error(`Hugging Face cache entry ${index + 1} has an invalid revision.`);
    }
    return item as unknown as HFModel;
  });
}

const MODEL_GROUP_ORDER = ['Image', 'Edit', 'Control', 'Video', 'Audio', 'Adapters', 'Components', 'Other'] as const;
type ModelGroup = (typeof MODEL_GROUP_ORDER)[number];
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
  const label = typeof children === 'string' ? children : undefined;
  return (
    <StatusActionChip
      action={
        label === 'Installing'
          ? 'installing'
          : label === 'Retry'
            ? 'retry'
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

function DetailLine({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'success' | 'warning' | 'error';
}) {
  return (
    <p
      className={cx(
        'break-words text-xs leading-5',
        tone === 'muted' && 'text-modiff-subtle-text',
        tone === 'success' && 'text-modiff-green',
        tone === 'warning' && 'text-hf-orange',
        tone === 'error' && 'text-modiff-red',
      )}
    >
      {children}
    </p>
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

function isHfModel(value: unknown): value is HFModel {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'revisions' in value);
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

function groupedItems<T>(items: T[], groupFor: (item: T) => ModelGroup) {
  const groups = new Map<ModelGroup, T[]>();
  MODEL_GROUP_ORDER.forEach((group) => groups.set(group, []));
  items.forEach((item) => groups.get(groupFor(item))?.push(item));
  return MODEL_GROUP_ORDER.map((group) => [group, groups.get(group) ?? []] as const).filter(
    ([, values]) => values.length > 0,
  );
}

function compactHealthBadge(label: string) {
  if (label === 'This should work') return 'Estimated';
  if (label === 'Community option') return 'Community';
  if (label === 'Not suitable locally' || label === 'Will not work on this machine') return 'Blocked';
  if (label === 'Repair required') return 'Repair';
  if (label === 'Failed here before') return 'Failed';
  if (label === 'Expert only') return 'Expert';
  if (label === 'Needs setup') return 'Install';
  if (label === 'Install model' || label === 'Install Auto artifact') return 'Install';
  return label;
}

function runtimeBadgeForProfile(profile: (typeof STUDIO_MODEL_PROFILES)[keyof typeof STUDIO_MODEL_PROFILES]) {
  const runtimeKind = getStudioModelRuntimeKind(profile);
  if (runtimeKind === 'spandrel') return 'Spandrel';
  if (!isStudioModelDiffusersBacked(profile)) return 'Legacy';
  if (runtimeKind === 'diffusers_accelerated') return 'Accelerated';
  return 'Diffusers';
}

function formatFileSize(size: number): string {
  if (size === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(size) / Math.log(1024));
  return `${(size / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function formatTitle(id: unknown) {
  const text = modelItemText(id);
  const parts = text.split('/');
  const name = parts.pop() || text;
  const namespace = parts.join('/');
  return (
    <>
      {namespace ? <span className="text-modiff-subtle-text">{namespace}</span> : null}
      {namespace ? '/' : null}
      <strong>{name}</strong>
    </>
  );
}

function InventorySection({
  children,
  count,
  testId,
  title,
}: {
  children: ReactNode;
  count: number;
  testId: string;
  title: string;
}) {
  return (
    <section className="grid gap-2" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase text-modiff-subtle-text">
        <span>{title}</span>
        <StatusPill tone="default">{count}</StatusPill>
      </div>
      {children}
    </section>
  );
}

function SupportedProfileRow({
  activeInstallCount,
  autoPlan,
  expertMode,
  form,
  focused,
  hfTokenConfigured,
  installProgress,
  onConfigureHfToken,
  onInstall,
  profile,
  status,
}: {
  activeInstallCount: number;
  autoPlan?: StudioAutoResourcePlan;
  expertMode: boolean;
  form: StudioFormState;
  focused?: boolean;
  installProgress: ReturnType<typeof useNodesStore.getState>['hfDownloadProgress'];
  hfTokenConfigured: boolean;
  onConfigureHfToken: (repo: string) => void;
  onInstall: (targetOrRepo: StudioAutoResourceInstallTarget | string, repair?: boolean) => Promise<void>;
  profile: (typeof STUDIO_MODEL_PROFILES)[keyof typeof STUDIO_MODEL_PROFILES];
  status: ReturnType<typeof getStudioModelCacheStatus>;
}) {
  const autoInstallTarget = autoResourceInstallTarget(autoPlan, form);
  const exactExpertInstallTarget = expertMode ? reviewedExpertInstallTarget(profile, status) : null;
  // An Auto plan may identify the same repository without repeating the
  // reviewed Expert row's immutable revision and bounded file manifest. Keep
  // Auto's candidate/reason metadata, but never let that less-specific target
  // turn an exact reviewed install into a moving-branch download.
  const installTarget =
    autoInstallTarget && exactExpertInstallTarget && autoInstallTarget.repo === exactExpertInstallTarget.repo
      ? {
          ...autoInstallTarget,
          repair: exactExpertInstallTarget.repair,
          revision: exactExpertInstallTarget.revision,
          files: exactExpertInstallTarget.files,
        }
      : (autoInstallTarget ?? exactExpertInstallTarget);
  const installRepo = installTarget?.repo ?? profile.defaultRepo;
  const progress = installProgress[installRepo];
  const installing = isHfDownloadActive(progress);
  const failed = hasHfDownloadFailed(progress);
  const accessFailure =
    failed &&
    (progress?.error_code === 'huggingface_access_required' || classifyHfDownloadFailure(progress) === 'access');
  const tokenRequired = accessFailure || (!hfTokenConfigured && repositoryRequiresHuggingFaceGate(installRepo));
  const ready = modelInstallIsReady(status.runnable, autoPlan, form);
  const compatibility = autoResourceCompatibility(autoPlan, form);
  const healthBadge = ready ? 'Ready' : (installTarget?.actionLabel ?? autoResourceHealthBadge(autoPlan, form));
  const blocked =
    !ready &&
    (healthBadge === 'Not suitable locally' ||
      healthBadge === 'Will not work on this machine' ||
      compatibility.state === 'unsuitable');
  const tone: StatusPillTone = ready ? 'success' : blocked ? 'error' : 'warning';
  const actionLabel = accessFailure
    ? 'Review access'
    : tokenRequired
      ? 'Add HF token'
      : ready
        ? 'Ready'
        : installing
          ? 'Installing'
          : failed
            ? 'Retry'
            : compactHealthBadge(installTarget?.actionLabel ?? healthBadge);
  const actionTitle = tokenRequired
    ? accessFailure && progress?.error
      ? progress.error
      : 'This gated Hugging Face repository needs an accepted license and a configured read token.'
    : ready
      ? status.reason
      : failed && progress?.error
        ? progress.error
        : (installTarget?.reason ?? compatibility.detail);
  const canInstall = !tokenRequired && !ready && installTarget && !installing && activeInstallCount < 2;
  const artifactVariantLabel = profile.artifactSelections?.length ? profile.artifactLabel : null;
  const primaryLabel = artifactVariantLabel ?? profile.label;
  // A shared pipeline profile can be hydrated from whichever workflow was
  // encountered last (for example Wan single-image and first/last-frame
  // routes). Do not reuse that workflow label under every artifact row. The
  // immutable repository is the unambiguous secondary identity.
  const artifactRepositoryLabel = artifactVariantLabel ? profile.defaultRepo : null;

  return (
    <article
      className={cx(
        'rounded-modiff-compact border bg-modiff-bg p-2',
        focused ? 'border-hf-yellow/80' : 'border-modiff-border',
      )}
      data-testid={`model-manager-supported-${profile.modelType}`}
      data-model-repo={profile.defaultRepo}
      data-model-manager-focused={focused ? 'true' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-modiff-text" data-testid="model-manager-artifact-label">
            {primaryLabel}
          </div>
          {artifactRepositoryLabel ? (
            <div className="mt-0.5 truncate text-xs text-modiff-subtle-text" title={profile.defaultRepo}>
              {artifactRepositoryLabel}
            </div>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-1">
            <StatusPill tone="default">{profile.surfaceCategory ?? profile.family}</StatusPill>
            <StatusPill tone="default">{runtimeBadgeForProfile(profile)}</StatusPill>
            {profile.catalogVisibility === 'workflowOnly' ? <StatusPill tone="warning">Legacy</StatusPill> : null}
            {installTarget?.repair ? <StatusPill tone="warning">Repair</StatusPill> : null}
          </div>
        </div>
        <StatusPill
          disabled={installing || (!tokenRequired && !ready && !canInstall)}
          onClick={
            tokenRequired
              ? () => onConfigureHfToken(installRepo)
              : canInstall
                ? () => {
                    if (!installTarget) return;
                    void onInstall(installTarget, installTarget.repair);
                  }
                : undefined
          }
          progress={installing ? getDownloadPercent(progress) : null}
          testId={`model-manager-install-${profile.modelType}`}
          title={`${installRepo} | ${actionTitle}`}
          tone={tone}
        >
          {actionLabel}
        </StatusPill>
      </div>
    </article>
  );
}

function ModelManagerDialog({
  opener,
  onClose,
}: {
  onClose: () => void;
  opener: { nodeId: string | null; fieldKey: string | null; focus?: FocusedModelManagerTarget } | null;
}) {
  const { setAlertOpener } = useSettingsStore();
  const studioViewMode = useSettingsStore((state) => state.studioViewMode);
  const sid = useWebsocketStore((state) => state.sid);
  const compactHfCache = useNodesStore((state) => state.hfCache);
  const localModels = useNodesStore((state) => state.localModels);
  const modelCacheDiagnostics = useNodesStore((state) => state.modelCacheDiagnostics);
  const runtimeStatus = useNodesStore((state) => state.runtimeStatus);
  const nodesRegistry = useNodesStore((state) => state.nodesRegistry);
  const studioModelCapabilities = useNodesStore((state) => state.studioModelCapabilities);
  const studioModelCapabilitiesAuthoritative = useNodesStore((state) => state.studioModelCapabilitiesAuthoritative);
  const refreshModelIndexes = useNodesStore((state) => state.refreshModelIndexes);
  const fetchRegistry = useNodesStore((state) => state.fetchRegistry);
  const installHfModel = useNodesStore((state) => state.installHfModel);
  const hfDownloadProgress = useNodesStore((state) => state.hfDownloadProgress);
  const reconcileHfDownloadProgress = useNodesStore((state) => state.reconcileHfDownloadProgress);
  const customModules = useNodesStore((state) => state.customModules);
  const customModuleError = useNodesStore((state) => state.customModuleError);
  const fetchCustomModules = useNodesStore((state) => state.fetchCustomModules);
  const refreshCustomModules = useNodesStore((state) => state.refreshCustomModules);
  const installCustomModule = useNodesStore((state) => state.installCustomModule);
  const updateCustomModule = useNodesStore((state) => state.updateCustomModule);
  const setCustomModuleEnabled = useNodesStore((state) => state.setCustomModuleEnabled);
  const graphNodes = useFlowStore((state) => state.nodes);
  const setNodeUiState = useFlowStore((state) => state.setNodeUiState);
  const studioForm = useStudioStore((state) => state.form);
  const activeTemplateId = useStudioStore((state) => state.activeTemplateId);
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const sourceOutputId = useStudioStore((state) => state.sourceOutputId);
  const autoResourcePlans = useStudioStore((state) => state.autoResourcePlans);
  const setAutoResourcePlans = useStudioStore((state) => state.setAutoResourcePlans);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const pendingRequestsRef = useRef(0);
  const [hfCache, setHfCache] = useState<HFModel[]>([]);
  const [isOpen, setIsOpen] = useState<string[]>([]);
  const [cacheSearch, setCacheSearch] = useState<string>('');
  const [inventoryView, setInventoryView] = useState<InventoryView>('all');
  const inventoryPanelRef = useRef<HTMLDivElement>(null);
  const changeInventoryView = (view: InventoryView) => {
    setInventoryView(view);
    inventoryPanelRef.current?.closest('[data-dialog-scroll-body]')?.scrollTo(0, 0);
  };
  const [customModuleSource, setCustomModuleSource] = useState('');
  const [customModuleName, setCustomModuleName] = useState('');
  const [customModuleAction, setCustomModuleAction] = useState<string | null>(null);
  const [hfTokenEditorOpen, setHfTokenEditorOpen] = useState(false);
  const [hfAccessRepo, setHfAccessRepo] = useState<string | null>(null);
  const [hfToken, setHfToken] = useState('');
  const [hfTokenSaving, setHfTokenSaving] = useState(false);
  const [hfTokenError, setHfTokenError] = useState<string | null>(null);
  const modelUsageTerms = useModelUsageTermsGate();
  const expertMode = studioViewMode === 'expert';
  const focus = opener?.focus;
  const activeInstallCount = Object.values(hfDownloadProgress).filter(isHfDownloadActive).length;
  const visibleDownloads = Object.entries(hfDownloadProgress).filter(
    ([repo, progress]) =>
      (isHfDownloadActive(progress) || hasHfDownloadFailed(progress) || isHfDownloadComplete(progress)) &&
      repo.toLowerCase().includes(cacheSearch.trim().toLowerCase()),
  );
  const missingGraphNodes = graphNodes.filter((node) => {
    if (node.data.type === 'group' || node.data.type === 'loop') return false;
    const key = `${node.data.module}.${node.data.action}`;
    return !nodesRegistry[key];
  });

  const installedItems = useMemo(
    () =>
      uniqueModelItems(
        [
          ...hfCache.map((item) => ({ source: 'HF' as const, item })),
          ...localModels.map((item) => ({ source: 'Local' as const, item })),
        ].filter(({ item }) => {
          const query = cacheSearch.trim().toLowerCase();
          return !query || modelItemText(item).toLowerCase().includes(query);
        }),
      ),
    [cacheSearch, hfCache, localModels],
  );
  const installedGroups = useMemo(
    () => groupedItems(installedItems, ({ item }) => installedModelGroup(item)),
    [installedItems],
  );
  const visibleInstalledGroups = useMemo(
    () => (expertMode ? installedGroups : installedGroups.filter(([group]) => group !== 'Components')),
    [expertMode, installedGroups],
  );
  const allSupportedProfiles = useMemo(() => {
    const profiles = getCatalogModelProfiles({
      currentModelType: focus?.modelType ?? studioForm.modelType,
      includeWorkflowOnly: expertMode,
    }).flatMap((profile) => {
      if (!studioModelCapabilitiesAuthoritative) return [profile];
      const capability = studioModelCapabilities.find((item) => item.modelType === profile.modelType);
      if (!capability) return [profile];
      const merged = {
        ...profile,
        defaultRepo: capability.defaultRepo ?? profile.defaultRepo,
        artifactLabel: capability.artifactLabel ?? profile.artifactLabel,
        executionStatus: capability.executionStatus ?? profile.executionStatus,
        revisionCandidates: capability.revisionCandidates ?? profile.revisionCandidates,
        downloadFiles: capability.downloadFiles ?? profile.downloadFiles,
        artifactSelections: capability.artifactSelections ?? profile.artifactSelections,
        optionalRuntimeRequirement: capability.optionalRuntimeRequirement ?? profile.optionalRuntimeRequirement,
      };
      return expandArtifactSelectionProfiles(merged);
    });
    return profiles.sort((left, right) => {
      if (focus?.modelType === left.modelType) return -1;
      if (focus?.modelType === right.modelType) return 1;
      if (focus?.repo === left.defaultRepo) return -1;
      if (focus?.repo === right.defaultRepo) return 1;
      const leftLabel = String(left.label ?? left.modelType ?? left.defaultRepo ?? '');
      const rightLabel = String(right.label ?? right.modelType ?? right.defaultRepo ?? '');
      return leftLabel.localeCompare(rightLabel);
    });
  }, [
    expertMode,
    focus?.modelType,
    focus?.repo,
    studioForm.modelType,
    studioModelCapabilities,
    studioModelCapabilitiesAuthoritative,
  ]);
  const supportedProfiles = useMemo(() => {
    const query = cacheSearch.trim().toLowerCase();
    return allSupportedProfiles.filter((profile) =>
      `${profile.label} ${profile.defaultRepo} ${profile.family} ${profile.surfaceCategory ?? ''}`
        .toLowerCase()
        .includes(query),
    );
  }, [allSupportedProfiles, cacheSearch]);
  const supportedPlanForms = useMemo(
    () =>
      allSupportedProfiles.map((profile) =>
        getFormDefaultsForMode(getPrimaryModeForProfile(profile), profile.modelType),
      ),
    [allSupportedProfiles],
  );
  const supportedPlanKeys = useMemo(() => supportedPlanForms.map(autoPlanKeyForForm), [supportedPlanForms]);
  const supportedGroups = useMemo(
    () => groupedItems(supportedProfiles, (profile) => supportedModelGroup(profile.surfaceCategory)),
    [supportedProfiles],
  );

  useEffect(() => {
    if (!focus) return;
    const timeout = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-model-manager-focused="true"]')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [focus, supportedProfiles.length]);
  const focusedLabel =
    focus?.label ??
    supportedProfiles.find((profile) => profile.modelType === focus?.modelType || profile.defaultRepo === focus?.repo)
      ?.label ??
    focus?.repo;
  const workflowPlanKey = autoPlanKeyForForm(studioForm);
  const hasWorkflowModelContext = Boolean(focus || activeTemplateId || graphBinding || sourceOutputId);
  const workflowRequirements = useMemo(
    () =>
      hasWorkflowModelContext
        ? getStudioWorkflowArtifactRequirements({
            autoResourcePlan: autoResourcePlans[workflowPlanKey],
            form: studioForm,
            hfCache: compactHfCache,
            includePipeline: false,
            localModels,
            modelCacheDiagnostics,
          })
        : [],
    [
      autoResourcePlans,
      compactHfCache,
      hasWorkflowModelContext,
      localModels,
      modelCacheDiagnostics,
      studioForm,
      workflowPlanKey,
    ],
  );

  const beginLoading = useCallback(() => {
    pendingRequestsRef.current += 1;
    setIsLoading(true);
  }, []);

  const endLoading = useCallback(() => {
    pendingRequestsRef.current = Math.max(0, pendingRequestsRef.current - 1);
    if (pendingRequestsRef.current === 0) setIsLoading(false);
  }, []);

  const fetchHfCache = useCallback(async () => {
    const ticket = fullHfCacheGate.begin('fullCache');
    beginLoading();
    try {
      const data = await requestJson(`${config.serverAddress}/hf_cache`, {
        signal: ticket.signal,
        timeoutMs: 120_000,
        parse: parseFullHfCache,
      });
      if (ticket.isLatest()) setHfCache(data);
    } catch (error) {
      if (ticket.isLatest()) console.error('Error fetching Hugging Face models:', error);
    } finally {
      ticket.finish();
      endLoading();
    }
  }, [beginLoading, endLoading]);

  const refreshAutoPlans = useCallback(async () => {
    const plans = await fetchAutoResourcePlans(supportedPlanForms, supportedPlanKeys);
    const next: Record<string, StudioAutoResourcePlan> = {};
    plans.forEach((plan, index) => {
      const key = plan.planKey ?? supportedPlanKeys[index];
      if (key) next[key] = plan;
    });
    setAutoResourcePlans(next);
  }, [setAutoResourcePlans, supportedPlanForms, supportedPlanKeys]);

  const deleteHfModel = async (hash: string, planHash: string, allowRedownload = false) => {
    beginLoading();
    try {
      await deleteHfCacheEntry(hash, planHash, allowRedownload);
      await fetchHfCache();
    } catch (error) {
      console.error('Error deleting Hugging Face model:', error);
      const message = formatRequestError(error, 'Error deleting Hugging Face model.');
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: message.length * 80 });
    } finally {
      endLoading();
    }
  };

  const deletionBlockerLabel = (blocker: HfCacheDeletionPlan['blockers'][number]) => {
    const workflowId = typeof blocker.workflowId === 'string' ? ` (${blocker.workflowId})` : '';
    switch (blocker.code) {
      case 'graph_execution_active':
        return 'a graph is running';
      case 'graph_execution_queued':
        return 'a graph is queued';
      case 'model_download_active':
        return 'a model download is active';
      case 'template_gallery_install_active':
        return 'the Template Gallery is installing';
      case 'canonical_dependency_open':
        return `template evidence is not turnover-complete${workflowId}`;
      case 'saved_workflow_dependency':
        return `a saved workflow still uses the model${workflowId}`;
      case 'recent_incomplete_download':
        return 'an incomplete file is newer than one hour';
      default:
        return blocker.code.split('_').join(' ');
    }
  };

  const runHfIncompleteCleanup = async (planHash: string) => {
    beginLoading();
    try {
      const result = await cleanupHfIncompleteFiles(planHash);
      const removedFileCount = typeof result.removedFileCount === 'number' ? result.removedFileCount : 0;
      const removedBytes = typeof result.removedBytes === 'number' ? result.removedBytes : 0;
      await fetchHfCache();
      enqueueSnackbar(
        `Removed ${removedFileCount} stale partial file(s), reclaiming ${formatFileSize(removedBytes)}.`,
        {
          variant: 'success',
          autoHideDuration: 5000,
        },
      );
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Could not clean stale Hugging Face downloads.'), {
        variant: 'error',
        autoHideDuration: 7000,
      });
    } finally {
      endLoading();
    }
  };

  const prepareHfIncompleteCleanup = async () => {
    beginLoading();
    try {
      const plan: HfIncompleteCleanupPlan = await fetchHfIncompleteCleanupPlan();
      if (!plan.canCleanup) {
        const blockers = plan.blockers.slice(0, 4).map(deletionBlockerLabel).join('; ');
        const message =
          plan.eligibleFileCount === 0 && !blockers
            ? 'No stale incomplete Hugging Face files are eligible for cleanup.'
            : `Cleanup blocked: ${blockers || 'no stale files are eligible'}.`;
        enqueueSnackbar(message, { variant: 'default', autoHideDuration: 6000 });
        return;
      }
      setAlertOpener({
        title: 'Clean stale partial downloads?',
        message: `Remove ${plan.eligibleFileCount} inactive .incomplete file(s) and reclaim ${formatFileSize(plan.eligibleBytes)}? Only regular blob files older than one hour are included; installed snapshots and model revisions are not removed.`,
        confirmText: 'Clean exact files',
        cancelText: 'Cancel',
        onConfirm: () => {
          setAlertOpener(null);
          void runHfIncompleteCleanup(plan.planHash);
        },
        onCancel: () => setAlertOpener(null),
      });
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Could not inspect stale Hugging Face downloads.'), {
        variant: 'error',
        autoHideDuration: 7000,
      });
    } finally {
      endLoading();
    }
  };

  const prepareHfModelDeletion = async (hash: string, label: string) => {
    beginLoading();
    try {
      let plan = await fetchHfCacheDeletionPlan(hash);
      let allowRedownload = false;
      if (!plan.canDelete) {
        const dependencyCodes = new Set(['canonical_dependency_open', 'saved_workflow_dependency']);
        const onlyRedownloadableDependencies =
          plan.blockers.length > 0 && plan.blockers.every((blocker) => dependencyCodes.has(blocker.code));
        if (!onlyRedownloadableDependencies) {
          const blockers = plan.blockers.slice(0, 4).map(deletionBlockerLabel).join('; ');
          enqueueSnackbar(`Deletion blocked: ${blockers || 'the revision is not turnover-safe'}.`, {
            variant: 'error',
            autoHideDuration: Math.max(7000, blockers.length * 70),
          });
          return;
        }
        plan = await fetchHfCacheDeletionPlan(hash, true);
        allowRedownload = true;
        if (!plan.canDelete) {
          const blockers = plan.blockers.slice(0, 4).map(deletionBlockerLabel).join('; ');
          enqueueSnackbar(`Local eviction blocked: ${blockers || 'the cache state changed'}.`, {
            variant: 'error',
            autoHideDuration: Math.max(7000, blockers.length * 70),
          });
          return;
        }
      }
      const exactTargets = plan.targets
        .map(
          (target) =>
            `${target.repoId}@${target.revision}${target.sizeBytes ? ` (${formatFileSize(target.sizeBytes)})` : ''}`,
        )
        .join(', ');
      const closedDependencies = plan.canonicalDependencies.length;
      const savedDependencies = plan.savedWorkflowDependencies.length;
      setAlertOpener({
        title: allowRedownload ? 'Free local model storage?' : 'Confirm safe model deletion',
        message: allowRedownload
          ? `Evict the local copy of ${label}? Exact cache target: ${exactTargets}. ${closedDependencies} canonical definition${closedDependencies === 1 ? '' : 's'} and ${savedDependencies} saved workflow${savedDependencies === 1 ? '' : 's'} will be kept, but they must download this exact model revision before they can run again.`
          : `Delete ${label}? Exact cache target: ${exactTargets}. ${closedDependencies} canonical workflow ${closedDependencies === 1 ? 'dependency' : 'dependencies'} verified turnover-complete. This action cannot be undone without downloading the model again.`,
        confirmText: allowRedownload ? 'Evict local copy' : 'Delete exact revision',
        cancelText: 'Cancel',
        onConfirm: () => {
          setAlertOpener(null);
          void deleteHfModel(hash, plan.planHash, allowRedownload);
        },
        onCancel: () => setAlertOpener(null),
      });
    } catch (error) {
      const message = formatRequestError(error, 'Could not inspect model dependencies before deletion.');
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: message.length * 80 });
    } finally {
      endLoading();
    }
  };

  const refreshHealth = async (refresh = true) => {
    beginLoading();
    try {
      await Promise.all([fetchHfCache(), refreshModelIndexes(refresh)]);
      await refreshAutoPlans();
      await fetchCustomModules();
      enqueueSnackbar('Models refreshed', { variant: 'success', autoHideDuration: 1800 });
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Could not refresh model health.'), {
        variant: 'error',
        autoHideDuration: 6000,
      });
    } finally {
      endLoading();
    }
  };

  const performInstall = async (targetOrRepo: StudioAutoResourceInstallTarget | string, repair = false) => {
    const target =
      typeof targetOrRepo === 'string' ? { repo: targetOrRepo, label: targetOrRepo, repair } : targetOrRepo;
    try {
      await installHfModel(target.repo, sid, {
        repair: target.repair,
        revision: target.revision,
        files: target.files,
      });
      await Promise.all([fetchHfCache(), refreshModelIndexes(true)]);
      await refreshAutoPlans();
    } catch (error) {
      console.error(error);
    }
  };

  const handleInstall = async (targetOrRepo: StudioAutoResourceInstallTarget | string, repair = false) => {
    const target =
      typeof targetOrRepo === 'string' ? { repo: targetOrRepo, label: targetOrRepo, repair } : targetOrRepo;
    modelUsageTerms.request('install', acknowledgementRequiredForRepository(target.repo, target.revision), () =>
      performInstall(target, target.repair),
    );
  };

  const handleSaveHfToken = async () => {
    const token = hfToken.trim();
    if (!token) {
      setHfTokenError('Paste a Hugging Face read token first.');
      return;
    }
    setHfTokenSaving(true);
    setHfTokenError(null);
    try {
      await requestJson(`${config.serverAddress}/hf_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        timeoutMs: 30_000,
      });
      setHfToken('');
      setHfTokenEditorOpen(false);
      await refreshModelIndexes(true);
      enqueueSnackbar('Hugging Face token saved. Retry the model download.', {
        variant: 'success',
        autoHideDuration: 3500,
      });
    } catch (error) {
      setHfTokenError(formatRequestError(error, 'Could not validate the Hugging Face token.'));
    } finally {
      setHfTokenSaving(false);
    }
  };

  const handleInstallCustomModule = async () => {
    const source = customModuleSource.trim();
    if (!source) {
      enqueueSnackbar('Add a Git URL or local folder path before installing.', {
        variant: 'error',
        autoHideDuration: 3000,
      });
      return;
    }
    setCustomModuleAction('install');
    try {
      const result = await installCustomModule(source, customModuleName.trim() || undefined);
      enqueueSnackbar(result.message || 'Custom module installed', { variant: 'success', autoHideDuration: 2500 });
      setCustomModuleSource('');
      setCustomModuleName('');
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setCustomModuleAction(null);
    }
  };

  const handleRefreshCustomModules = async () => {
    setCustomModuleAction('refresh');
    try {
      const result = await refreshCustomModules();
      enqueueSnackbar(result.message || 'Custom modules refreshed', { variant: 'success', autoHideDuration: 2200 });
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setCustomModuleAction(null);
    }
  };

  const handleUpdateCustomModule = async (name: string) => {
    setCustomModuleAction(`${name}:update`);
    try {
      const result = await updateCustomModule(name);
      enqueueSnackbar(result.message || `${name} updated`, { variant: 'success', autoHideDuration: 2600 });
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setCustomModuleAction(null);
    }
  };

  const handleToggleCustomModule = async (name: string, enabled: boolean) => {
    setCustomModuleAction(`${name}:${enabled ? 'enable' : 'disable'}`);
    try {
      const result = await setCustomModuleEnabled(name, enabled);
      enqueueSnackbar(result.message || `${name} ${enabled ? 'enabled' : 'disabled'}`, {
        variant: 'success',
        autoHideDuration: 2600,
      });
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setCustomModuleAction(null);
    }
  };

  const copyEnvironmentSnapshot = () => {
    const snapshot = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      runtimeStatus,
      modelCacheDiagnostics,
      hfCache: compactHfCache,
      localModels,
      workflow: {
        nodeCount: graphNodes.length,
        missingNodes: missingGraphNodes.map((node) => ({
          id: node.id,
          label: node.data.label,
          module: node.data.module,
          action: node.data.action,
          key: `${node.data.module}.${node.data.action}`,
          disabled: Boolean(node.data.uiState?.disabled),
        })),
      },
    };
    void navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    enqueueSnackbar('Environment snapshot copied', { variant: 'success', autoHideDuration: 1800 });
  };

  const copyMissingNodeKey = (nodeId: string, key: string) => {
    void navigator.clipboard.writeText(`${nodeId}\n${key}`);
    enqueueSnackbar('Missing node key copied', { variant: 'success', autoHideDuration: 1600 });
  };

  const toggleMissingNodeDisabled = (nodeId: string, disabled: boolean) => {
    setNodeUiState(nodeId, {
      disabled,
      validationSeverity: disabled ? 'warning' : undefined,
      validationMessage: disabled ? 'Disabled nodes are skipped during run export.' : undefined,
    });
    enqueueSnackbar(disabled ? 'Node disabled for run export' : 'Node enabled for run export', {
      variant: 'success',
      autoHideDuration: 1800,
    });
  };

  const handleCollapse = (modelId: string) => {
    setIsOpen((current) =>
      current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId],
    );
  };

  const handleOnClose = () => {
    onClose();
    setIsOpen([]);
    setCacheSearch('');
    setInventoryView('all');
    setHfTokenEditorOpen(false);
    setHfToken('');
    setHfTokenError(null);
    setHfCache([]);
    setCustomModuleSource('');
    setCustomModuleName('');
    setCustomModuleAction(null);
  };

  useEffect(() => {
    void fetchHfCache();
    void refreshAutoPlans();
    if (expertMode) void fetchCustomModules();
  }, [expertMode, fetchCustomModules, fetchHfCache, refreshAutoPlans]);

  useEffect(() => {
    if (!opener || activeInstallCount === 0) return;
    let stopped = false;
    const reconcile = async () => {
      try {
        await reconcileHfDownloadProgress();
      } catch (error) {
        if (!stopped) console.info('Could not reconcile active model downloads yet.', error);
      }
    };
    void reconcile();
    const interval = window.setInterval(() => void reconcile(), 2_000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [activeInstallCount, opener, reconcileHfDownloadProgress]);

  return (
    <>
      <ModiffDialog
        open={Boolean(opener)}
        onClose={handleOnClose}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Database size={17} className="shrink-0 text-hf-yellow" />
            <span className="truncate">Models</span>
          </span>
        }
        description="Manage local artifacts and install models from Hugging Face Hub."
        panelClassName="max-w-4xl"
        bodyClassName="!p-0"
        testId="model-manager-dialog"
        toolbar={
          <div className="grid gap-3 p-3" data-testid="model-manager-toolbar">
            <div className="flex flex-wrap items-center gap-2">
              <ModiffSearchInput
                aria-label="Filter models and artifacts"
                className="min-w-0 flex-1 basis-56"
                controlSize="normal"
                placeholder="Search by model, repository or family"
                value={cacheSearch}
                onChange={(event) => setCacheSearch(event.target.value)}
                onClear={() => setCacheSearch('')}
              />
              <ModiffButton
                icon={<KeyRound size={14} />}
                aria-expanded={hfTokenEditorOpen}
                aria-controls="model-manager-token-editor"
                onClick={() => {
                  setHfTokenEditorOpen((open) => !open);
                  setHfToken('');
                  setHfTokenError(null);
                }}
              >
                {runtimeStatus?.config?.hf_token_configured ? 'HF token ready' : 'Add HF token'}
              </ModiffButton>
              <ModiffButton
                loading={isLoading}
                icon={<RefreshCw size={14} />}
                onClick={() => {
                  void refreshHealth(true);
                }}
              >
                Refresh
              </ModiffButton>
            </div>
            <ModiffTabs
              aria-label="Model inventory sections"
              size="dense"
              className="flex-wrap"
              value={inventoryView}
              onValueChange={changeInventoryView}
              options={inventoryViews.map((view) => ({
                ...view,
                label:
                  view.value === 'downloads' && activeInstallCount > 0
                    ? `Downloads (${activeInstallCount})`
                    : view.label,
                id: `model-inventory-tab-${view.value}`,
                controls: `model-inventory-panel-${view.value}`,
              }))}
            />
          </div>
        }
        footer={
          <>
            <span
              className="mr-auto flex items-center text-xs text-modiff-subtle-text"
              role="status"
              aria-live="polite"
            >
              {isLoading
                ? 'Refreshing model inventory…'
                : `${installedItems.length} installed · ${supportedProfiles.length} supported${cacheSearch ? ' matches' : ''}`}
            </span>
            <ModiffButton data-testid="model-manager-close" onClick={handleOnClose}>
              Close
            </ModiffButton>
          </>
        }
      >
        {hfTokenEditorOpen ? (
          <div
            id="model-manager-token-editor"
            className="m-3 grid gap-3 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3"
          >
            <h3 className="text-sm font-semibold text-modiff-text">Hugging Face access</h3>
            <div className="text-xs text-modiff-subtle-text">
              Accept the{' '}
              <a
                className="text-hf-yellow underline underline-offset-2"
                href={hfAccessRepo ? `https://huggingface.co/${hfAccessRepo}` : 'https://huggingface.co/models'}
                target="_blank"
                rel="noreferrer"
              >
                repository terms
              </a>
              , create a{' '}
              <a
                className="text-hf-yellow underline underline-offset-2"
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noreferrer"
              >
                read token
              </a>
              , then paste it below. The token is validated and stored on the backend; it is never returned to the
              browser.
            </div>
            <div className="flex flex-wrap gap-2">
              <ModiffPasswordInput
                aria-label="Hugging Face access token"
                autoFocus
                autoComplete="off"
                value={hfToken}
                onChange={(event) => setHfToken(event.target.value)}
                placeholder="hf_..."
                disabled={hfTokenSaving}
                className="min-w-0 flex-1 basis-56"
              />
              <ModiffButton
                tone="primary"
                disabled={hfTokenSaving || !hfToken.trim()}
                loading={hfTokenSaving}
                icon={<KeyRound size={14} />}
                onClick={() => {
                  void handleSaveHfToken();
                }}
              >
                Save token
              </ModiffButton>
              <ModiffButton
                disabled={hfTokenSaving}
                onClick={() => {
                  setHfTokenEditorOpen(false);
                  setHfToken('');
                  setHfTokenError(null);
                }}
              >
                Cancel
              </ModiffButton>
            </div>
            {hfTokenError ? <DetailLine tone="warning">{hfTokenError}</DetailLine> : null}
          </div>
        ) : null}
        {inventoryViews
          .filter((view) => view.value !== inventoryView)
          .map((view) => (
            <div
              key={view.value}
              id={`model-inventory-panel-${view.value}`}
              role="tabpanel"
              aria-labelledby={`model-inventory-tab-${view.value}`}
              hidden
            />
          ))}
        <div
          ref={inventoryPanelRef}
          className="p-3"
          id={`model-inventory-panel-${inventoryView}`}
          role="tabpanel"
          aria-labelledby={`model-inventory-tab-${inventoryView}`}
        >
          {focusedLabel ? (
            <div
              className="mb-3 flex flex-wrap items-center gap-2 rounded-modiff-compact border border-hf-yellow/70 bg-hf-yellow/10 p-2"
              data-testid="model-manager-focus"
            >
              <StatusPill tone="warning">Focused</StatusPill>
              <span className="min-w-0 truncate text-sm font-semibold text-modiff-text">{focusedLabel}</span>
            </div>
          ) : null}

          {(inventoryView === 'all' || inventoryView === 'downloads') && visibleDownloads.length > 0 ? (
            <section className="mb-3 grid gap-2" data-testid="model-manager-downloads">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase text-modiff-subtle-text">
                <span>Downloads</span>
                <StatusPill tone={activeInstallCount > 0 ? 'warning' : 'default'}>
                  {activeInstallCount} active
                </StatusPill>
              </div>
              {visibleDownloads.map(([repo, progress]) => (
                <ModelDownloadProgressCard
                  key={repo}
                  repoId={repo}
                  progress={progress}
                  compact={!expertMode}
                  testId={`model-manager-download-${repo}`}
                />
              ))}
            </section>
          ) : null}
          {inventoryView === 'downloads' && visibleDownloads.length === 0 ? (
            <div className="grid justify-items-start gap-2 p-3 text-sm text-modiff-subtle-text">
              <Download size={22} aria-hidden="true" />
              <p>
                {cacheSearch
                  ? 'No downloads match this search.'
                  : 'No downloads to show. Choose a model in Supported to install it.'}
              </p>
              {cacheSearch ? (
                <ModiffButton onClick={() => setCacheSearch('')}>Clear search</ModiffButton>
              ) : (
                <ModiffButton onClick={() => changeInventoryView('supported')}>Browse supported models</ModiffButton>
              )}
            </div>
          ) : null}

          <div className="grid gap-4">
            {inventoryView === 'all' && hasWorkflowModelContext && workflowRequirements.length > 0 ? (
              <InventorySection
                count={workflowRequirements.length}
                testId="model-manager-requirements"
                title="Current workflow"
              >
                <div className="grid gap-1">
                  {workflowRequirements.map((requirement) => (
                    <WorkflowArtifactRequirementRow
                      key={requirement.id}
                      activeInstallCount={activeInstallCount}
                      actionTestId={`model-manager-install-requirement-${requirement.id}`}
                      compact={!expertMode}
                      installProgress={hfDownloadProgress}
                      onInstall={(target) => handleInstall(target)}
                      onUseLocal={() => setCacheSearch(requirement.repo.split('/').pop() ?? requirement.repo)}
                      requirement={requirement}
                      testId={`model-manager-requirement-${requirement.id}`}
                    />
                  ))}
                </div>
              </InventorySection>
            ) : null}

            {inventoryView === 'all' || inventoryView === 'installed' ? (
              <InventorySection count={installedItems.length} testId="model-manager-installed" title="Installed">
                {visibleInstalledGroups.length === 0 ? (
                  <div className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3 text-xs text-modiff-subtle-text">
                    {cacheSearch
                      ? 'No installed models match this search.'
                      : isLoading
                        ? 'Reading the model inventory…'
                        : 'No visible model artifacts indexed yet.'}
                    {cacheSearch ? (
                      <ModiffButton className="mt-2" onClick={() => setCacheSearch('')}>
                        Clear search
                      </ModiffButton>
                    ) : null}
                  </div>
                ) : (
                  visibleInstalledGroups.map(([group, items]) => (
                    <div key={group} className="grid gap-1">
                      <div className="px-1 text-xs font-semibold text-modiff-subtle-text">{group}</div>
                      {items.map(({ item, source }) => (
                        <article
                          key={`${source}-${modelItemText(item)}`}
                          className="flex min-h-10 items-center justify-between gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2"
                          title={modelItemText(item)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <HardDrive size={15} className="shrink-0 text-hf-yellow" />
                            <span className="min-w-0 truncate text-sm font-semibold text-modiff-text">
                              {modelItemLabel(item)}
                            </span>
                          </span>
                          <div className="flex flex-none items-center gap-1">
                            {isHfModel(item) ? (
                              <StatusPill tone="default" title={formatFileSize(item.size)}>
                                {formatFileSize(item.size)}
                              </StatusPill>
                            ) : null}
                            <StatusPill tone="success">{source}</StatusPill>
                          </div>
                        </article>
                      ))}
                    </div>
                  ))
                )}
              </InventorySection>
            ) : null}

            {inventoryView === 'all' || inventoryView === 'supported' ? (
              <InventorySection count={supportedProfiles.length} testId="model-manager-supported" title="Supported">
                {supportedGroups.length === 0 ? (
                  <div className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3 text-xs text-modiff-subtle-text">
                    No supported models match the current filter.
                    {cacheSearch ? (
                      <ModiffButton className="mt-2" onClick={() => setCacheSearch('')}>
                        Clear search
                      </ModiffButton>
                    ) : null}
                  </div>
                ) : (
                  supportedGroups.map(([group, profiles]) => (
                    <div key={group} className="grid gap-1">
                      <div className="px-1 text-xs font-semibold text-modiff-subtle-text">{group}</div>
                      {profiles.map((profile) => {
                        const rowForm = getFormDefaultsForMode(getPrimaryModeForProfile(profile), profile.modelType);
                        const planKey = autoPlanKeyForForm(rowForm);
                        const rowPlan = autoResourcePlans[planKey];
                        const rowInstallTarget = autoResourceInstallTarget(rowPlan);
                        return (
                          <SupportedProfileRow
                            key={`${profile.modelType}:${profile.defaultRepo}`}
                            activeInstallCount={activeInstallCount}
                            autoPlan={rowPlan}
                            expertMode={expertMode}
                            form={rowForm}
                            focused={
                              focus?.modelType === profile.modelType ||
                              focus?.repo === profile.defaultRepo ||
                              focus?.repo === rowInstallTarget?.repo
                            }
                            installProgress={hfDownloadProgress}
                            hfTokenConfigured={Boolean(runtimeStatus?.config?.hf_token_configured)}
                            onConfigureHfToken={(repo) => {
                              setHfAccessRepo(repo);
                              setHfTokenEditorOpen(true);
                            }}
                            onInstall={handleInstall}
                            profile={profile}
                            status={getStudioModelCacheStatus(
                              profile,
                              compactHfCache,
                              localModels,
                              modelCacheDiagnostics,
                            )}
                          />
                        );
                      })}
                    </div>
                  ))
                )}
              </InventorySection>
            ) : null}

            {expertMode && inventoryView === 'all' ? (
              <ModiffDisclosure
                className="rounded-modiff-compact border border-modiff-border bg-modiff-panel p-3"
                data-testid="model-manager-diagnostics"
                label={
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Settings size={15} className="text-hf-yellow" />
                      Diagnostics
                    </span>
                    <StatusPill tone="default">Expert</StatusPill>
                  </span>
                }
                buttonClassName="p-0"
                panelClassName="mt-3 grid gap-4"
              >
                <section className="grid gap-2">
                  <div className="flex flex-wrap gap-2">
                    <ModiffButton
                      className="h-8 px-2 text-xs"
                      icon={<RefreshCw size={14} />}
                      onClick={() => {
                        void fetchRegistry();
                      }}
                    >
                      Update registry
                    </ModiffButton>
                    <ModiffButton
                      className="h-8 px-2 text-xs"
                      icon={<Copy size={14} />}
                      onClick={copyEnvironmentSnapshot}
                    >
                      Copy snapshot
                    </ModiffButton>
                  </div>
                </section>

                {modelCacheDiagnostics ? (
                  <section className="grid gap-1">
                    <h3 className="text-xs font-bold uppercase text-modiff-subtle-text">Scanned folders</h3>
                    {modelCacheDiagnostics.locations.map((location) => (
                      <div
                        key={`${location.label}-${location.path}`}
                        className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill
                            tone={!location.exists ? 'error' : location.runnable === false ? 'warning' : 'success'}
                          >
                            {!location.exists ? 'Missing' : location.runnable === false ? 'Not runnable' : 'Indexed'}
                          </StatusPill>
                          <span className="min-w-0 break-all text-xs font-semibold text-modiff-subtle-text">
                            {location.label}: {location.path || 'default'}
                          </span>
                        </div>
                        <DetailLine
                          tone={location.runnable === false ? 'warning' : location.exists ? 'muted' : 'error'}
                        >
                          {location.repo_count ?? location.file_count ?? 0} item(s),{' '}
                          {location.compatible_hf_repo_count ?? 0} compatible HF repo(s),{' '}
                          {location.external_package_count ?? 0} external package(s)
                          {location.reason ? ` | ${location.reason}` : ''}
                        </DetailLine>
                      </div>
                    ))}
                  </section>
                ) : null}

                {(modelCacheDiagnostics?.external_model_packages?.length ?? 0) > 0 ? (
                  <section className="grid gap-1">
                    <h3 className="text-xs font-bold uppercase text-modiff-subtle-text">External packages</h3>
                    {modelCacheDiagnostics?.external_model_packages?.slice(0, 8).map((item) => (
                      <div
                        key={`${item.source}-${item.path}`}
                        className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill tone={item.runnable ? 'success' : 'warning'}>
                            {item.runnable ? 'Compatible' : 'Needs link'}
                          </StatusPill>
                          <span className="min-w-0 break-all text-xs font-semibold text-modiff-subtle-text">
                            {item.label}
                          </span>
                        </div>
                        <DetailLine tone={item.runnable ? 'success' : 'warning'}>
                          {item.format} | {formatFileSize(item.model_file_bytes ?? 0)} | {item.path} | {item.reason}
                        </DetailLine>
                      </div>
                    ))}
                  </section>
                ) : null}

                {(modelCacheDiagnostics?.hf_compatible_external_repos?.length ?? 0) > 0 ? (
                  <section className="grid gap-1">
                    <h3 className="text-xs font-bold uppercase text-modiff-subtle-text">
                      HF-compatible external repos
                    </h3>
                    {modelCacheDiagnostics?.hf_compatible_external_repos?.slice(0, 8).map((item) => {
                      const status = getRepoCacheStatus(
                        item.repo_id,
                        compactHfCache,
                        localModels,
                        modelCacheDiagnostics,
                      );
                      return (
                        <div
                          key={`${item.source}-${item.path}`}
                          className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill tone={status.runnable ? 'success' : 'warning'}>
                              {status.runnable ? 'Runnable' : 'Link needed'}
                            </StatusPill>
                            <span className="min-w-0 break-all text-xs font-semibold text-modiff-subtle-text">
                              {item.repo_id}
                            </span>
                          </div>
                          <DetailLine tone={status.runnable ? 'success' : 'warning'}>
                            {item.path} | {item.reason}
                          </DetailLine>
                        </div>
                      );
                    })}
                  </section>
                ) : null}

                <section className="grid gap-1">
                  <h3 className="text-xs font-bold uppercase text-modiff-subtle-text">Workflow node definitions</h3>
                  {missingGraphNodes.length === 0 ? (
                    <DetailLine tone="success">
                      Every current graph node has a matching backend registry definition.
                    </DetailLine>
                  ) : (
                    missingGraphNodes.slice(0, 8).map((node) => (
                      <div
                        key={node.id}
                        className="rounded-modiff-compact border border-modiff-red/70 bg-modiff-red/10 p-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill tone={node.data.uiState?.disabled ? 'warning' : 'error'}>
                            {node.data.uiState?.disabled ? 'Disabled' : 'Missing'}
                          </StatusPill>
                          <span className="min-w-0 flex-1 break-all text-xs font-semibold text-modiff-subtle-text">
                            {node.data.label || node.id}
                          </span>
                        </div>
                        <DetailLine tone={node.data.uiState?.disabled ? 'warning' : 'error'}>
                          {node.data.module}.{node.data.action}
                        </DetailLine>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <ModiffButton
                            tone="secondary"
                            icon={<Power size={14} />}
                            onClick={() => toggleMissingNodeDisabled(node.id, !node.data.uiState?.disabled)}
                          >
                            {node.data.uiState?.disabled ? 'Enable' : 'Disable'}
                          </ModiffButton>
                          <ModiffButton
                            tone="secondary"
                            icon={<Copy size={14} />}
                            onClick={() => copyMissingNodeKey(node.id, `${node.data.module}.${node.data.action}`)}
                          >
                            Copy key
                          </ModiffButton>
                        </div>
                      </div>
                    ))
                  )}
                </section>

                <section className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-bold uppercase text-modiff-subtle-text">Custom modules</h3>
                    <StatusPill tone={customModules.length > 0 ? 'success' : 'default'}>
                      {customModules.length} module(s)
                    </StatusPill>
                    <ModiffButton
                      className="h-8 px-2 text-xs"
                      disabled={customModuleAction !== null}
                      icon={
                        customModuleAction === 'refresh' ? (
                          <LoaderCircle size={14} className="animate-spin" />
                        ) : (
                          <RefreshCw size={14} />
                        )
                      }
                      onClick={() => {
                        void handleRefreshCustomModules();
                      }}
                    >
                      Refresh
                    </ModiffButton>
                  </div>
                  <div className="grid gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2">
                    <ModiffInput
                      aria-label="Custom module Git URL or local folder path"
                      value={customModuleSource}
                      onChange={(event) => setCustomModuleSource(event.target.value)}
                      placeholder="Git URL or local folder path"
                      disabled={customModuleAction !== null}
                    />
                    <div className="flex flex-wrap gap-2">
                      <ModiffInput
                        aria-label="Custom module folder name"
                        value={customModuleName}
                        onChange={(event) => setCustomModuleName(event.target.value)}
                        placeholder="Folder name (optional)"
                        disabled={customModuleAction !== null}
                        className="min-w-40 flex-1"
                      />
                      <ModiffButton
                        tone="primary"
                        icon={
                          customModuleAction === 'install' ? (
                            <LoaderCircle size={14} className="animate-spin" />
                          ) : (
                            <Download size={14} />
                          )
                        }
                        disabled={customModuleAction !== null || !customModuleSource.trim()}
                        onClick={() => {
                          void handleInstallCustomModule();
                        }}
                      >
                        Install
                      </ModiffButton>
                    </div>
                    <DetailLine tone={customModuleError ? 'warning' : 'muted'}>
                      {customModuleError ||
                        'Installs are limited to the backend custom module folder. Disable moves a module to custom/.disabled instead of deleting it.'}
                    </DetailLine>
                  </div>
                  <div className="grid gap-1">
                    {customModules.length === 0 ? (
                      <DetailLine tone="muted">No custom modules are registered yet.</DetailLine>
                    ) : (
                      customModules.map((module) => {
                        const updateBusy = customModuleAction === `${module.name}:update`;
                        const toggleBusy =
                          customModuleAction === `${module.name}:${module.enabled ? 'disable' : 'enable'}`;
                        return (
                          <div
                            key={`${module.name}-${module.enabled ? 'enabled' : 'disabled'}`}
                            className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusPill tone={module.enabled ? 'success' : 'warning'}>
                                {module.enabled ? 'Enabled' : 'Disabled'}
                              </StatusPill>
                              <StatusPill tone={module.nodeCount > 0 ? 'success' : 'warning'}>
                                {module.nodeCount} node(s)
                              </StatusPill>
                              {module.hasGit ? <StatusPill tone="default">Git</StatusPill> : null}
                              <span className="min-w-0 flex-1 break-all text-xs font-semibold text-modiff-subtle-text">
                                {module.moduleKey}
                              </span>
                            </div>
                            <DetailLine tone={module.enabled && module.nodeCount === 0 ? 'warning' : 'muted'}>
                              {module.path}
                              {module.remote ? ` | ${module.remote}` : ''}
                              {module.branch ? ` | ${module.branch}` : ''}
                            </DetailLine>
                            {module.nodes.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {module.nodes.slice(0, 8).map((nodeName) => (
                                  <span
                                    key={nodeName}
                                    className="rounded-modiff-compact border border-modiff-border bg-modiff-panel px-1.5 py-0.5 text-xs text-modiff-subtle-text"
                                  >
                                    {nodeName}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            <div className="mt-2 flex flex-wrap gap-2">
                              <ModiffButton
                                tone="secondary"
                                icon={
                                  updateBusy ? (
                                    <LoaderCircle size={14} className="animate-spin" />
                                  ) : (
                                    <RefreshCw size={14} />
                                  )
                                }
                                disabled={customModuleAction !== null || !module.canUpdate}
                                onClick={() => {
                                  void handleUpdateCustomModule(module.name);
                                }}
                              >
                                Update
                              </ModiffButton>
                              <ModiffButton
                                tone={module.enabled ? 'danger' : 'secondary'}
                                icon={
                                  toggleBusy ? <LoaderCircle size={14} className="animate-spin" /> : <Power size={14} />
                                }
                                disabled={customModuleAction !== null}
                                onClick={() => {
                                  void handleToggleCustomModule(module.name, !module.enabled);
                                }}
                              >
                                {module.enabled ? 'Disable' : 'Enable'}
                              </ModiffButton>
                              <ModiffButton
                                tone="secondary"
                                icon={<Copy size={14} />}
                                onClick={() => copyMissingNodeKey(module.name, module.moduleKey)}
                              >
                                Copy key
                              </ModiffButton>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                <section className="grid gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase text-modiff-subtle-text">Raw Hugging Face cache</h3>
                    <ModiffButton
                      tone="secondary"
                      size="compact"
                      icon={isLoading ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      disabled={isLoading}
                      onClick={() => {
                        void prepareHfIncompleteCleanup();
                      }}
                    >
                      Clean partial files
                    </ModiffButton>
                  </div>
                  <DetailLine tone="muted">
                    Removes only hash-planned inactive .incomplete blobs older than one hour; installed revisions
                    remain.
                  </DetailLine>
                  {hfCache.length === 0 && !isLoading ? (
                    <DetailLine tone="muted">
                      {cacheSearch ? 'No cache entries match the current filter.' : 'The local cache is empty.'}
                    </DetailLine>
                  ) : (
                    hfCache.map((model) => {
                      if (!isHfModel(model)) {
                        const label = modelItemText(model);
                        return (
                          <article key={label} className="border-b border-modiff-border py-3 last:border-b-0">
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <h4 className="truncate text-sm font-semibold text-modiff-text">
                                  {formatTitle(label)}
                                </h4>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <StatusPill tone="default">Indexed</StatusPill>
                                </div>
                              </div>
                            </div>
                          </article>
                        );
                      }
                      const revisionsOpen = isOpen.includes(model.id);
                      return (
                        <article key={model.id} className="border-b border-modiff-border py-3 last:border-b-0">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <h4 className="truncate text-sm font-semibold text-modiff-text">
                                {formatTitle(model.id)}
                              </h4>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <StatusPill tone="default">{formatFileSize(model.size)}</StatusPill>
                                <StatusPill tone="default">
                                  {new Date(model.last_accessed * 1000).toLocaleDateString()}
                                </StatusPill>
                                {model.class_names.slice(0, 5).map((name) => (
                                  <StatusPill key={name} tone="default">
                                    {name}
                                  </StatusPill>
                                ))}
                              </div>
                              <ModiffButton
                                tone="ghost"
                                size="compact"
                                className="mt-2 px-2 text-xs"
                                onClick={() => handleCollapse(model.id)}
                                icon={revisionsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              >
                                Revisions
                              </ModiffButton>
                            </div>
                            <ModiffIconButton
                              label={`Delete ${model.id}`}
                              disabled={isLoading}
                              className="border border-modiff-red text-modiff-red hover:bg-modiff-red/10 hover:text-modiff-red"
                              onClick={() => {
                                void prepareHfModelDeletion(
                                  model.revisions.map((revision) => revision.hash).join(','),
                                  `${model.id} model`,
                                );
                              }}
                            >
                              <Trash2 size={15} />
                            </ModiffIconButton>
                          </div>
                          {revisionsOpen ? (
                            <div className="mt-2 space-y-1 pl-4">
                              {model.revisions.map((revision) => (
                                <div
                                  key={revision.hash}
                                  className="flex items-center gap-2 text-xs text-modiff-subtle-text"
                                >
                                  <div className="min-w-0 flex-1 break-words">
                                    <strong className="text-modiff-text">{revision.hash.slice(0, 8)}</strong> |{' '}
                                    {new Date(revision.last_modified * 1000).toLocaleString()} |{' '}
                                    {formatFileSize(revision.size)}
                                  </div>
                                  <ModiffIconButton
                                    label={`Delete revision ${revision.hash.slice(0, 8)}`}
                                    disabled={isLoading}
                                    size="compact"
                                    className="border border-modiff-red text-modiff-red hover:bg-modiff-red/10 hover:text-modiff-red"
                                    onClick={() => {
                                      void prepareHfModelDeletion(
                                        revision.hash,
                                        `${revision.hash.slice(0, 8)} revision of ${model.id}`,
                                      );
                                    }}
                                  >
                                    <Trash2 size={13} />
                                  </ModiffIconButton>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  )}
                </section>
              </ModiffDisclosure>
            ) : null}
          </div>
        </div>
      </ModiffDialog>
      <TemplateUsageTermsDialog
        open={Boolean(modelUsageTerms.pending)}
        policies={modelUsageTerms.pending?.policies ?? []}
        action={modelUsageTerms.pending?.action ?? 'install'}
        onCancel={modelUsageTerms.cancel}
        onConfirm={modelUsageTerms.confirm}
      />
    </>
  );
}

export default ModelManagerDialog;
