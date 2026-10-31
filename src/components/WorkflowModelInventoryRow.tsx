import { useState } from 'react';
import type { ModelCacheDiagnostics } from '../stores/useNodeStore';
import type { StudioAutoResourceInstallTarget } from '../studio/autoResource';
import { repositoryRequiresHuggingFaceGate } from '../studio/modelUsagePolicies';
import { getDownloadPercent, hasHfDownloadFailed, isHfDownloadActive } from '../studio/modelInstall';
import type { WorkflowModelDescriptor } from '../workflow/workflowChoices';
import { workflowModelArtifactRows, workflowModelArtifactStatus } from '../workflow/workflowModelInventory';
import { ModiffSelect, StatusActionChip } from '../ui';
import type { useNodesStore } from '../stores/useNodeStore';

/** Generic backend identities never pass through the legacy Studio form or Auto profile table. */
export default function WorkflowModelInventoryRow({
  descriptor,
  cache,
  local,
  diagnostics,
  installProgress,
  activeInstallCount,
  hfTokenConfigured,
  onConfigureHfToken,
  onInstall,
}: {
  descriptor: WorkflowModelDescriptor;
  cache: unknown[];
  local: unknown[];
  diagnostics: ModelCacheDiagnostics | null;
  installProgress: ReturnType<typeof useNodesStore.getState>['hfDownloadProgress'];
  activeInstallCount: number;
  hfTokenConfigured: boolean;
  onConfigureHfToken: (repo: string) => void;
  onInstall: (target: StudioAutoResourceInstallTarget) => Promise<void>;
}) {
  const [format, setFormat] = useState('native');
  const rows = workflowModelArtifactRows(descriptor);
  const row = rows.find((item) => item.weightFormat === format) ?? rows[0]!;
  const { status, installTarget, reason } = workflowModelArtifactStatus(row, descriptor, cache, local, diagnostics);
  const repo = row.selection?.repo ?? descriptor.repo;
  const progress = installProgress[repo];
  const installing = isHfDownloadActive(progress);
  const accessFailure = hasHfDownloadFailed(progress) && progress?.error_code === 'huggingface_access_required';
  const tokenRequired = Boolean(
    installTarget && (accessFailure || (!hfTokenConfigured && repositoryRequiresHuggingFaceGate(repo))),
  );
  const canInstall = Boolean(installTarget && !installing && activeInstallCount < 2);
  const label = installing
    ? 'Installing'
    : tokenRequired
      ? 'Add HF token'
      : status.runnable && row.selection
        ? 'Installed'
        : (installTarget?.actionLabel ?? 'Unavailable');
  return (
    <article
      className="grid min-w-0 gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2"
      data-testid={`model-manager-workflow-${descriptor.profileId}`}
      data-model-repo={repo}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-modiff-text">{descriptor.label}</p>
          <p className="break-words text-xs text-modiff-subtle-text">
            {descriptor.pipeline} · {repo}
          </p>
        </div>
        <StatusActionChip
          testId={`model-manager-workflow-install-${descriptor.profileId}`}
          action={
            installing
              ? 'installing'
              : status.runnable && row.selection
                ? 'ready'
                : installTarget
                  ? 'install'
                  : 'missing'
          }
          tone={status.runnable && row.selection ? 'success' : 'warning'}
          label={label}
          title={reason}
          disabled={installing || (!tokenRequired && !canInstall)}
          progress={installing ? getDownloadPercent(progress) : null}
          onClick={
            tokenRequired
              ? () => onConfigureHfToken(repo)
              : canInstall
                ? () => {
                    if (installTarget) void onInstall(installTarget);
                  }
                : undefined
          }
        />
      </div>
      {rows.length > 1 ? (
        <ModiffSelect
          aria-label={`Weight format for ${descriptor.label}`}
          value={row.weightFormat}
          options={rows.map((item) => ({ value: item.weightFormat, label: item.label }))}
          onValueChange={setFormat}
        />
      ) : null}
      <p className="text-xs text-modiff-subtle-text">
        {descriptor.inventory?.executionStatus?.replace(/_/gu, ' ') ?? 'Execution support not declared'}
        {descriptor.inventory?.qualificationStatus ? ` · ${descriptor.inventory.qualificationStatus}` : ''}
      </p>
      <p className="text-xs text-modiff-subtle-text">{reason}</p>
    </article>
  );
}
