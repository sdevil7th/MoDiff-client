import { useEffect, useMemo, type ReactNode } from 'react';
import { Download, FolderOpen, FolderSearch, Info, RefreshCw, Settings } from 'lucide-react';
import { useNodesStore } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import {
  getDownloadPercent,
  hasHfDownloadFailed,
  isHfDownloadActive,
  isHfDownloadComplete,
} from '../studio/modelInstall';
import { getStudioModelCacheStatus } from '../studio/modelCache';
import { STUDIO_MODEL_PROFILES } from '../studio/modelProfiles';
import {
  getGraphWorkflowArtifactRequirements,
  getStudioWorkflowArtifactRequirements,
  type WorkflowArtifactRequirement,
} from '../studio/artifactRequirements';
import { inspectStudioGraphBindingDivergence } from '../studio/graphBridge';
import {
  autoPlanIsReady,
  autoPlanKeyForForm,
  autoResourceCompatibility,
  autoResourceHealthBadge,
  autoResourceInstallTarget,
  clearAutoResourceHistory,
  fetchAutoResourcePlans,
  selectedAutoCandidate,
  type StudioAutoResourceInstallTarget,
  type StudioAutoResourcePlan,
} from '../studio/autoResource';
import { inspectCurrentGraph } from '../studio/runReadiness';
import { useRunReadinessIssues } from '../studio/useRunReadinessIssues';
import type {
  GraphInspectionSummary,
  RunReadinessIssue,
  RunReadinessIssueCategory,
  StudioFormState,
  StudioModelProfile,
} from '../studio/types';
import {
  ActionStatusRow,
  IssueCard,
  ModiffButton,
  ModiffDisclosure,
  StatusActionChip,
  type IssueCardTone,
  type StatusActionChipTone,
} from '../ui';
import { cx } from '../utils/classNames';
import { ModelDownloadProgressCard } from './ModelDownloadProgressCard';
import { RuntimeEnvironmentCard } from './RuntimeEnvironmentCard';
import RuntimeOptimizationsCard from './RuntimeOptimizationsCard';
import { WorkflowArtifactRequirementRow } from './WorkflowArtifactRequirementRow';

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatExtensionCounts(counts?: Record<string, number>) {
  if (!counts || Object.keys(counts).length === 0) return 'no files';
  return Object.entries(counts)
    .slice(0, 5)
    .map(([extension, count]) => `${extension}: ${count}`)
    .join(', ');
}

function graphIssueMessage(issue: GraphInspectionSummary['blockingIssues'][number] | null) {
  if (!issue) return '';
  return issue.details ? `${issue.message} ${issue.details}` : issue.message;
}

function graphModelCount(summary: GraphInspectionSummary) {
  return new Set(summary.modelRefs.map((reference) => `${reference.kind}:${reference.value}`)).size;
}

const ISSUE_CATEGORY_ORDER: RunReadinessIssueCategory[] = [
  'environment',
  'package',
  'backend',
  'model_integrity',
  'model',
  'hardware_fit',
  'asset',
  'user_input',
  'graph',
];
const ISSUE_CATEGORY_LABELS: Record<RunReadinessIssueCategory, string> = {
  environment: 'Environment',
  package: 'Packages',
  backend: 'Backend',
  model_integrity: 'Model integrity',
  model: 'Models',
  hardware_fit: 'Hardware fit',
  asset: 'Assets',
  user_input: 'Inputs',
  graph: 'Graph',
};

function issueTone(severity: RunReadinessIssue['severity']): IssueCardTone {
  if (severity === 'success') return 'success';
  if (severity === 'warning') return 'warning';
  if (severity === 'info') return 'info';
  return 'error';
}

function DetailLine({
  children,
  tone = 'muted',
  testId,
}: {
  children: ReactNode;
  tone?: 'muted' | 'success' | 'error' | 'warning';
  testId?: string;
}) {
  return (
    <p
      data-testid={testId}
      className={cx(
        'break-words text-xs leading-5',
        tone === 'muted' && 'text-modiff-subtle-text',
        tone === 'success' && 'text-modiff-green',
        tone === 'error' && 'text-modiff-red',
        tone === 'warning' && 'text-hf-orange',
      )}
    >
      {children}
    </p>
  );
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
  tone: 'success' | 'warning' | 'error' | 'default';
}) {
  const label = typeof children === 'string' ? children : undefined;
  const chipTone: StatusActionChipTone = tone === 'default' ? 'neutral' : tone;
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
      tone={chipTone}
    />
  );
}

