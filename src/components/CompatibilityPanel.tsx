import WorkflowResourcePanelV2 from './WorkflowResourcePanelV2';
import { AlertTriangle, CheckCircle2, ChevronRight, Download, Gauge, HardDrive, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNodesStore } from '../stores/useNodeStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  advanceWorkflowOperationContext,
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  isWorkflowOperationCancelled,
  useStudioStore,
} from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import {
  controlledArtifactProofNotice,
  fetchAutoResourcePlan,
  formPatchForAutoCandidate,
  selectedAutoCandidate,
  type StudioAutoResourceCandidate,
} from '../studio/autoResource';
import type { StudioResourcePreference } from '../studio/types';
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import { enqueueSnackbar, ModiffButton, ModiffDisclosure, ModiffFieldShell, StudioSelect } from '../ui';

const PREFERENCES: Array<{ value: StudioResourcePreference; label: string }> = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'best_quality', label: 'Best quality' },
  { value: 'faster', label: 'Faster' },
  { value: 'lowest_memory', label: 'Lowest memory' },
];

function repoFor(candidate: StudioAutoResourceCandidate) {
  return candidate.resolvedArtifact || candidate.artifact || candidate.modelRepo || '';
}

function resolutionLabel(candidate: StudioAutoResourceCandidate) {
  const resolved = candidate.artifactResolution?.resolved;
  const format = resolved?.format || candidate.artifactFormat || candidate.quantizationMode || 'native';
  const bits = resolved?.bits ? ` ${resolved.bits}-bit` : '';
  return `${repoFor(candidate)} · ${format}${bits}`;
}

function requirementChips(candidate: StudioAutoResourceCandidate) {
  const requirement = (candidate.requirements?.minimum || candidate.requirements?.lowerMemory) as
    Record<string, unknown> | undefined;
  if (!requirement) return [];
  const gib = 1024 ** 3;
  const output: string[] = [];
  if (typeof requirement.vramBytes === 'number' && requirement.vramBytes > 0) {
    output.push(`${Math.ceil(requirement.vramBytes / gib)} GB VRAM`);
  }
  if (typeof requirement.systemRamBytes === 'number') {
    output.push(`${Math.ceil(requirement.systemRamBytes / gib)} GB RAM`);
  }
  if (typeof requirement.diskFreeBytes === 'number') {
    output.push(`${Math.ceil(requirement.diskFreeBytes / gib)} GB disk`);
  }
  return output;
}

