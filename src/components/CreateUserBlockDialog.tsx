import type { Dispatch, SetStateAction } from 'react';
import type { BlockSelectionResult } from '../studio/userBlocks';
import { ModiffButton, ModiffCheckbox, ModiffDialog, ModiffFieldShell, ModiffInput } from '../ui';

export type PendingBlock = {
  result: Extract<BlockSelectionResult, { ok: true }>;
  name: string;
  inputLabels: Record<string, string>;
  outputLabels: Record<string, string>;
  exposedParamIds: Set<string>;
};

export default function CreateUserBlockDialog({
  pendingBlock,
  setPendingBlock,
  handleConfirmBlockCreation,
}: {
  pendingBlock: PendingBlock;
  setPendingBlock: Dispatch<SetStateAction<PendingBlock | null>>;
  handleConfirmBlockCreation: () => Promise<void>;
}) {
  return (
    <ModiffDialog
      open={Boolean(pendingBlock)}
      onClose={() => setPendingBlock(null)}
      title="Create block"
      testId="create-user-block-dialog"
      panelClassName="max-w-xl"
      footer={
        <>
          <ModiffButton onClick={() => setPendingBlock(null)}>Cancel</ModiffButton>
          <ModiffButton
            tone="primary"
            disabled={!pendingBlock?.name.trim()}
            onClick={() => {
              void handleConfirmBlockCreation();
            }}
            data-testid="confirm-create-user-block"
          >
            Create block
          </ModiffButton>
        </>
      }
    >
      {pendingBlock ? (
        <div className="grid gap-4">
          <ModiffFieldShell label="Name" required>
            <ModiffInput
              autoFocus
              value={pendingBlock.name}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setPendingBlock((current) => (current ? { ...current, name: value } : current));
              }}
            />
          </ModiffFieldShell>

          {pendingBlock.result.block.inputs.length > 0 ? (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold text-modiff-text">Inputs</h3>
              {pendingBlock.result.block.inputs.map((port) => (
                <ModiffFieldShell key={port.id} label={port.label}>
                  <ModiffInput
                    value={pendingBlock.inputLabels[port.id] ?? port.label}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setPendingBlock((current) =>
                        current
                          ? {
                              ...current,
                              inputLabels: {
                                ...current.inputLabels,
                                [port.id]: value,
                              },
                            }
                          : current,
                      );
                    }}
                  />
                </ModiffFieldShell>
              ))}
            </section>
          ) : null}

          {pendingBlock.result.block.outputs.length > 0 ? (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold text-modiff-text">Outputs</h3>
              {pendingBlock.result.block.outputs.map((port) => (
                <ModiffFieldShell key={port.id} label={port.label}>
                  <ModiffInput
                    value={pendingBlock.outputLabels[port.id] ?? port.label}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setPendingBlock((current) =>
                        current
                          ? {
                              ...current,
                              outputLabels: {
                                ...current.outputLabels,
                                [port.id]: value,
                              },
                            }
                          : current,
                      );
                    }}
                  />
                </ModiffFieldShell>
              ))}
            </section>
          ) : null}

          {pendingBlock.result.block.exposedParams.length > 0 ? (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold text-modiff-text">Editable parameters</h3>
              {pendingBlock.result.block.exposedParams.map((input) => (
                <ModiffCheckbox
                  key={input.id}
                  label={input.label}
                  checked={pendingBlock.exposedParamIds.has(input.id)}
                  onCheckedChange={(checked) =>
                    setPendingBlock((current) => {
                      if (!current) return current;
                      const exposedParamIds = new Set(current.exposedParamIds);
                      if (checked) exposedParamIds.add(input.id);
                      else exposedParamIds.delete(input.id);
                      return { ...current, exposedParamIds };
                    })
                  }
                />
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
    </ModiffDialog>
  );
}
