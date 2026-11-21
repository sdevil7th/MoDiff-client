import { useEffect, useState } from 'react';
import { flowExecutionScopeSourceKey, useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { inspectWorkflowSetup, workflowSetupArtifacts, workflowSetupDownload } from '../studio/workflowSetup';
import { isHfDownloadActive, formatDownloadBytes } from '../studio/modelInstall';
import { formatRequestError } from '../utils/requestJson';
import { ModiffButton, ModiffSelect, enqueueSnackbar } from '../ui';
import type { StudioAutoResourceInstallTarget } from '../studio/autoResource';
import { RuntimeEnvironmentCard } from './RuntimeEnvironmentCard';
import RuntimeOptimizationsCard from './RuntimeOptimizationsCard';
import { WorkflowArtifactRequirementRow } from './WorkflowArtifactRequirementRow';

type Inspection = Awaited<ReturnType<typeof inspectWorkflowSetup>>;

export default function WorkflowSetupChecklist({
  onInstall,
}: {
  onInstall: (target: StudioAutoResourceInstallTarget) => Promise<void>;
}) {
  const nodes = useFlowStore((state) => state.nodes);
  const sourceKey = useFlowStore((state) => flowExecutionScopeSourceKey(state.nodes, state.edges));
  const workflowId = useStudioStore((state) => state.activeWorkflowTabId);
  const resourceMode = useStudioStore((state) => state.form.resourceMode);
  const instance = useNodesStore((state) => state.instance);
  const runtime = useNodesStore((state) => state.runtimeStatus);
  const requests = useNodesStore((state) => state.discoveryRequests);
  const runtimeError = useNodesStore((state) => state.runtimeError);
  const optionalCatalog = useNodesStore((state) => state.optionalRuntimeCatalog);
  const downloads = useNodesStore((state) => state.hfDownloadProgress);
  const hfCache = useNodesStore((state) => state.hfCache);
  const localModels = useNodesStore((state) => state.localModels);
  const diagnostics = useNodesStore((state) => state.modelCacheDiagnostics);
  const openModels = useSettingsStore((state) => state.setModelManagerOpener);
  const [target, setTarget] = useState('');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; value?: Inspection; error?: string }>();
  const key = JSON.stringify([sourceKey, workflowId, resourceMode, instance, target, revision, optionalCatalog]);
  const hasGraph = nodes.some((node) => node.data.module && node.data.action && !node.data.uiState?.disabled);
  useEffect(() => {
    setTarget('');
  }, [workflowId]);
  useEffect(() => {
    if (!hasGraph || !instance) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void inspectWorkflowSetup(target || undefined, controller.signal).then(
        (value) => {
          if (!controller.signal.aborted) setResult({ key, value });
        },
        (error) => {
          if (!controller.signal.aborted)
            setResult({ key, error: formatRequestError(error, 'Could not inspect workflow setup.') });
        },
      );
    }, 100);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [hasGraph, instance, key, target]);
  const current = result?.key === key ? result : undefined;
  const inspection = current?.value;
  // Cache observations can change without changing the immutable graph inspection.
  void [hfCache, localModels, diagnostics];
  const indexesReady = requests.hfCache.status === 'success' && requests.localModels.status === 'success';
  const artifacts = inspection && indexesReady ? workflowSetupArtifacts(inspection.graph) : [];
  const required = inspection?.observation.requirements.filter((row) => row.requirement.requiredNow) ?? [];
  const profileIds = [...new Set(required.flatMap((row) => row.requirement.profileIds))];
  const runtimeChecking = requests.runtime.status === 'idle' || requests.runtime.status === 'loading';
  const baseReady =
    requests.runtime.status === 'success' &&
    runtime?.ready === true &&
    runtime.runtimeEnvironment.profileVerified &&
    runtime.runtimeEnvironment.executionReady &&
    ['transformers', 'peft'].every((name) => runtime.packages?.[name]?.available === true);
  const online =
    requests.runtime.status === 'success' && ['Online', 'Auto'].includes(runtime?.config?.hf_online_status ?? '');
  const baseLibraries = ['transformers', 'peft']
    .map((name) => {
      const item = runtime?.packages?.[name];
      return `${name === 'peft' ? 'PEFT' : 'Transformers'}: ${item?.available ? (item.version ?? 'present; version not reported') : 'not verified'}`;
    })
    .join(' · ');
  return (
    <section
      className="grid gap-3 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
      aria-label="Workflow setup checklist"
      data-testid="workflow-setup-checklist"
    >
      <h3 className="font-bold">Workflow setup checklist</h3>
      <p className="text-xs text-modiff-subtle-text">
        Uses the same enabled execution scope as Run. Inspection installs nothing. Model fit, graph inputs and
        custom-code approval are checked separately at Run.
      </p>
      <ModiffSelect
        aria-label="Workflow setup scope"
        value={target}
        onValueChange={setTarget}
        options={[
          { value: '', label: 'Whole workflow' },
          ...nodes
            .filter(
              (node) =>
                !node.hidden &&
                !node.data.uiState?.disabled &&
                (node.data.blockInstanceV2 || (node.data.module && node.data.action)),
            )
            .map((node) => ({
              value: node.id,
              label: `${node.data.blockInstanceV2 ? 'Run Block' : 'Run through'}: ${node.data.label || node.id}`,
            })),
        ]}
      />
      <div className="grid gap-1" role="group" aria-label="Base environment">
        <h4 className="text-sm font-semibold">
          1. Base environment — {runtimeChecking ? 'Checking…' : baseReady ? 'Verified' : 'Needs verification'}
        </h4>
        <p className="text-xs">{runtimeChecking ? 'Checking installed libraries and app readiness…' : baseLibraries}</p>
        <p className="text-xs text-modiff-subtle-text">
          These core libraries belong to ordinary installation. They require no optional Activate step. Repair a missing
          or incompatible base with the installation procedure for your accelerator.
        </p>
        {runtimeError && !runtimeChecking ? (
          <p role="alert" className="text-xs text-modiff-warning">
            {runtimeError}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2" role="group" aria-label="Model artifacts">
        <h4 className="text-sm font-semibold">2. Model artifacts</h4>
        {!hasGraph ? (
          <p className="text-xs">Open or create a workflow to inspect its selected requirements.</p>
        ) : !current ? (
          <p role="status" className="text-xs">
            Checking the selected execution scope…
          </p>
        ) : current.error ? (
          <p role="alert" className="text-xs text-modiff-warning">
            {current.error}
          </p>
        ) : !indexesReady ? (
          <p className="text-xs">Model indexes are not current. Refresh status before installing.</p>
        ) : !artifacts.length ? (
          <p className="text-xs">
            No static model artifact is declared in this scope. Computed model selections are resolved at Run.
          </p>
        ) : (
          artifacts.map((requirement) => {
            const job = workflowSetupDownload(requirement, downloads[requirement.repo]);
            return (
              <div key={requirement.id} className="grid gap-1">
                <WorkflowArtifactRequirementRow
                  requirement={requirement}
                  installProgress={job.progress ? { [requirement.repo]: job.progress } : {}}
                  activeInstallCount={Object.values(downloads).filter(isHfDownloadActive).length}
                  onInstall={
                    online && !job.blocked
                      ? async (value) => {
                          try {
                            if (!inspection) throw new Error('Setup is not current.');
                            inspection.assertCurrent();
                          } catch {
                            enqueueSnackbar('The workflow changed. Refresh its checklist before installing.', {
                              variant: 'info',
                            });
                            return;
                          }
                          await onInstall(value);
                        }
                      : undefined
                  }
                  onUseLocal={(item) =>
                    openModels({
                      nodeId: null,
                      fieldKey: null,
                      focus: { source: 'setup', label: item.label, repo: item.repo, requirementId: item.id },
                    })
                  }
                />
                <p className="text-xs text-modiff-subtle-text">
                  {requirement.revision
                    ? `Revision: ${requirement.revision}. `
                    : 'Revision is resolved by the selected loader. '}
                  Download size:{' '}
                  {job.progress?.total_bytes != null
                    ? formatDownloadBytes(job.progress.total_bytes)
                    : 'unknown until the backend resolves its file inventory'}
                  .
                  {!online && !requirement.status.runnable
                    ? ' Downloads are unavailable while offline or connection settings are unverified. Use Models to review access and connection settings.'
                    : ''}
                  {job.blocked
                    ? ' A download for this repository is already active. Follow the existing job in Downloads; its exact file selection is not confirmed for this row.'
                    : ''}
                </p>
              </div>
            );
          })
        )}
      </div>
      <div className="grid gap-2" role="group" aria-label="Extra feature packages">
        <h4 className="text-sm font-semibold">3. Extra feature packages</h4>
        {inspection ? (
          required.length ? (
            required.map((row, index) => (
              <p key={index} className="text-xs">
                {row.nodeIds.length} node{row.nodeIds.length === 1 ? '' : 's'}:{' '}
                {row.requirement.state.replace(/_/g, ' ')} — {row.requirement.reason.replace(/_/g, ' ')}.
              </p>
            ))
          ) : (
            <p className="text-xs">No additional managed runtime is required by the declared scope.</p>
          )
        ) : (
          <p className="text-xs">Requirements are unverified until scope inspection succeeds.</p>
        )}
        <RuntimeOptimizationsCard requiredProfileIds={inspection ? profileIds : undefined} />
      </div>
      <div className="grid gap-2" role="group" aria-label="System prerequisites">
        <h4 className="text-sm font-semibold">4. System prerequisites</h4>
        <p className="text-xs text-modiff-subtle-text">
          Drivers, platform support and guided installation steps come from this backend. A package install does not
          establish device or model compatibility.
        </p>
        {runtimeChecking ? (
          <p role="status" className="text-xs">
            Checking system prerequisites…
          </p>
        ) : requests.runtime.status !== 'success' || !runtime ? (
          <p role="alert" className="text-xs text-modiff-warning">
            System prerequisites could not be verified. Refresh checklist status to try again.
          </p>
        ) : (
          <RuntimeEnvironmentCard error={runtimeError} status={runtime} />
        )}
      </div>
      <ModiffButton
        size="compact"
        onClick={() => {
          const store = useNodesStore.getState();
          void store.refreshModelIndexes(true, { invalidateAutoPlans: false });
          setRevision((value) => value + 1);
        }}
      >
        Refresh checklist status
      </ModiffButton>
    </section>
  );
}