export default function CompatibilityPanel() {
  const [workingRepo, setWorkingRepo] = useState<string | null>(null);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setAlertOpener = useSettingsStore((state) => state.setAlertOpener);
  const sid = useWebsocketStore((state) => state.sid);
  const { installHfModel } = useNodesStore(useShallow((state) => ({ installHfModel: state.installHfModel })));
  const { form, graphBinding, plan, applyAutoResourcePlan, createWorkflowTab, updateForm, setAutoResourcePlan } =
    useStudioStore(
      useShallow((state) => ({
        form: state.form,
        graphBinding: state.graphBinding,
        plan: state.autoResourcePlan,
        applyAutoResourcePlan: state.applyAutoResourcePlan,
        createWorkflowTab: state.createWorkflowTab,
        updateForm: state.updateForm,
        setAutoResourcePlan: state.setAutoResourcePlan,
      })),
    );
  const selected = selectedAutoCandidate(plan, form) || null;
  const controlledProofNotice = controlledArtifactProofNotice(selected, graphBinding?.controlled?.contractIds);
  const alternatives = useMemo(
    () => (plan?.candidates || []).filter((candidate) => candidate.id !== selected?.id),
    [plan?.candidates, selected?.id],
  );

  if (!graphBinding) return <WorkflowResourcePanelV2 />;

  if (!selected) {
    return (
      <div className="grid gap-3 p-4 text-sm text-modiff-text" data-testid="compatibility-panel">
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircle2 size={17} className="text-modiff-green" />
          No model substitution
        </div>
        <p className="text-xs text-modiff-subtle-text">Select a Studio model to inspect local compatibility.</p>
      </div>
    );
  }

  const refreshForPreference = async (preference: StudioResourcePreference) => {
    const context = captureWorkflowOperationContext();
    const nextForm = { ...form, resourcePreference: preference };
    updateForm({ resourcePreference: preference });
    advanceWorkflowOperationContext(context);
    try {
      const nextPlan = await fetchAutoResourcePlan(nextForm);
      assertWorkflowOperationContext(context);
      setAutoResourcePlan(nextPlan);
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(String(error), { variant: 'error' });
    }
  };

  const install = async (candidate: StudioAutoResourceCandidate) => {
    const repo = repoFor(candidate);
    if (!repo) return;
    const context = captureWorkflowOperationContext();
    setWorkingRepo(repo);
    try {
      await installHfModel(repo, sid, { repair: Boolean(candidate.repairRequired) });
      assertWorkflowOperationContext(context);
      enqueueSnackbar(`${repo} is ready. Refreshing compatibility.`, { variant: 'success' });
      const nextPlan = await fetchAutoResourcePlan(useStudioStore.getState().form);
      assertWorkflowOperationContext(context);
      setAutoResourcePlan(nextPlan);
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(error instanceof Error ? error.message : `Could not install ${repo}.`, { variant: 'error' });
    } finally {
      setWorkingRepo(null);
    }
  };

  const requestInstall = (candidate: StudioAutoResourceCandidate) => {
    const repo = repoFor(candidate);
    setAlertOpener({
      title: candidate.repairRequired ? 'Repair artifact?' : 'Install artifact?',
      message: `${repo} will be downloaded and managed by MoDiff.`,
      confirmText: candidate.repairRequired ? 'Repair' : 'Install',
      cancelText: 'Cancel',
      onConfirm: () => {
        setAlertOpener(null);
        void install(candidate);
      },
      onCancel: () => setAlertOpener(null),
    });
  };

  const selectCandidate = async (candidate: StudioAutoResourceCandidate, confirmedCommunityArtifact = '') => {
    const context = captureWorkflowOperationContext();
    try {
      const patch = {
        ...formPatchForAutoCandidate(candidate, form),
        confirmedCommunityArtifact,
      };
      const nextForm = { ...form, ...patch };
      const nextPlan = await fetchAutoResourcePlan(nextForm);
      assertWorkflowOperationContext(context);
      const selectedCandidate = selectedAutoCandidate(nextPlan, nextForm) ?? candidate;
      applyAutoResourcePlan(nextPlan, {
        ...formPatchForAutoCandidate(selectedCandidate, nextForm),
        confirmedCommunityArtifact,
      });
      advanceWorkflowOperationContext(context);
      enqueueSnackbar('Next local option selected.', { variant: 'info' });
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(String(error), { variant: 'error' });
    }
  };

  const choose = (candidate: StudioAutoResourceCandidate) => {
    if (candidate.requiresConfirmation && candidate.proof?.status === 'manual_only') {
      if (!candidate.installed || candidate.repairRequired) {
        requestInstall(candidate);
        return;
      }
      const repo = repoFor(candidate);
      setAlertOpener({
        title: 'Use community artifact?',
        message: `${repo} is popularity-qualified but not quality-qualified by MoDiff. Use it for this workflow and machine?`,
        confirmText: 'Use artifact',
        cancelText: 'Cancel',
        onConfirm: () => {
          setAlertOpener(null);
          void selectCandidate(candidate, repo);
        },
        onCancel: () => setAlertOpener(null),
      });
      return;
    }
    void selectCandidate(candidate);
  };

  const createOptimizedCopyWorkflow = async () => {
    const context = captureWorkflowOperationContext();
    const key = 'modules.ModelArtifact.QuantizeDiffusersComponents';
    let registry = useNodesStore.getState().nodesRegistry;
    if (!registry[key]) {
      await useNodesStore.getState().fetchNodes();
      assertWorkflowOperationContext(context);
      registry = useNodesStore.getState().nodesRegistry;
    }
    const node = createNodeFromRegistry(key, registry, { x: 120, y: 100 });
    if (!node) {
      enqueueSnackbar('The optimized-artifact node is unavailable in this backend.', { variant: 'error' });
      return;
    }
    const source = selected.artifactResolution?.base?.repo || selected.baseArtifact || repoFor(selected);
    createWorkflowTab(`Optimize ${source.split('/').pop() || 'model'}`);
    useFlowStore.getState().addNode(node);
    useFlowStore.getState().setParam(node.id, 'model_id', { source: 'hub', value: source });
    useFlowStore.getState().setParam(node.id, 'source_revision', selected.artifactResolution?.base?.revision || 'main');
    if (selected.pipelineClass) useFlowStore.getState().setParam(node.id, 'pipeline_class', selected.pipelineClass);
    useStudioStore.getState().saveActiveWorkflowTab(true);
    setRightPanelOpen(false);
    enqueueSnackbar('Optimized-copy workflow created. Review its admission and quality settings before running.', {
      variant: 'success',
    });
  };

  const evidence = selected.compatibilityEvidence;
  const reason =
    controlledProofNotice?.message ||
    evidence?.message ||
    selected.reason ||
    selected.skipReason ||
    plan?.blockingReason ||
    'Compatibility was estimated from the current runtime and model metadata.';
  const base = selected.artifactResolution?.base?.repo || selected.baseArtifact || repoFor(selected);
  const substituted = Boolean(selected.artifactResolution?.substituted || (base && base !== repoFor(selected)));

  return (
    <>
      <div className="grid gap-3 p-3 text-sm text-modiff-text" data-testid="compatibility-panel">
        <p className="text-xs text-modiff-subtle-text">
          Automatic memory selects a supported local resource recipe. Custom keeps your configured technical settings.
          Switching preserves the workflow’s nodes, connections and creative controls.
        </p>
        <p className="text-xs text-modiff-subtle-text">
          Auto Offload on a loader controls weight placement. Repeat/Loop controls repeated runs. These are separate
          from Auto resource planning.
        </p>

        <div className="flex items-start gap-2 rounded-modiff-compact border border-hf-yellow/50 bg-hf-yellow/10 p-3">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-hf-yellow" />
          <div className="min-w-0">
            <p className="font-semibold">
              {controlledProofNotice?.label || evidence?.label || selected.healthBadge || 'This should work'}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-modiff-subtle-text">{reason}</p>
          </div>
        </div>

        <ModiffFieldShell label="Recommendation">
          <StudioSelect
            value={form.resourcePreference || 'recommended'}
            onValueChange={(value) => void refreshForPreference(value as StudioResourcePreference)}
            options={PREFERENCES.map((preference) => ({
              value: preference.value,
              label: preference.label,
            }))}
            data-testid="compatibility-preference"
          />
        </ModiffFieldShell>

        <section className="grid gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3">
          {substituted ? (
            <p className="truncate text-xs text-modiff-subtle-text" title={base}>
              Base: {base}
            </p>
          ) : null}
          <p className="break-all font-semibold text-hf-yellow">{resolutionLabel(selected)}</p>
          <div className="flex flex-wrap gap-1.5">
            {requirementChips(selected).map((chip) => (
              <span key={chip} className="rounded bg-modiff-bg px-2 py-1 text-modiff-label text-modiff-subtle-text">
                {chip}
              </span>
            ))}
          </div>
          {selected.installed === false || selected.repairRequired ? (
            <ModiffButton
              icon={<Download size={15} />}
              onClick={() => requestInstall(selected)}
              disabled={workingRepo === repoFor(selected)}
            >
              {selected.repairRequired ? 'Repair artifact' : 'Install in app'}
            </ModiffButton>
          ) : null}
        </section>

        {alternatives.length ? (
          <section className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase text-modiff-subtle-text">Other options</h3>
            {alternatives.map((candidate) => (
              <ModiffButton
                key={candidate.id}
                tone="secondary"
                align="left"
                fullWidth
                className="h-auto p-2"
                onClick={() => choose(candidate)}
                icon={candidate.artifactFormat === 'gguf' ? <HardDrive size={15} /> : <Gauge size={15} />}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{repoFor(candidate)}</span>
                  <span className="block truncate text-modiff-label text-modiff-subtle-text">
                    {candidate.compatibilityEvidence?.label || candidate.healthBadge}
                  </span>
                </span>
                <ChevronRight size={14} className="text-modiff-subtle-text" />
              </ModiffButton>
            ))}
          </section>
        ) : null}

        <ModiffButton icon={<Server size={15} />} onClick={() => setRightPanelTab('setup')}>
          Open setup
        </ModiffButton>
        <ModiffButton icon={<Gauge size={15} />} onClick={() => void createOptimizedCopyWorkflow()}>
          Create optimized copy
        </ModiffButton>

        <ModiffDisclosure
          className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 text-xs"
          label="Evidence and requirements"
          buttonClassName="min-h-0 p-0 text-xs"
          panelClassName="mt-2 grid gap-2 break-words text-modiff-subtle-text"
        >
          <p>{reason}</p>
          {selected.requirementsMissing?.map((item) => (
            <p key={item}>{item}</p>
          ))}
          {evidence?.popularity ? (
            <p>
              Hub snapshot: {evidence.popularity.downloads ?? 0} downloads · {evidence.popularity.likes ?? 0} likes.
              Popularity is not compatibility proof.
            </p>
          ) : null}
        </ModiffDisclosure>
      </div>
    </>
  );
}
