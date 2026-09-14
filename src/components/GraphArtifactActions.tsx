import { useShallow } from 'zustand/react/shallow';
import { useNodesStore } from '../stores/useNodeStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import type { RunReadinessIssue } from '../studio/types';
import { isHfDownloadActive } from '../studio/modelInstall';
import { StudioButton } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import { formatRequestError } from '../utils/requestJson';

/** Use the same graph-derived issues and exact install options as Run/Setup. */
export function GraphArtifactActions({ issues }: { issues: RunReadinessIssue[] }) {
  const { installHfModel, refreshModelIndexes, hfDownloadProgress } = useNodesStore(
    useShallow((state) => ({
      installHfModel: state.installHfModel,
      refreshModelIndexes: state.refreshModelIndexes,
      hfDownloadProgress: state.hfDownloadProgress,
    })),
  );
  const sid = useWebsocketStore((state) => state.sid);
  const requirements = issues.filter(
    (item, index) =>
      item.action === 'install_model' &&
      item.repoId &&
      issues.findIndex(
        (other) =>
          other.action === 'install_model' &&
          other.repoId === item.repoId &&
          JSON.stringify(other.installOptions ?? {}) === JSON.stringify(item.installOptions ?? {}),
      ) === index,
  );
  return requirements.map((item) => {
    const repo = item.repoId!;
    const installing = isHfDownloadActive(hfDownloadProgress[repo]);
    return (
      <StudioButton
        key={item.id}
        fullWidth
        tone="secondary"
        disabled={installing || !sid}
        data-testid={`studio-install-graph-model-${repo}`}
        title={`${repo}: ${item.message}`}
        onClick={() => {
          void (async () => {
            try {
              await installHfModel(repo, sid, item.installOptions);
              // Index refresh is global; never reconcile whichever form/tab is
              // active when an earlier workflow's download finishes.
              await refreshModelIndexes(true);
            } catch (error) {
              enqueueSnackbar(formatRequestError(error, `Could not install ${repo}.`), { variant: 'error' });
            }
          })();
        }}
      >
        {installing ? 'Installing' : item.installOptions?.repair ? 'Repair' : 'Install'} {repo.split('/').pop()}
      </StudioButton>
    );
  });
}