export default function ModelSetupPanel() {
  const hfCache = useNodesStore((state) => state.hfCache);
  const localModels = useNodesStore((state) => state.localModels);
  const modelCacheDiagnostics = useNodesStore((state) => state.modelCacheDiagnostics);
  const studioModelCapabilities = useNodesStore((state) => state.studioModelCapabilities);
  const runtimeStatus = useNodesStore((state) => state.runtimeStatus);
  const runtimeError = useNodesStore((state) => state.runtimeError);
  const hfDownloadProgress = useNodesStore((state) => state.hfDownloadProgress);
  const fetchRuntimeStatus = useNodesStore((state) => state.fetchRuntimeStatus);
  const fetchHfCache = useNodesStore((state) => state.fetchHfCache);
  const fetchLocalModels = useNodesStore((state) => state.fetchLocalModels);
  const fetchModelCacheDiagnostics = useNodesStore((state) => state.fetchModelCacheDiagnostics);
  const fetchStudioModelCapabilities = useNodesStore((state) => state.fetchStudioModelCapabilities);
  const installHfModel = useNodesStore((state) => state.installHfModel);
  const form = useStudioStore((state) => state.form);
  const activeTemplateId = useStudioStore((state) => state.activeTemplateId);
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const sourceOutputId = useStudioStore((state) => state.sourceOutputId);
  const graphInspectionSignature = useFlowStore((state) =>
    [
      state.nodes
        .map((node) => {
          const modelParams = Object.entries(node.data.params)
            .filter(([key]) => /repo|model|checkpoint|ckpt|safetensors|lora|vae|controlnet|adapter/i.test(key))
            .map(([key, param]) => `${key}:${JSON.stringify(param.value ?? param.default ?? '')}`)
            .join(',');
          return `${node.id}:${node.data.module}:${node.data.action}:${node.data.uiState?.disabled ? 'disabled' : 'enabled'}:${modelParams}`;
        })
        .join('|'),
      state.edges
        .map(
          (edge) => `${edge.id}:${edge.source}:${edge.sourceHandle ?? ''}->${edge.target}:${edge.targetHandle ?? ''}`,
        )
        .join('|'),
    ].join('||'),
  );
  const autoResourcePlans = useStudioStore((state) => state.autoResourcePlans);
  const setAutoResourcePlans = useStudioStore((state) => state.setAutoResourcePlans);
  const setModelManagerOpener = useSettingsStore((state) => state.setModelManagerOpener);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const showRunIssues = useRunIssueStore((state) => state.showIssues);
  const sid = useWebsocketStore((state) => state.sid);
  const isConnected = useWebsocketStore((state) => state.isConnected);
  const activeInstallCount = Object.values(hfDownloadProgress).filter(isHfDownloadActive).length;
  const visibleDownloads = Object.entries(hfDownloadProgress).filter(
    ([, progress]) => isHfDownloadActive(progress) || hasHfDownloadFailed(progress) || isHfDownloadComplete(progress),
  );
  void graphInspectionSignature;
  const graphInspection = inspectCurrentGraph();
  const hasWorkflowModelContext = Boolean(activeTemplateId || graphBinding || sourceOutputId);
  const graphBindingDivergence = graphBinding ? inspectStudioGraphBindingDivergence(graphBinding) : null;
  const hasCustomGraphContext =
    Boolean(graphBindingDivergence) ||
    (!hasWorkflowModelContext &&
      !graphBinding &&
      (graphInspection.nodeCount > 0 || graphInspection.blockingIssues.length > 0));
  const workflowAutoPlanKey = autoPlanKeyForForm(form);
  const workflowProfile = STUDIO_MODEL_PROFILES[form.modelType];
  const profiles =
    hasWorkflowModelContext && workflowProfile
      ? [
          {
            profile: workflowProfile,
            mode: form.mode,
            status: getStudioModelCacheStatus(workflowProfile, hfCache, localModels, modelCacheDiagnostics),
            backendCapability: studioModelCapabilities.find((item) => item.modelType === workflowProfile.modelType),
            autoPlanKey: workflowAutoPlanKey,
            autoPlan: autoResourcePlans[workflowAutoPlanKey],
          },
        ]
      : [];
  const workflowRequirements =
    hasWorkflowModelContext && workflowProfile
      ? getStudioWorkflowArtifactRequirements({
          autoResourcePlan: autoResourcePlans[workflowAutoPlanKey],
          form,
          hfCache,
          includePipeline: false,
          localModels,
          modelCacheDiagnostics,
        })
      : [];
  const graphArtifactRequirements = hasCustomGraphContext
    ? getGraphWorkflowArtifactRequirements({
        references: graphInspection.modelRefs,
        hfCache,
        localModels,
        modelCacheDiagnostics,
      }).filter((requirement) => !requirement.status.runnable)
    : [];
  const graphBlockingIssue = graphInspection.blockingIssues[0] ?? null;
  const graphModels = graphModelCount(graphInspection);
  const runReadiness = useRunReadinessIssues({ sid, isConnected, includeStudio: !hasCustomGraphContext });
  const currentIssueGroups = useMemo(
    () =>
      ISSUE_CATEGORY_ORDER.map((category) => ({
        category,
        label: ISSUE_CATEGORY_LABELS[category],
        issues: runReadiness.blockingIssues.filter((issue) => issue.category === category),
      })).filter((group) => group.issues.length > 0),
    [runReadiness.blockingIssues],
  );

  const refreshAutoPlans = async () => {
    if (!hasWorkflowModelContext) return;
    const plans = await fetchAutoResourcePlans([form], [workflowAutoPlanKey]);
    const next: Record<string, StudioAutoResourcePlan> = {};
    plans.forEach((plan) => {
      const key = plan.planKey ?? workflowAutoPlanKey;
      if (key) {
        next[key] = plan;
      }
    });
    setAutoResourcePlans(next);
  };

  const refresh = async () => {
    await Promise.all([
      fetchRuntimeStatus(),
      fetchHfCache(true),
      fetchLocalModels(true),
      fetchModelCacheDiagnostics(true),
      fetchStudioModelCapabilities(),
    ]);
    await refreshAutoPlans();
  };

  const openStudio = () => {
    setRightPanelOpen(true);
    setRightPanelTab('studio');
  };

  const openIssueReview = () => {
    showRunIssues(runReadiness.issues);
  };

  const handleIssueInstall = async (repoId: string) => {
    try {
      await installHfModel(repoId, sid);
      await refresh();
    } catch (error) {
      console.error(error);
    }
  };

  const issueAction = (issue: RunReadinessIssue) => {
    if (issue.action === 'install_model' && issue.repoId) {
      return (
        <ModiffButton
          tone="primary"
          icon={<Download size={15} />}
          onClick={() => {
            void handleIssueInstall(issue.repoId!);
          }}
        >
          Install
        </ModiffButton>
      );
    }
    if (issue.action === 'open_model_manager') {
      return (
        <ModiffButton
          icon={<Settings size={15} />}
          onClick={() => setModelManagerOpener({ nodeId: null, fieldKey: null })}
        >
          Models
        </ModiffButton>
      );
    }
    if (issue.action === 'refresh_cache') {
      return (
        <ModiffButton
          icon={<RefreshCw size={15} />}
          onClick={() => {
            void refresh();
          }}
        >
          Refresh
        </ModiffButton>
      );
    }
    if (issue.action === 'select_image') {
      return (
        <ModiffButton icon={<FolderOpen size={15} />} onClick={openStudio}>
          Studio
        </ModiffButton>
      );
    }
    return (
      <ModiffButton icon={<Info size={15} />} onClick={openIssueReview}>
        Review
      </ModiffButton>
    );
  };

  useEffect(() => {
    void fetchRuntimeStatus();
    void fetchStudioModelCapabilities();
  }, [fetchRuntimeStatus, fetchStudioModelCapabilities]);

  useEffect(() => {
    if (!hasWorkflowModelContext) return;
    let cancelled = false;
    void fetchAutoResourcePlans([form], [workflowAutoPlanKey])
      .then((plans) => {
        if (cancelled) return;
        const next: Record<string, StudioAutoResourcePlan> = {};
        plans.forEach((plan) => {
          const key = plan.planKey ?? workflowAutoPlanKey;
          if (key) {
            next[key] = plan;
          }
        });
        setAutoResourcePlans(next);
      })
      .catch((error) => {
        console.error(error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    form,
    hasWorkflowModelContext,
    hfCache.length,
    localModels.length,
    runtimeStatus?.ready,
    setAutoResourcePlans,
    workflowAutoPlanKey,
  ]);

  const handleInstall = async (target: StudioAutoResourceInstallTarget) => {
    try {
      await installHfModel(target.repo, sid, { repair: target.repair });
      await refresh();
    } catch (error) {
      console.error(error);
    }
  };

  const handleClearHistory = async (profile: StudioModelProfile) => {
    try {
      await clearAutoResourceHistory({ modelType: profile.modelType });
      await refreshAutoPlans();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="grid gap-3 p-3 text-sm text-modiff-text" data-testid="setup-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-modiff-text">Model Health</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <ModiffButton
            icon={<Settings size={15} />}
            data-testid="setup-models"
            onClick={() => setModelManagerOpener({ nodeId: null, fieldKey: null })}
          >
            Models
          </ModiffButton>
          <ModiffButton
            icon={<RefreshCw size={15} />}
            data-testid="setup-refresh"
            onClick={() => {
              void refresh();
            }}
          >
            Refresh
          </ModiffButton>
        </div>
      </div>

      <RuntimeEnvironmentCard error={runtimeError} status={runtimeStatus} />
      <RuntimeOptimizationsCard />

      {currentIssueGroups.length > 0 && (
        <section
          className="grid gap-3 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
          data-testid="setup-current-issues"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-modiff-text">Current issues</h3>
            </div>
            <ModiffButton icon={<Info size={15} />} onClick={openIssueReview}>
              Review all
            </ModiffButton>
          </div>
          {currentIssueGroups.map((group) => (
            <div key={group.category} className="grid gap-2">
              <h4 className="text-xs font-bold uppercase text-modiff-subtle-text">
                {group.label} ({group.issues.length})
              </h4>
              <div className="grid gap-2">
                {group.issues.map((issue) => (
                  <ActionStatusRow
                    key={issue.id}
                    tone={issueTone(issue.severity)}
                    title={issue.message}
                    action={issueAction(issue)}
                    testId={`setup-current-issue-${issue.id}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {visibleDownloads.length > 0 && (
        <section
          className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
          data-testid="setup-downloads"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">Downloads</h3>
            <StatusPill
              tone={activeInstallCount > 0 ? 'default' : 'warning'}
              title={`${activeInstallCount} active model download${activeInstallCount === 1 ? '' : 's'}`}
            >
              {activeInstallCount} active
            </StatusPill>
          </div>
          <div className="grid gap-2">
            {visibleDownloads.map(([repo, progress]) => (
              <ModelDownloadProgressCard
                key={repo}
                repoId={repo}
                progress={progress}
                testId={`setup-download-${repo}`}
              />
            ))}
          </div>
        </section>
      )}

      <ModiffDisclosure
        className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
        data-testid="setup-advanced-diagnostics"
        label={
          <span className="flex items-center gap-2">
            <FolderSearch size={15} className="text-hf-yellow" />
            Advanced diagnostics
          </span>
        }
        buttonClassName="p-0"
        panelClassName="mt-3 grid gap-3"
      >
        {hasCustomGraphContext ? (
          <section className="grid gap-2" data-testid="setup-workflow-model-health">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-modiff-text">Current graph</h3>
              <StatusPill tone="default" title="Models referenced by the visible canvas graph are shown here.">
                Contextual
              </StatusPill>
            </div>
            <IssueCard
              tone={graphBlockingIssue || graphArtifactRequirements.length > 0 ? 'error' : 'success'}
              title={graphBlockingIssue ? 'Graph needs attention' : 'Graph model checks'}
              meta={
                graphIssueMessage(graphBlockingIssue) ||
                `${graphInspection.nodeCount} nodes, ${graphInspection.outputPathCount} connected output path${graphInspection.outputPathCount === 1 ? '' : 's'}.`
              }
              testId="setup-current-graph-health"
            >
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <StatusPill
                    tone={graphInspection.outputPathCount > 0 ? 'success' : 'error'}
                    title={`${graphInspection.outputPathCount} connected output path${graphInspection.outputPathCount === 1 ? '' : 's'}.`}
                  >
                    {graphInspection.outputPathCount} outputs
                  </StatusPill>
                  <StatusPill
                    tone={graphArtifactRequirements.length > 0 ? 'warning' : 'success'}
                    title={`${graphModels} detected model reference${graphModels === 1 ? '' : 's'}.`}
                  >
                    {graphModels} models
                  </StatusPill>
                </div>
                {graphArtifactRequirements.length > 0 && (
                  <div className="grid gap-2 border-t border-modiff-border pt-2">
                    {graphArtifactRequirements.map((requirement) => (
                      <WorkflowArtifactRequirementRow
                        key={requirement.id}
                        activeInstallCount={activeInstallCount}
                        actionTestId={`setup-install-graph-requirement-${requirement.id}`}
                        installProgress={hfDownloadProgress}
                        onInstall={(target) => handleInstall(target)}
                        onUseLocal={(requirementItem) =>
                          setModelManagerOpener({
                            nodeId: null,
                            fieldKey: null,
                            focus: {
                              label: requirementItem.label,
                              repo: requirementItem.repo,
                              requirementId: requirementItem.id,
                              source: 'setup',
                            },
                          })
                        }
                        requirement={requirement}
                        testId={`setup-graph-requirement-${requirement.id}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </IssueCard>
          </section>
        ) : hasWorkflowModelContext ? (
          <section className="grid gap-2" data-testid="setup-workflow-model-health">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-modiff-text">Workflow model</h3>
              <StatusPill tone="default" title="Only models used by the current workflow are shown here.">
                Contextual
              </StatusPill>
            </div>
            {profiles.map(({ autoPlan, backendCapability, profile, status }) => (
              <ModelProfileCard
                key={profile.modelType}
                activeInstallCount={activeInstallCount}
                autoPlan={autoPlan}
                form={form}
                backendCapability={backendCapability}
                hfDownloadProgress={hfDownloadProgress}
                onInstall={handleInstall}
                onUseLocal={(requirement) =>
                  setModelManagerOpener({
                    nodeId: null,
                    fieldKey: null,
                    focus: {
                      label: requirement.label,
                      repo: requirement.repo,
                      requirementId: requirement.id,
                      source: 'setup',
                    },
                  })
                }
                onClearHistory={handleClearHistory}
                profile={profile}
                requirements={workflowRequirements}
                status={status}
              />
            ))}
          </section>
        ) : (
          <section
            className="flex items-center gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3 text-xs text-modiff-subtle-text"
            data-testid="setup-workflow-model-empty"
          >
            <Info size={15} className="shrink-0 text-modiff-subtle-text" />
            <span>Workflow model checks appear after you create, update, or restore a workflow.</span>
          </section>
        )}

        {modelCacheDiagnostics && (
          <ModiffDisclosure
            className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3"
            label={
              <span className="flex items-center gap-2">
                <FolderSearch size={15} className="text-hf-yellow" />
                Diagnostics and scanned locations
              </span>
            }
            buttonClassName="p-0"
            panelClassName="mt-3 grid gap-3"
          >
            <section>
              <h3 className="mb-1 text-sm font-bold">Scanned model locations</h3>
              {(modelCacheDiagnostics.locations || []).map((location) => {
                const foundCount = location.repo_count ?? location.file_count ?? 0;
                const foundLabel = location.repo_count !== undefined ? `${foundCount} repos` : `${foundCount} files`;
                const externalBits = [
                  location.external_package_count ? `${location.external_package_count} external packages` : null,
                  location.compatible_hf_repo_count ? `${location.compatible_hf_repo_count} HF-compatible repos` : null,
                  location.model_file_bytes ? `${formatBytes(location.model_file_bytes)} model weights` : null,
                ]
                  .filter(Boolean)
                  .join(' | ');
                return (
                  <div
                    key={`${location.label}-${location.path}`}
                    className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2"
                  >
                    <DetailLine tone={location.exists ? 'muted' : 'warning'}>
                      {location.label}: {location.path || 'default'} | {location.exists ? 'exists' : 'missing'} |{' '}
                      {foundLabel} | {location.runnable === false ? 'discovered but not runnable' : 'runnable'}
                    </DetailLine>
                    {externalBits && (
                      <DetailLine>
                        {externalBits} | {formatExtensionCounts(location.extension_counts)}
                      </DetailLine>
                    )}
                    {location.reason && location.runnable === false && (
                      <DetailLine tone="warning">{location.reason}</DetailLine>
                    )}
                    {location.error && <DetailLine tone="error">{location.error}</DetailLine>}
                  </div>
                );
              })}
            </section>
            {(modelCacheDiagnostics.external_model_packages?.length ?? 0) > 0 && (
              <section data-testid="setup-external-models">
                <h3 className="mb-1 text-sm font-bold">Detected external packages</h3>
                <div className="grid gap-2">
                  {modelCacheDiagnostics.external_model_packages?.slice(0, 8).map((item) => (
                    <IssueCard
                      key={`${item.source}-${item.path}`}
                      tone={item.runnable ? 'success' : 'warning'}
                      title={item.label}
                      meta={`${item.format} | ${item.file_count ?? 0} files | ${formatBytes(item.model_file_bytes)}`}
                    >
                      <DetailLine>{item.path}</DetailLine>
                      <DetailLine tone={item.runnable ? 'success' : 'warning'}>{item.reason}</DetailLine>
                    </IssueCard>
                  ))}
                </div>
              </section>
            )}
            {(modelCacheDiagnostics.hf_compatible_external_repos?.length ?? 0) > 0 && (
              <section data-testid="setup-external-hf-repos">
                <h3 className="mb-1 text-sm font-bold">HF-compatible external repos</h3>
                <div className="grid gap-2">
                  {modelCacheDiagnostics.hf_compatible_external_repos?.slice(0, 8).map((item) => (
                    <IssueCard
                      key={`${item.source}-${item.path}`}
                      tone="warning"
                      title={item.repo_id}
                      meta={item.source}
                    >
                      <DetailLine>{item.path}</DetailLine>
                      <DetailLine tone="warning">{item.reason}</DetailLine>
                    </IssueCard>
                  ))}
                </div>
              </section>
            )}
          </ModiffDisclosure>
        )}
      </ModiffDisclosure>
    </div>
  );
}

function ModelProfileCard({
  activeInstallCount,
  autoPlan,
  form,
  backendCapability,
  hfDownloadProgress,
  onClearHistory,
  onInstall,
  onUseLocal,
  profile,
  requirements,
  status,
}: {
  activeInstallCount: number;
  autoPlan?: StudioAutoResourcePlan;
  form: StudioFormState;
  backendCapability: { modes?: string[]; inpaintContract?: StudioModelProfile['inpaintContract'] } | undefined;
  hfDownloadProgress: ReturnType<typeof useNodesStore.getState>['hfDownloadProgress'];
  onClearHistory: (profile: StudioModelProfile) => Promise<void>;
  onInstall: (target: StudioAutoResourceInstallTarget) => Promise<void>;
  onUseLocal: (requirement: WorkflowArtifactRequirement) => void;
  profile: StudioModelProfile;
  requirements: WorkflowArtifactRequirement[];
  status: ReturnType<typeof getStudioModelCacheStatus>;
}) {
  const autoInstallTarget = autoResourceInstallTarget(autoPlan, form);
  const autoCandidate = selectedAutoCandidate(autoPlan, form);
  const autoReady = autoPlanIsReady(autoPlan, form);
  const ready = autoPlan ? autoReady : status.runnable;
  const installRepo = autoInstallTarget?.repo ?? profile.defaultRepo;
  const progress = hfDownloadProgress[installRepo];
  const installing = isHfDownloadActive(progress);
  const inpaintContract = backendCapability?.inpaintContract ?? profile.inpaintContract;
  const healthBadge = autoResourceHealthBadge(autoPlan, form);
  const compatibility = autoResourceCompatibility(autoPlan, form);
  const tone = ready ? 'success' : compatibility.state === 'unsuitable' ? 'error' : 'warning';
  const pillTone = ready ? 'success' : tone === 'error' ? 'error' : 'warning';
  const meta =
    autoCandidate?.resolvedArtifact ?? autoCandidate?.artifact ?? autoInstallTarget?.repo ?? profile.defaultRepo;
  const primaryActionLabel = ready
    ? healthBadge
    : installing
      ? 'Installing'
      : hasHfDownloadFailed(progress)
        ? 'Retry'
        : (autoInstallTarget?.actionLabel ?? 'Install');
  const primaryActionDisabled = installing || (!ready && activeInstallCount >= 2);

  return (
    <IssueCard
      testId={`setup-model-${profile.modelType}`}
      tone={tone}
      title={profile.label}
      meta={meta}
      action={
        <StatusPill
          tone={pillTone}
          title={ready ? healthBadge : (autoInstallTarget?.reason ?? autoInstallTarget?.repo ?? healthBadge)}
          disabled={primaryActionDisabled}
          progress={installing ? getDownloadPercent(progress) : null}
          testId={`setup-install-${profile.modelType}`}
          onClick={
            !ready && autoInstallTarget
              ? () => {
                  void onInstall(autoInstallTarget);
                }
              : undefined
          }
        >
          {primaryActionLabel}
        </StatusPill>
      }
    >
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-1.5">
          <StatusPill tone={status.runnable ? 'success' : 'warning'} title={status.reason}>
            {status.runnable ? 'Cached' : 'Missing'}
          </StatusPill>
          <StatusPill
            tone={ready ? 'success' : tone === 'error' ? 'error' : 'warning'}
            title={
              autoPlan?.blockingReason ||
              autoCandidate?.reason ||
              autoInstallTarget?.reason ||
              autoPlan?.willNotWorkReason ||
              healthBadge
            }
          >
            Auto
          </StatusPill>
          <StatusPill
            tone={backendCapability ? 'success' : 'warning'}
            title={
              backendCapability
                ? `Backend modes: ${(backendCapability.modes || []).join(', ')}`
                : 'Backend capability metadata not reported for this profile.'
            }
          >
            Backend
          </StatusPill>
          <StatusPill
            tone={
              compatibility.severity === 'success'
                ? 'success'
                : compatibility.severity === 'error'
                  ? 'error'
                  : compatibility.severity === 'info'
                    ? 'default'
                    : 'warning'
            }
            title={`${compatibility.summary} ${compatibility.detail}`}
          >
            Compatibility
          </StatusPill>
          {inpaintContract && (
            <StatusPill
              tone={inpaintContract.available ? 'success' : 'warning'}
              title={inpaintContract.available ? 'Native mask execution available.' : inpaintContract.reason}
            >
              Inpaint
            </StatusPill>
          )}
        </div>
        {status.matchingExternalPackages.length > 0 && (
          <StatusPill
            tone="warning"
            title={`Matching external package: ${status.matchingExternalPackages.slice(0, 3).join(', ')}`}
          >
            External package
          </StatusPill>
        )}
        {status.matchingExternalRepos.length > 0 && (
          <StatusPill
            tone="warning"
            title={`Matching HF-compatible external repo: ${status.matchingExternalRepos.slice(0, 3).join(', ')}`}
          >
            External repo
          </StatusPill>
        )}
        {progress && (
          <ModelDownloadProgressCard
            testId={`setup-download-progress-${profile.modelType}`}
            repoId={installRepo}
            progress={progress}
          />
        )}
        {(autoPlan?.failureHistory?.length ?? 0) > 0 && (
          <div>
            <ModiffButton
              tone="secondary"
              data-testid={`setup-clear-auto-history-${profile.modelType}`}
              onClick={() => {
                void onClearHistory(profile);
              }}
            >
              Clear Auto history
            </ModiffButton>
          </div>
        )}
        {requirements.length > 0 && (
          <div className="grid gap-2 border-t border-modiff-border pt-2">
            {requirements.map((requirement) => (
              <WorkflowArtifactRequirementRow
                key={requirement.id}
                activeInstallCount={activeInstallCount}
                actionTestId={`setup-install-requirement-${requirement.id}`}
                installProgress={hfDownloadProgress}
                onInstall={(target) => onInstall(target)}
                onUseLocal={onUseLocal}
                requirement={requirement}
                testId={`setup-model-requirement-${requirement.id}`}
              />
            ))}
          </div>
        )}
      </div>
    </IssueCard>
  );
}
