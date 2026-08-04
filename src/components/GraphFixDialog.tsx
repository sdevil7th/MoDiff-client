import { CircleDot, WandSparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useFlowStore } from '../stores/useFlowStore';
import { useGraphFixStore } from '../stores/useGraphFixStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import {
  buildGraphFixPlan,
  materializeGraphFixes,
  type GraphFixCandidate,
  type GraphFixExternalAction,
  type GraphFixIssue,
} from '../studio/graphFixer';
import { validateCurrentRun } from '../studio/runReadiness';
import { useRunReadinessIssues } from '../studio/useRunReadinessIssues';
import { ModiffButton, ModiffDialog, ModiffRadioCardGroup } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';

function defaultSelections(plan: ReturnType<typeof buildGraphFixPlan>) {
  const externalPrerequisite = plan.issues
    .map((issue) => ({
      issue,
      candidate: issue.candidates.find(
        (candidate) =>
          candidate.confidence === 'safe' &&
          candidate.operations.length > 0 &&
          candidate.operations.every((operation) => operation.kind === 'external'),
      ),
    }))
    .find((item) => item.candidate);

  return Object.fromEntries(
    plan.issues.map((issue) => [
      issue.id,
      externalPrerequisite
        ? issue.id === externalPrerequisite.issue.id
          ? (externalPrerequisite.candidate?.id ?? '')
          : ''
        : (issue.candidates.find((candidate) => candidate.confidence === 'safe')?.id ?? ''),
    ]),
  );
}

function candidateForSelection(plan: ReturnType<typeof buildGraphFixPlan>, issueId: string, candidateId: string) {
  return plan.issues.find((issue) => issue.id === issueId)?.candidates.find((item) => item.id === candidateId);
}

function sameFixTarget(left: GraphFixIssue, right: GraphFixIssue) {
  return (
    left.kind === right.kind &&
    (left.targetNodeId ?? null) === (right.targetNodeId ?? null) &&
    (left.targetHandle ?? null) === (right.targetHandle ?? null)
  );
}

