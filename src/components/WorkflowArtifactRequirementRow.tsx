import type { ReactNode } from 'react';

import type { HfDownloadProgress } from '../stores/useNodeStore';
import type { StudioAutoResourceInstallTarget } from '../studio/autoResource';
import type { WorkflowArtifactRequirement } from '../studio/artifactRequirements';
import { getDownloadPercent, hasHfDownloadFailed, isHfDownloadActive } from '../studio/modelInstall';
import { StatusActionChip, type StatusActionChipAction, type StatusActionChipTone } from '../ui';
import { cx } from '../utils/classNames';
import { ModelDownloadProgressCard } from './ModelDownloadProgressCard';

type RequirementAction = 'ready' | 'installing' | 'install' | 'repair' | 'retry' | 'use_local' | 'details';

function compactActionLabel(action: RequirementAction) {
  if (action === 'use_local') return 'Use local';
  if (action === 'repair') return 'Repair';
  if (action === 'retry') return 'Retry';
  if (action === 'installing') return 'Installing';
  if (action === 'ready') return 'Ready';
  if (action === 'install') return 'Install';
  return 'Details';
}

function chipAction(action: RequirementAction): StatusActionChipAction {
  if (action === 'use_local') return 'use_local';
  if (action === 'repair') return 'repair';
  if (action === 'retry') return 'retry';
  if (action === 'installing') return 'installing';
  if (action === 'ready') return 'ready';
  if (action === 'install') return 'install';
  return 'details';
}

function actionForRequirement(
  requirement: WorkflowArtifactRequirement,
  progress?: HfDownloadProgress,
): RequirementAction {
  if (requirement.status.runnable) return 'ready';
  if (isHfDownloadActive(progress)) return 'installing';
  if (hasHfDownloadFailed(progress)) return 'retry';
  if (requirement.primaryAction === 'Repair') return 'repair';
  if (requirement.primaryAction === 'Use local') return 'use_local';
  if (requirement.primaryAction === 'Details') return 'details';
  return 'install';
}

function toneForRequirement(requirement: WorkflowArtifactRequirement, action: RequirementAction): StatusActionChipTone {
  if (requirement.status.runnable || action === 'ready') return 'success';
  if (action === 'use_local' || action === 'repair' || action === 'installing') return 'warning';
  if (!requirement.installTarget && action === 'details') return 'error';
  return 'warning';
}

function installTargetForRequirement(
  requirement: WorkflowArtifactRequirement,
  action: RequirementAction,
): StudioAutoResourceInstallTarget | null {
  if (!['install', 'repair', 'retry'].includes(action)) return null;
  return (
    requirement.installTarget ?? {
      repo: requirement.repo,
      label: requirement.label,
      actionLabel: compactActionLabel(action),
      repair: action === 'repair',
    }
  );
}

export function WorkflowArtifactRequirementRow({
  activeInstallCount = 0,
  actionTestId,
  className,
  compact = false,
  installProgress,
  onInstall,
  onUseLocal,
  requirement,
  rightSlot,
  testId,
}: {
  activeInstallCount?: number;
  actionTestId?: string;
  className?: string;
  compact?: boolean;
  installProgress: Record<string, HfDownloadProgress>;
  onInstall?: (
    target: StudioAutoResourceInstallTarget,
    requirement: WorkflowArtifactRequirement,
  ) => Promise<void> | void;
  onUseLocal?: (requirement: WorkflowArtifactRequirement) => void;
  requirement: WorkflowArtifactRequirement;
  rightSlot?: ReactNode;
  testId?: string;
}) {
  const progress = installProgress[requirement.repo];
  const action = actionForRequirement(requirement, progress);
  const installTarget = installTargetForRequirement(requirement, action);
  const installing = action === 'installing';
  const actionTone = toneForRequirement(requirement, action);
  const disabled =
    installing ||
    (Boolean(installTarget) && activeInstallCount >= 2) ||
    (action === 'use_local' && !onUseLocal) ||
    (Boolean(installTarget) && !onInstall);
  const actionTitle = [
    requirement.details || requirement.status.reason,
    requirement.modelPath ? requirement.modelPath : requirement.repo,
    requirement.nodeLabel ? `Node: ${requirement.nodeLabel}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
  const actionClick =
    installTarget && onInstall
      ? () => {
          void onInstall(installTarget, requirement);
        }
      : action === 'use_local' && onUseLocal
        ? () => onUseLocal(requirement)
        : undefined;

  return (
    <article
      className={cx('rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2', className)}
      data-testid={testId}
      title={actionTitle}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-modiff-text">{requirement.label}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <StatusActionChip
              action="details"
              className="min-h-7 px-2 py-0.5 text-xs"
              label={requirement.role}
              title={requirement.repo}
              tone="neutral"
            />
            {requirement.source === 'graph' ? (
              <StatusActionChip
                action="details"
                className="min-h-7 px-2 py-0.5 text-xs"
                label="Graph"
                title={requirement.nodeLabel ?? requirement.nodeId}
                tone="neutral"
              />
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {rightSlot}
          <StatusActionChip
            action={chipAction(action)}
            className="min-h-7 px-2 py-0.5 text-xs"
            disabled={disabled}
            label={compactActionLabel(action)}
            onClick={actionClick}
            progress={installing ? getDownloadPercent(progress) : null}
            testId={actionTestId ?? (testId ? `${testId}-action` : undefined)}
            title={actionTitle}
            tone={actionTone}
          />
        </div>
      </div>
      {progress && !compact ? (
        <div className="mt-2">
          <ModelDownloadProgressCard
            compact
            progress={progress}
            repoId={requirement.repo}
            testId={testId ? `${testId}-progress` : undefined}
          />
        </div>
      ) : null}
    </article>
  );
}
