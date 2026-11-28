import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useNodesStore } from '../stores/useNodeStore';
import type { AncillaryOperation } from '../studio/ancillaryOperations';
import { AUTHORED_CONSTRAINT_POLICY } from '../studio/promptEnhancementConstraints';
import { GraphControlButton } from '../ui/GraphControls';
import { ModiffDisclosure, ModiffFieldShell, ModiffSelect } from '../ui';
import {
  promptEnhancementOwner,
  enablePromptEnhancement,
  disablePromptEnhancement,
  startPromptEnhancementPreview,
  finishPromptEnhancementPreview,
  promptEnhancementPreviewDetails,
  applyPromptEnhancementPreview,
  currentPromptEnhancementDeclaration,
  type PromptEnhancementPreviewRun,
  type VerifiedPromptEnhancementPreview,
} from '../studio/promptEnhancementPreview';

/** Optional editing action within Prompt/Inputs, never another image stage. */
export default function PromptEnhancementControls({
  ownerId,
  renderSettings,
}: {
  ownerId: string;
  renderSettings?: (declaration: AncillaryOperation) => ReactNode;
}) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const tab = useStudioStore((state) => state.activeWorkflowTabId);
  // Epoch subscriptions also invalidate tickets after non-canvas form changes.
  useStudioStore((state) => state.workflowCanvasEpoch);
  useStudioStore((state) => state.workflowFormEpoch);
  const connected = useWebsocketStore((state) => state.isConnected);
  const currentTask = useTaskStore((state) => state.currentTask);
  const operationCount = useNodesStore((state) => state.operationContracts.length);
  const descriptors = useNodesStore((state) => state.workflowModelDescriptors);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [run, setRun] = useState<PromptEnhancementPreviewRun | null>(null);
  const [verified, setVerified] = useState<VerifiedPromptEnhancementPreview | null>(null);
  const [declaration, setDeclaration] = useState<AncillaryOperation | null>(null);
  const [rawChoice, setRawChoice] = useState<string | null>(null);
  const terminal = useTaskStore((state) =>
    run ? state.sessionRuns.find((task) => task.task_id === run.taskId || task.id === run.taskId) : undefined,
  );
  const selected = useMemo(() => {
    try {
      return { ...promptEnhancementOwner(ownerId, { nodes, edges }), error: null };
    } catch (error) {
      return { owner: null, selection: null, error: String(error) };
    }
    // Use the exact active document, including value/metadata changes.
  }, [ownerId, nodes, edges]);
  const binding = selected.owner?.data.operationAuthoring?.ancillaryBindings?.[0];
  const bindingId = binding?.contractId,
    bindingHash = binding?.contentHash;
  const parent = selected.selection?.parent;
  const matching = descriptors.filter(
    (descriptor) =>
      descriptor.profileId === parent?.executionProfileId && descriptor.pipeline === parent?.pipelineClass,
  );
  const rawChoices =
    parent && matching.length === 1 ? (matching[0]!.rawPromptAuthoringChoices?.[parent.task] ?? []) : [];
  const layoutChoices =
    parent && matching.length === 1 ? (matching[0]!.layoutPromptAuthoringChoices?.[parent.task] ?? []) : [];
  const currentRawChoice = rawChoices.find(
    (choice) => choice.authoringRecipeId === parent?.authoringRecipeId,
  )?.authoringRecipeId;
  const selectedRawChoice = rawChoice ?? currentRawChoice ?? '';
  const currentLayoutChoice = layoutChoices.find(
    (choice) =>
      choice.authoringRecipeId === parent?.authoringRecipeId &&
      choice.authoringRecipeId !== matching[0]?.authoringRecipes?.[parent?.task ?? ''],
  )?.authoringRecipeId;
  const hasLayoutChoices = layoutChoices.length > 1;
  const selectedModeChoice = rawChoice ?? currentLayoutChoice ?? currentRawChoice ?? '';
  const enable = async () => {
    const chosen = hasLayoutChoices ? selectedModeChoice : selectedRawChoice;
    const raw = rawChoices.some((choice) => choice.authoringRecipeId === chosen) ? chosen : undefined;
    const layout =
      hasLayoutChoices && layoutChoices.some((choice) => choice.authoringRecipeId === chosen) ? chosen : undefined;
    if (chosen && !raw && !layout)
      throw new Error('The selected enhancement mode is no longer available. Choose a current mode.');
    return enablePromptEnhancement(ownerId, undefined, undefined, raw, layout);
  };
  const details = (() => {
    if (!verified) return { summary: null, stale: false };
    try {
      return { summary: promptEnhancementPreviewDetails(verified), stale: false };
    } catch {
      return { summary: null, stale: true };
    }
  })();
  const act = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, []);
  useEffect(() => {
    setRun(null);
    setVerified(null);
    setError(null);
    setMessage(null);
    setRawChoice(null);
  }, [ownerId, tab, parent?.executionProfileId, parent?.task]);
  useEffect(() => {
    setDeclaration(null);
    if (!bindingId || !connected || !operationCount) return;
    const controller = new AbortController();
    void currentPromptEnhancementDeclaration(ownerId, bindingId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setDeclaration(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [ownerId, bindingId, bindingHash, connected, operationCount, tab]);
  useEffect(() => {
    if (!run || terminal?.status !== 'completed') return;
    void act('Verifying Preview', async () => {
      setVerified(await finishPromptEnhancementPreview(run));
      setMessage('Review the proposed wording before applying it.');
    });
  }, [run, terminal?.status, act]);
  useEffect(() => {
    if (!run || (terminal?.status !== 'failed' && terminal?.status !== 'cancelled')) return;
    setVerified(null);
    setMessage(null);
    setError(
      terminal.message ??
        terminal.error ??
        `Preview ${terminal.status}. Review the current prompt and Undo history before another Preview.`,
    );
  }, [run, terminal?.status, terminal?.message, terminal?.error]);
  if (!selected.owner) return null;
  const unavailable = Boolean(busy || !connected);
  const taskActive = Boolean(
    currentTask &&
    currentTask.status !== 'completed' &&
    currentTask.status !== 'failed' &&
    currentTask.status !== 'cancelled',
  );
  const preview = async (regenerate: boolean) => {
    if (!binding) return;
    setVerified(null);
    const next = await startPromptEnhancementPreview(ownerId, binding.contractId, regenerate);
    setRun(next);
    setMessage('Preview submitted. Follow progress in Session activity.');
  };
  const structured = details.summary?.proposal.structuredProposal;
  const append = structured?.schemaVersion === 3 || declaration?.layoutPolicy === 'append-details-preserve-layout-v1';
  const text =
    structured?.schemaVersion === 3 ? structured.nativeText : (structured?.caption ?? details.summary?.proposal.text);
  return (
    <section
      aria-label="Model prompt enhancement"
      data-testid={`prompt-enhancement-${ownerId}`}
      className="nodrag nowheel grid min-w-0 gap-2 rounded-modiff-compact border border-modiff-border-subtle bg-modiff-bg p-2"
    >
      <div className="text-xs font-semibold text-modiff-text">Prompt enhancement</div>
      <p className="text-modiff-metadata text-modiff-subtle-text">
        The raw prompt runs directly. Preview proposes wording; Apply changes the prompt only after verification and
        your review.
      </p>
      {append ? (
        <p className="text-modiff-metadata text-modiff-subtle-text">
          Appends proposed wording; authored layout stays unchanged.
        </p>
      ) : null}
      {declaration?.layoutPolicy === AUTHORED_CONSTRAINT_POLICY ? (
        <p className="text-modiff-metadata text-modiff-subtle-text">
          Proposes wording for your authored regions. Coordinates and region identities stay fixed; review the wording
          before Apply.
        </p>
      ) : null}
      {!binding && hasLayoutChoices ? (
        <>
          <ModiffFieldShell label="Prompt enhancement mode">
            <ModiffSelect
              aria-label="Prompt enhancement mode"
              disabled={unavailable || taskActive}
              value={selectedModeChoice}
              onValueChange={setRawChoice}
              options={[
                { value: '', label: 'Match current layout' },
                ...rawChoices.map((choice) => ({ value: choice.authoringRecipeId, label: choice.label })),
                ...layoutChoices.map((choice) => ({ value: choice.authoringRecipeId, label: choice.label })),
              ]}
            />
          </ModiffFieldShell>
          <p className="text-modiff-metadata text-modiff-subtle-text">
            Layout modes require authored regions. Review the mode before enabling enhancement.
          </p>
        </>
      ) : !binding && rawChoices.length > 1 ? (
        <>
          <ModiffFieldShell label="Raw prompt enhancement">
            <ModiffSelect
              aria-label="Raw prompt enhancement"
              disabled={unavailable || taskActive}
              value={selectedRawChoice}
              onValueChange={setRawChoice}
              options={[
                { value: '', label: 'Match current layout' },
                ...rawChoices.map((choice) => ({ value: choice.authoringRecipeId, label: choice.label })),
              ]}
            />
          </ModiffFieldShell>
          {selectedRawChoice ? (
            <ModiffDisclosure label="Selection details">
              <p className="break-all text-modiff-metadata text-modiff-subtle-text">Recipe: {selectedRawChoice}</p>
            </ModiffDisclosure>
          ) : null}
        </>
      ) : null}
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {!binding ? (
          <GraphControlButton
            type="button"
            disabled={unavailable || taskActive}
            onClick={() =>
              void act('Enabling enhancement', async () => {
                setDeclaration(await enable());
                setMessage('Enabled. Review the declared model and resource controls before Preview.');
              })
            }
          >
            Enable enhancement
          </GraphControlButton>
        ) : (
          <>
            <GraphControlButton
              type="button"
              disabled={unavailable || taskActive}
              onClick={() => void act('Preparing Preview', () => preview(false))}
            >
              Preview
            </GraphControlButton>
            <GraphControlButton
              type="button"
              disabled={unavailable || taskActive}
              onClick={() => void act('Preparing Regenerate', () => preview(true))}
            >
              Regenerate
            </GraphControlButton>
            <GraphControlButton
              type="button"
              disabled={
                unavailable || taskActive || !verified || details.stale || !details.summary?.proposal.applicationAllowed
              }
              onClick={() =>
                void act('Applying proposal', async () => {
                  if (!verified) return;
                  await applyPromptEnhancementPreview(verified);
                  setVerified(null);
                  setMessage('Applied as one undoable prompt change.');
                })
              }
            >
              Apply
            </GraphControlButton>
            <GraphControlButton
              type="button"
              disabled={unavailable || taskActive}
              onClick={() =>
                void act('Disabling enhancement', async () => {
                  const result = await disablePromptEnhancement(ownerId, binding.contractId);
                  setRun(null);
                  setVerified(null);
                  setMessage(
                    result.preservedUnavailablePair
                      ? 'Disabled. Your current prompt, layout and references are preserved. Choose the current model, then enable a current enhancement mode.'
                      : 'Disabled. Later user edits are preserved.',
                  );
                })
              }
            >
              Disable
            </GraphControlButton>
          </>
        )}
        {run && terminal?.status === 'completed' && !verified ? (
          <GraphControlButton
            type="button"
            disabled={unavailable}
            onClick={() =>
              void act('Verifying Preview', async () => {
                setVerified(await finishPromptEnhancementPreview(run));
              })
            }
          >
            Read Preview
          </GraphControlButton>
        ) : null}
      </div>
      {declaration && renderSettings ? renderSettings(declaration) : null}
      {binding && !declaration && connected ? (
        <GraphControlButton
          type="button"
          disabled={unavailable}
          onClick={() =>
            void act('Refreshing settings', async () => {
              setDeclaration(await currentPromptEnhancementDeclaration(ownerId, binding.contractId));
            })
          }
        >
          Refresh enhancement settings
        </GraphControlButton>
      ) : null}
      {!connected ? (
        <p role="status" className="text-xs text-modiff-subtle-text">
          Connect to the local worker to refresh enhancement metadata.
        </p>
      ) : null}
      {busy || message ? (
        <p role="status" className="break-words text-xs text-modiff-subtle-text">
          {busy ?? message}
        </p>
      ) : null}
      {error || selected.error ? (
        <p role="alert" className="break-words text-xs text-modiff-invalid">
          {error ?? selected.error}
        </p>
      ) : null}
      {details.stale ? (
        <p role="status" className="text-xs text-modiff-subtle-text">
          The document changed. Request a new Preview before Apply.
        </p>
      ) : null}
      {text ? (
        <div
          aria-label="Proposed prompt"
          className="max-h-64 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-modiff-compact border border-modiff-border-subtle p-2 text-xs text-modiff-text"
        >
          {text}
        </div>
      ) : null}
      {details.summary && !details.summary.proposal.applicationAllowed ? (
        <p role="status" className="break-words text-xs text-modiff-invalid">
          {details.summary.proposal.applicationBlockedReason}
        </p>
      ) : null}
      {binding ? (
        <p className="text-modiff-metadata text-modiff-subtle-text">
          Regenerate reuses the original request after an untouched Apply. Resource admission uses the current Auto or
          Custom choice.
        </p>
      ) : null}
    </section>
  );
}