export default function GraphFixDialog() {
  const dialogOpen = useGraphFixStore((state) => state.dialogOpen);
  const closeDialog = useGraphFixStore((state) => state.closeDialog);
  const setPreviewCandidate = useGraphFixStore((state) => state.setPreviewCandidate);
  const setIssueTargets = useGraphFixStore((state) => state.setIssueTargets);
  const { nodes, edges } = useFlowStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
    })),
  );
  const registry = useNodesStore((state) => state.nodesRegistry);
  const edgeType = useSettingsStore((state) => state.edgeType);
  const setLeftPanelOpen = useSettingsStore((state) => state.setLeftPanelOpen);
  const setLeftPanelTabIndex = useSettingsStore((state) => state.setLeftPanelTabIndex);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const setModelManagerOpener = useSettingsStore((state) => state.setModelManagerOpener);
  const saveActiveWorkflowTab = useStudioStore((state) => state.saveActiveWorkflowTab);
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const sid = useWebsocketStore((state) => state.sid);
  const isConnected = useWebsocketStore((state) => state.isConnected);
  const readiness = useRunReadinessIssues({ sid, isConnected, includeStudio: Boolean(graphBinding) });
  const plan = useMemo(
    () => buildGraphFixPlan({ nodes, edges, registry, readinessIssues: readiness.issues }),
    [edges, nodes, readiness.issues, registry],
  );
  const planFingerprint = plan.issues
    .map((issue) => `${issue.id}:${issue.candidates.map((item) => item.id).join(',')}`)
    .join('|');
  const planRef = useRef(plan);
  planRef.current = plan;
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    if (!dialogOpen) return;
    const currentPlan = planRef.current;
    const next = defaultSelections(currentPlan);
    setSelected(next);
    const firstIssue = currentPlan.issues[0];
    const firstCandidate = firstIssue
      ? candidateForSelection(currentPlan, firstIssue.id, next[firstIssue.id] ?? '')
      : null;
    setPreviewCandidate(firstCandidate ?? null);
    setIssueTargets(
      currentPlan.issues.flatMap((issue) =>
        issue.targetNodeId ? [{ nodeId: issue.targetNodeId, handle: issue.targetHandle }] : [],
      ),
    );
  }, [dialogOpen, planFingerprint, setIssueTargets, setPreviewCandidate]);

  const applyExternalAction = (action: GraphFixExternalAction, options: { nodeId?: string; repoId?: string } = {}) => {
    if (action === 'open_setup') {
      setRightPanelOpen(true);
      setRightPanelTab('setup');
      return;
    }
    setLeftPanelOpen(true);
    if (action === 'open_assets') {
      setLeftPanelTabIndex(2);
      return;
    }
    setLeftPanelTabIndex(3);
    setModelManagerOpener({
      nodeId: options.nodeId ?? null,
      fieldKey: null,
      focus: options.repoId ? { repo: options.repoId, source: 'graph' } : undefined,
    });
  };

  const selectedCandidates = plan.issues
    .map((issue) => candidateForSelection(plan, issue.id, selected[issue.id] ?? ''))
    .filter((candidate): candidate is GraphFixCandidate => Boolean(candidate));
  const navigationOnly =
    selectedCandidates.length > 0 &&
    selectedCandidates.every((candidate) => candidate.operations.every((operation) => operation.kind === 'external'));

  const handleApply = () => {
    const candidates = selectedCandidates;
    if (!candidates.length || isApplying) return;
    setIsApplying(true);

    try {
      const graphCandidates = candidates.filter((candidate) =>
        candidate.operations.some((operation) => operation.kind !== 'external'),
      );
      const repairedIssues = plan.issues.filter((item) =>
        graphCandidates.some((candidate) => candidate.issueId === item.id),
      );
      const result = materializeGraphFixes({ nodes, edges, registry }, candidates, edgeType);
      const graphChanged = graphCandidates.length > 0;
      if (graphChanged) {
        useFlowStore
          .getState()
          .replaceGraph(
            { nodes: result.nodes, edges: result.edges },
            { historyLabel: 'Fix graph', clearRemovedCache: false },
          );
        saveActiveWorkflowTab(true);
      }

      const validation = validateCurrentRun({
        sid,
        isConnected,
        includeStudio: Boolean(graphBinding),
        showDialog: false,
      });
      const currentGraph = useFlowStore.getState();
      const revalidatedPlan = buildGraphFixPlan({
        nodes: currentGraph.nodes,
        edges: currentGraph.edges,
        registry,
        readinessIssues: validation.issues,
      });
      const unresolved = graphChanged
        ? repairedIssues.filter((original) =>
            revalidatedPlan.issues.some((current) => sameFixTarget(original, current)),
          )
        : [];
      if (graphChanged && unresolved.length > 0) {
        throw new Error(
          `The proposed change did not clear ${unresolved.length === 1 ? 'the selected issue' : `${unresolved.length} selected issues`}. Review the updated graph before retrying.`,
        );
      }

      closeDialog();
      result.externalActions.forEach((action) =>
        applyExternalAction(action.action, { nodeId: action.nodeId, repoId: action.repoId }),
      );
      if (graphChanged) {
        const remaining = validation.blocking.length;
        enqueueSnackbar(
          `${graphCandidates.length === 1 ? 'Fix' : `${graphCandidates.length} fixes`} applied and verified.${
            remaining > 0 ? ` ${remaining} other blocking ${remaining === 1 ? 'issue remains' : 'issues remain'}.` : ''
          } Undo is available.`,
          {
            variant: 'success',
            autoHideDuration: 3600,
          },
        );
      }
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'The graph changed before the fix could be applied.', {
        variant: 'error',
        autoHideDuration: 4200,
      });
    } finally {
      setIsApplying(false);
    }
  };

  const selectedCount = plan.issues.filter((issue) => Boolean(selected[issue.id])).length;

  return (
    <ModiffDialog
      open={dialogOpen}
      onClose={closeDialog}
      title="Fix graph"
      testId="graph-fix-dialog"
      panelClassName="max-w-2xl"
      footer={
        <>
          <ModiffButton onClick={closeDialog}>Cancel</ModiffButton>
          <ModiffButton
            tone="primary"
            icon={<WandSparkles size={15} />}
            disabled={selectedCount === 0 || isApplying}
            loading={isApplying}
            onClick={handleApply}
            data-testid="graph-fix-apply"
          >
            {navigationOnly
              ? selectedCandidates[0]?.title
              : `Apply ${selectedCount === 1 ? 'fix' : `${selectedCount} fixes`}`}
          </ModiffButton>
        </>
      }
    >
      {plan.issues.length === 0 ? (
        <div className="rounded-modiff-panel border border-modiff-border bg-modiff-panel p-4 text-sm text-modiff-subtle-text">
          No deterministic graph repair is currently available.
        </div>
      ) : (
        <div className="grid gap-4">
          <p className="text-sm text-modiff-subtle-text">
            {navigationOnly
              ? 'Review the detected issue and continue to the exact place where it can be resolved.'
              : 'Review the proposed connections. MoDiff will apply graph changes together as one undoable action.'}
          </p>
          {plan.issues.map((issue, issueIndex) => (
            <section
              key={issue.id}
              className="rounded-modiff-panel border border-modiff-border bg-modiff-panel p-3"
              data-testid={`graph-fix-issue-${issueIndex}`}
            >
              <div className="flex items-start gap-2">
                <CircleDot size={16} className="mt-0.5 shrink-0 text-modiff-red" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-modiff-text">{issue.title}</h3>
                  <p className="mt-0.5 text-xs text-modiff-subtle-text">{issue.description}</p>
                </div>
              </div>
              <ModiffRadioCardGroup
                className="mt-3"
                aria-label={issue.title}
                value={selected[issue.id] ?? ''}
                options={issue.candidates.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.title,
                  description: candidate.description,
                  meta: candidate.confidence === 'safe' ? 'Direct' : 'Choice',
                }))}
                onOptionPreview={(candidateId) =>
                  setPreviewCandidate(issue.candidates.find((candidate) => candidate.id === candidateId) ?? null)
                }
                onValueChange={(candidateId) => {
                  setSelected((current) => ({ ...current, [issue.id]: candidateId }));
                  setPreviewCandidate(issue.candidates.find((candidate) => candidate.id === candidateId) ?? null);
                }}
              />
            </section>
          ))}
        </div>
      )}
    </ModiffDialog>
  );
}
