import type { Dispatch, SetStateAction } from 'react';
import type { BlockSelectionResult } from '../studio/userBlocks';
import { ModiffButton, ModiffCheckbox, ModiffDialog, ModiffDisclosure, ModiffFieldShell, ModiffInput } from '../ui';

export type PendingBlock = {
  result: Extract<BlockSelectionResult, { ok: true }>;
  name: string;
  error?: string;
  inputLabels: Record<string, string>;
  outputLabels: Record<string, string>;
  exposedParamIds: Set<string>;
  exposedInputIds: Set<string>;
  exposedOutputIds: Set<string>;
  connectedInputs: Set<string | null | undefined>;
  connectedOutputs: Set<string | null | undefined>;
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
          <p className="text-sm text-modiff-subtle-text">
            Group the selected canvas nodes into an editable Block. Save it to reuse in other workflows.
          </p>
          {pendingBlock.error ? (
            <p role="alert" className="text-sm text-modiff-red">
              {pendingBlock.error}
            </p>
          ) : null}
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

          <section
            aria-label="Block preview"
            className="grid gap-2 rounded-modiff-panel border border-modiff-border bg-modiff-panel p-3"
          >
            <h3 className="break-words text-sm font-semibold">{pendingBlock.name || 'Block preview'}</h3>
            <dl className="grid gap-2 text-xs">
              {(
                [
                  [
                    'Inputs',
                    pendingBlock.result.block.inputs
                      .filter((port) => pendingBlock.exposedInputIds.has(port.id))
                      .map((port) => pendingBlock.inputLabels[port.id] || port.label),
                  ],
                  [
                    'Outputs',
                    pendingBlock.result.block.outputs
                      .filter((port) => pendingBlock.exposedOutputIds.has(port.id))
                      .map((port) => pendingBlock.outputLabels[port.id] || port.label),
                  ],
                  [
                    'Editable parameters',
                    pendingBlock.result.block.exposedParams
                      .filter((input) => pendingBlock.exposedParamIds.has(input.id))
                      .map((input) => input.label),
                  ],
                ] as const
              ).map(([title, items]) => (
                <div key={title}>
                  <dt className="font-semibold">
                    {title} ({items.length})
                  </dt>
                  <dd className="break-words text-modiff-subtle-text">
                    {items.slice(0, 4).join(', ')}
                    {items.length > 4 ? ` and ${items.length - 4} more` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <ModiffDisclosure label="Customize Block interface" panelClassName="grid gap-4 pt-2">
            {(['inputs', 'outputs'] as const).map((direction) => {
              const inputs = direction === 'inputs';
              const ids = inputs ? 'exposedInputIds' : 'exposedOutputIds';
              const labels = inputs ? 'inputLabels' : 'outputLabels';
              const connected = inputs ? pendingBlock.connectedInputs : pendingBlock.connectedOutputs;
              const ports = pendingBlock.result.block[direction];
              if (!ports.length) return null;
              return (
                <section key={direction} className="grid gap-2">
                  <h3 className="text-sm font-semibold">{inputs ? 'Inputs' : 'Outputs'}</h3>
                  {ports.map((port) => (
                    <div key={port.id} className="grid gap-1">
                      <ModiffCheckbox
                        label={`Expose ${port.label}${connected.has(port.id) ? ' (connected)' : ''}`}
                        checked={pendingBlock[ids].has(port.id)}
                        disabled={connected.has(port.id)}
                        onCheckedChange={(checked) =>
                          setPendingBlock((current) => {
                            if (!current) return current;
                            const next = new Set(current[ids]);
                            if (checked) next.add(port.id);
                            else next.delete(port.id);
                            return { ...current, [ids]: next };
                          })
                        }
                      />
                      {pendingBlock[ids].has(port.id) ? (
                        <ModiffFieldShell label={port.label}>
                          <ModiffInput
                            value={pendingBlock[labels][port.id] ?? port.label}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setPendingBlock((current) =>
                                current
                                  ? {
                                      ...current,
                                      [labels]: { ...current[labels], [port.id]: value },
                                    }
                                  : current,
                              );
                            }}
                          />
                        </ModiffFieldShell>
                      ) : null}
                    </div>
                  ))}
                </section>
              );
            })}
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
          </ModiffDisclosure>
        </div>
      ) : null}
    </ModiffDialog>
  );
}
