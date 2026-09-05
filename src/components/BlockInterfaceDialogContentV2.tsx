import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { BlockInstanceV2 } from '../studio/blockSchemaV2';
import { blockValueTypesAreCompatibleV2 } from '../studio/blockValueTypeCompatibilityV2';
import {
  blockInterfaceDraftV2,
  blockInterfaceScopeNodeIdsV2,
  blockInterfaceFieldValueV2,
  mergeBlockInterfaceDraftV2,
  type BlockInterfaceDraftV2 as InterfaceDraftV2,
} from '../studio/blockInterfaceEditingV2';
import { useFlowStore } from '../stores/useFlowStore';
import { assertWorkflowOperationContext, type WorkflowOperationContext } from '../stores/useStudioStore';
import { ModiffButton, ModiffDialog, ModiffIconButton, ModiffInput, ModiffSelect } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
type InterfaceBindingOptionV2 = {
  key: string;
  nodeId: string;
  fieldId: string;
  label: string;
  valueType: string;
  display?: string;
};

type InterfaceMirrorBindingV2 = { nodeId: string; fieldId: string };

function interfaceBindingKeyV2(nodeId: string, fieldId: string) {
  return `${nodeId}\0${fieldId}`;
}

function compareInterfaceBindingsV2(
  left: { nodeId: string; fieldId?: string; fieldOrPortId?: string },
  right: { nodeId: string; fieldId?: string; fieldOrPortId?: string },
) {
  const leftField = left.fieldId ?? left.fieldOrPortId ?? '';
  const rightField = right.fieldId ?? right.fieldOrPortId ?? '';
  if (left.nodeId !== right.nodeId) return left.nodeId < right.nodeId ? -1 : 1;
  if (leftField !== rightField) return leftField < rightField ? -1 : 1;
  return 0;
}

function moveInterfaceEntryV2<T>(values: readonly T[], index: number, offset: -1 | 1) {
  const target = index + offset;
  if (target < 0 || target >= values.length) return [...values];
  const next = [...values];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function mirrorOptionsV2(
  options: readonly InterfaceBindingOptionV2[],
  valueType: string,
  primary: { nodeId: string; fieldId: string },
  mirrors: readonly InterfaceMirrorBindingV2[],
) {
  const occupied = new Set([
    interfaceBindingKeyV2(primary.nodeId, primary.fieldId),
    ...mirrors.map(({ nodeId, fieldId }) => interfaceBindingKeyV2(nodeId, fieldId)),
  ]);
  return options.filter(
    (option) => !occupied.has(option.key) && blockValueTypesAreCompatibleV2(valueType, option.valueType),
  );
}

function MirrorBindingsEditorV2({
  entryKey,
  valueType,
  primary,
  mirrors,
  options,
  selected,
  disabled = false,
  onSelected,
  onAdd,
  onRemove,
}: {
  entryKey: string;
  valueType: string;
  primary: InterfaceMirrorBindingV2;
  mirrors: readonly InterfaceMirrorBindingV2[];
  options: readonly InterfaceBindingOptionV2[];
  selected: string;
  disabled?: boolean;
  onSelected: (value: string) => void;
  onAdd: (option: InterfaceBindingOptionV2) => void;
  onRemove: (binding: InterfaceMirrorBindingV2) => void;
}) {
  const available = mirrorOptionsV2(options, valueType, primary, mirrors);
  const labelByKey = new Map(options.map((option) => [option.key, option.label]));
  return (
    <div
      className="ml-3 grid gap-2 border-l border-modiff-border-subtle pl-3"
      data-testid={`interface-mirrors-${entryKey}`}
    >
      {mirrors.map((binding) => {
        const key = interfaceBindingKeyV2(binding.nodeId, binding.fieldId);
        return (
          <div key={key} className="flex min-w-0 items-center gap-2 text-xs text-modiff-subtle-text">
            <span className="min-w-0 flex-1 truncate">
              Additional consumer: {labelByKey.get(key) ?? `${binding.nodeId} / ${binding.fieldId}`}
            </span>
            <ModiffIconButton
              label={`Remove additional consumer ${labelByKey.get(key) ?? binding.fieldId}`}
              size="compact"
              disabled={disabled}
              data-testid={`interface-mirror-remove-${entryKey}-${binding.nodeId}-${binding.fieldId}`}
              onClick={() => onRemove(binding)}
            >
              <Trash2 size={13} />
            </ModiffIconButton>
          </div>
        );
      })}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <ModiffSelect
          value={selected}
          disabled={disabled}
          onValueChange={onSelected}
          options={available.map((option) => ({ value: option.key, label: option.label }))}
          placeholder="Add another internal consumer"
          data-testid={`interface-mirror-select-${entryKey}`}
        />
        <ModiffIconButton
          label="Add additional internal consumer"
          size="compact"
          disabled={disabled || !selected || !available.some(({ key }) => key === selected)}
          data-testid={`interface-mirror-add-${entryKey}`}
          onClick={() => {
            const option = available.find(({ key }) => key === selected);
            if (option) onAdd(option);
          }}
        >
          <Plus size={14} />
        </ModiffIconButton>
      </div>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function interfaceBindingOptionsV2(instance: BlockInstanceV2) {
  return instance.effectiveGraph.nodes.flatMap((node): InterfaceBindingOptionV2[] => {
    const params = isRecord(node.data.params) ? node.data.params : {};
    return Object.entries(params).flatMap(([fieldId, value]) => {
      if (!isRecord(value) || typeof value.type !== 'string' || !value.type) return [];
      return [
        {
          key: `${node.nodeId}\0${fieldId}`,
          nodeId: node.nodeId,
          fieldId,
          label: `${typeof node.data.label === 'string' ? node.data.label : node.nodeId} / ${typeof value.label === 'string' ? value.label : fieldId}`,
          valueType: value.type,
          ...(typeof value.display === 'string' ? { display: value.display } : {}),
        },
      ];
    });
  });
}

function interfaceEntryIdV2(
  direction: 'input' | 'output' | 'control',
  option: InterfaceBindingOptionV2,
  draft: InterfaceDraftV2,
) {
  const occupied = new Set([
    ...draft.boundary.inputs.map(({ portId }) => portId),
    ...draft.boundary.outputs.map(({ portId }) => portId),
    ...draft.controls.map(({ controlId }) => controlId),
  ]);
  const base = `${direction}:${option.nodeId}:${option.fieldId}`.replace(/[^A-Za-z0-9_.:/-]/gu, '-');
  let candidate = base;
  let suffix = 2;
  while (occupied.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

export default function BlockInterfaceDialogContentV2({
  nodeId,
  snapshot,
  subtreeId,
  context,
  onClose,
}: {
  nodeId: string;
  snapshot: BlockInstanceV2;
  subtreeId?: string;
  context: WorkflowOperationContext;
  onClose: () => void;
}) {
  const [interfaceDraft, setInterfaceDraft] = useState<InterfaceDraftV2 | null>(() =>
    blockInterfaceDraftV2(snapshot, subtreeId),
  );
  const [newInterfaceBinding, setNewInterfaceBinding] = useState({ input: '', output: '', control: '' });
  const [newMirrorBinding, setNewMirrorBinding] = useState<Record<string, string>>({});
  const included = useMemo(() => blockInterfaceScopeNodeIdsV2(snapshot, subtreeId), [snapshot, subtreeId]);
  const bindingOptions = useMemo(
    () => interfaceBindingOptionsV2(snapshot).filter(({ nodeId }) => included.has(nodeId)),
    [snapshot, included],
  );
  const inputBindingOptions = bindingOptions.filter(({ display }) => display !== 'output');
  const outputBindingOptions = bindingOptions.filter(({ display }) => display === 'output');
  const controlBindingOptions = inputBindingOptions;
  const edges = useFlowStore((state) => state.edges);
  let draftError: string | null = null;
  let mergedDraft: InterfaceDraftV2 | null = null;
  try {
    if (interfaceDraft) mergedDraft = mergeBlockInterfaceDraftV2(snapshot, snapshot, interfaceDraft, subtreeId);
  } catch (error) {
    draftError = error instanceof Error ? error.message : 'Invalid interface draft.';
  }
  const inputs = new Set(mergedDraft?.boundary.inputs.map(({ portId }) => portId));
  const outputs = new Set(mergedDraft?.boundary.outputs.map(({ portId }) => portId));
  const impactedInterfaceEdges = edges.filter(
    (edge) =>
      (edge.target === snapshot.instanceId && (!edge.targetHandle || !inputs.has(edge.targetHandle))) ||
      (edge.source === snapshot.instanceId && (!edge.sourceHandle || !outputs.has(edge.sourceHandle))),
  );
  function applyDraft() {
    assertWorkflowOperationContext(context, { includeForm: false });
    const current = useFlowStore.getState().nodes.find((node) => node.id === snapshot.instanceId)?.data.blockInstanceV2;
    if (!current || !interfaceDraft) throw new Error('This Block is no longer available. Reopen Configure Interface.');
    const merged = mergeBlockInterfaceDraftV2(snapshot, current, interfaceDraft, subtreeId);
    useFlowStore.getState().configureBlockInterfaceV2(snapshot.instanceId, merged);
  }
  return (
    <ModiffDialog
      open={Boolean(interfaceDraft)}
      onClose={() => onClose()}
      title="Configure Block interface"
      testId={`configure-block-v2-${nodeId}`}
      panelClassName="max-w-3xl"
      footer={
        <>
          <ModiffButton onClick={() => onClose()}>Cancel</ModiffButton>
          <ModiffButton
            tone="primary"
            disabled={!interfaceDraft || impactedInterfaceEdges.length > 0 || Boolean(draftError)}
            onClick={() => {
              if (!interfaceDraft) return;
              try {
                applyDraft();
                onClose();
                enqueueSnackbar('The workflow instance interface was updated.', {
                  variant: 'success',
                  autoHideDuration: 3000,
                });
              } catch (error) {
                enqueueSnackbar(error instanceof Error ? error.message : 'Could not configure this interface.', {
                  variant: 'error',
                  autoHideDuration: 5200,
                });
              }
            }}
          >
            Apply interface
          </ModiffButton>
        </>
      }
    >
      {interfaceDraft ? (
        <div className="grid gap-5">
          {subtreeId ? (
            <p
              className="rounded-modiff-compact border border-modiff-border-subtle p-3 text-sm text-modiff-subtle-text"
              data-testid="block-interface-scope"
            >
              Editing{' '}
              {String(snapshot.effectiveGraph.nodes.find((node) => node.nodeId === subtreeId)?.data.label || subtreeId)}
              's exposure through the owning Block interface. These controls appear on the containing Blocks. Other
              branches and shared cross-branch consumers are preserved; edit shared consumers from the root Block.
              Internal link sockets are derived from the graph's connections.
            </p>
          ) : null}
          {draftError ? (
            <p role="alert" className="text-modiff-red">
              {draftError}
            </p>
          ) : null}
          {impactedInterfaceEdges.length ? (
            <p className="rounded-modiff-compact border border-modiff-warning/50 bg-modiff-warning/10 p-3 text-sm text-modiff-text">
              {impactedInterfaceEdges.length} connected edge{impactedInterfaceEdges.length === 1 ? '' : 's'} would lose
              a public port. Disconnect {impactedInterfaceEdges.length === 1 ? 'it' : 'them'} before applying.
            </p>
          ) : null}
          {(
            [
              ['input', 'Inputs', inputBindingOptions],
              ['output', 'Outputs', outputBindingOptions],
            ] as const
          ).map(([direction, title, options]) => {
            const ports = interfaceDraft.boundary[direction === 'input' ? 'inputs' : 'outputs'];
            return (
              <section key={direction} className="grid gap-2">
                <h3 className="text-sm font-semibold text-modiff-text">{title}</h3>
                {ports.map((port, portIndex) => {
                  const entryKey = `${direction}:${port.portId}`;
                  const mirrors =
                    (direction === 'input' ? port.mirrorBindings : undefined)?.map((binding) => ({
                      nodeId: binding.nodeId,
                      fieldId: binding.fieldOrPortId,
                    })) ?? [];
                  return (
                    <div
                      key={port.portId}
                      className="grid gap-2 rounded-modiff-compact border border-modiff-border-subtle p-2"
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-2">
                        <ModiffInput
                          aria-label={`${direction} ${port.portId} label`}
                          value={port.label}
                          onChange={(event) => {
                            const label = event.currentTarget.value;
                            setInterfaceDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    boundary: {
                                      ...current.boundary,
                                      [direction === 'input' ? 'inputs' : 'outputs']: ports.map((candidate) =>
                                        candidate.portId === port.portId ? { ...candidate, label } : candidate,
                                      ),
                                    },
                                  }
                                : current,
                            );
                          }}
                        />
                        <ModiffSelect
                          value={interfaceBindingKeyV2(port.binding.nodeId, port.binding.fieldOrPortId)}
                          onValueChange={(key) => {
                            const option = options.find((candidate) => candidate.key === key);
                            if (!option) return;
                            setInterfaceDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    boundary: {
                                      ...current.boundary,
                                      [direction === 'input' ? 'inputs' : 'outputs']: ports.map((candidate) =>
                                        candidate.portId === port.portId
                                          ? (() => {
                                              const withoutMirrors = { ...candidate };
                                              delete withoutMirrors.mirrorBindings;
                                              return {
                                                ...withoutMirrors,
                                                valueType: option.valueType,
                                                binding: {
                                                  nodeId: option.nodeId,
                                                  fieldOrPortId: option.fieldId,
                                                },
                                              };
                                            })()
                                          : candidate,
                                      ),
                                    },
                                  }
                                : current,
                            );
                            setNewMirrorBinding((current) => ({ ...current, [entryKey]: '' }));
                          }}
                          options={options.map((option) => ({ value: option.key, label: option.label }))}
                        />
                        <div className="flex items-center gap-1">
                          <ModiffIconButton
                            label={`Move ${direction} ${port.label} up`}
                            size="compact"
                            disabled={portIndex === 0}
                            onClick={() =>
                              setInterfaceDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      boundary: {
                                        ...current.boundary,
                                        [direction === 'input' ? 'inputs' : 'outputs']: moveInterfaceEntryV2(
                                          ports,
                                          portIndex,
                                          -1,
                                        ),
                                      },
                                    }
                                  : current,
                              )
                            }
                          >
                            <ChevronUp size={14} />
                          </ModiffIconButton>
                          <ModiffIconButton
                            label={`Move ${direction} ${port.label} down`}
                            size="compact"
                            disabled={portIndex === ports.length - 1}
                            onClick={() =>
                              setInterfaceDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      boundary: {
                                        ...current.boundary,
                                        [direction === 'input' ? 'inputs' : 'outputs']: moveInterfaceEntryV2(
                                          ports,
                                          portIndex,
                                          1,
                                        ),
                                      },
                                    }
                                  : current,
                              )
                            }
                          >
                            <ChevronDown size={14} />
                          </ModiffIconButton>
                          <ModiffIconButton
                            label={`Remove ${direction} ${port.label}`}
                            size="compact"
                            onClick={() =>
                              setInterfaceDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      boundary: {
                                        ...current.boundary,
                                        [direction === 'input' ? 'inputs' : 'outputs']: ports.filter(
                                          (candidate) => candidate.portId !== port.portId,
                                        ),
                                      },
                                    }
                                  : current,
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </ModiffIconButton>
                        </div>
                      </div>
                      {direction === 'input' ? (
                        <MirrorBindingsEditorV2
                          entryKey={entryKey}
                          valueType={port.valueType}
                          primary={{ nodeId: port.binding.nodeId, fieldId: port.binding.fieldOrPortId }}
                          mirrors={mirrors}
                          options={inputBindingOptions}
                          selected={newMirrorBinding[entryKey] ?? ''}
                          onSelected={(value) => setNewMirrorBinding((current) => ({ ...current, [entryKey]: value }))}
                          onAdd={(option) => {
                            setInterfaceDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    boundary: {
                                      ...current.boundary,
                                      inputs: current.boundary.inputs.map((candidate) =>
                                        candidate.portId === port.portId
                                          ? {
                                              ...candidate,
                                              mirrorBindings: [
                                                ...(candidate.mirrorBindings ?? []),
                                                {
                                                  nodeId: option.nodeId,
                                                  fieldOrPortId: option.fieldId,
                                                },
                                              ].sort(compareInterfaceBindingsV2),
                                            }
                                          : candidate,
                                      ),
                                    },
                                  }
                                : current,
                            );
                            setNewMirrorBinding((current) => ({ ...current, [entryKey]: '' }));
                          }}
                          onRemove={(binding) =>
                            setInterfaceDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    boundary: {
                                      ...current.boundary,
                                      inputs: current.boundary.inputs.map((candidate) => {
                                        if (candidate.portId !== port.portId) return candidate;
                                        const next = (candidate.mirrorBindings ?? []).filter(
                                          (mirror) =>
                                            mirror.nodeId !== binding.nodeId ||
                                            mirror.fieldOrPortId !== binding.fieldId,
                                        );
                                        const withoutMirrors = { ...candidate };
                                        delete withoutMirrors.mirrorBindings;
                                        return next.length
                                          ? { ...withoutMirrors, mirrorBindings: next }
                                          : withoutMirrors;
                                      }),
                                    },
                                  }
                                : current,
                            )
                          }
                        />
                      ) : null}
                    </div>
                  );
                })}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <ModiffSelect
                    value={newInterfaceBinding[direction]}
                    onValueChange={(value) => setNewInterfaceBinding((current) => ({ ...current, [direction]: value }))}
                    options={options.map((option) => ({ value: option.key, label: option.label }))}
                    placeholder={`Choose an internal ${direction} field`}
                  />
                  <ModiffIconButton
                    label={`Add public ${direction}`}
                    size="compact"
                    disabled={!newInterfaceBinding[direction]}
                    onClick={() => {
                      const option = options.find((candidate) => candidate.key === newInterfaceBinding[direction]);
                      if (!option) return;
                      const portId = interfaceEntryIdV2(direction, option, interfaceDraft);
                      const port = {
                        portId,
                        label: option.label,
                        valueType: option.valueType,
                        required: false,
                        binding: { nodeId: option.nodeId, fieldOrPortId: option.fieldId },
                      };
                      setInterfaceDraft((current) =>
                        current
                          ? {
                              ...current,
                              boundary: {
                                ...current.boundary,
                                [direction === 'input' ? 'inputs' : 'outputs']: [...ports, port],
                              },
                            }
                          : current,
                      );
                      setNewInterfaceBinding((current) => ({ ...current, [direction]: '' }));
                    }}
                  >
                    <Plus size={14} />
                  </ModiffIconButton>
                </div>
              </section>
            );
          })}
          <section className="grid gap-2">
            <h3 className="text-sm font-semibold text-modiff-text">Editable controls</h3>
            {interfaceDraft.controls.map((control, controlIndex) => {
              const entryKey = `control:${control.controlId}`;
              const mirrors = control.mirrorBindings ?? [];
              return (
                <div
                  key={control.controlId}
                  className="grid gap-2 rounded-modiff-compact border border-modiff-border-subtle p-2"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-2">
                    <ModiffInput
                      aria-label={`control ${control.controlId} label`}
                      value={control.label}
                      onChange={(event) => {
                        const label = event.currentTarget.value;
                        setInterfaceDraft((current) =>
                          current
                            ? {
                                ...current,
                                controls: current.controls.map((candidate) =>
                                  candidate.controlId === control.controlId ? { ...candidate, label } : candidate,
                                ),
                              }
                            : current,
                        );
                      }}
                    />
                    <ModiffSelect
                      value={interfaceBindingKeyV2(control.binding.nodeId, control.binding.fieldId)}
                      disabled={Boolean(control.sealed)}
                      onValueChange={(key) => {
                        const option = controlBindingOptions.find((candidate) => candidate.key === key);
                        if (!option) return;
                        setInterfaceDraft((current) =>
                          current
                            ? {
                                ...current,
                                controls: current.controls.map((candidate) =>
                                  candidate.controlId === control.controlId
                                    ? (() => {
                                        const withoutMirrors = { ...candidate };
                                        delete withoutMirrors.mirrorBindings;
                                        return {
                                          ...withoutMirrors,
                                          valueType: option.valueType,
                                          binding: { nodeId: option.nodeId, fieldId: option.fieldId },
                                        };
                                      })()
                                    : candidate,
                                ),
                              }
                            : current,
                        );
                        setNewMirrorBinding((current) => ({ ...current, [entryKey]: '' }));
                      }}
                      options={controlBindingOptions.map((option) => ({ value: option.key, label: option.label }))}
                    />
                    <div className="flex items-center gap-1">
                      <ModiffIconButton
                        label={`Move control ${control.label} up`}
                        size="compact"
                        disabled={controlIndex === 0}
                        onClick={() =>
                          setInterfaceDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  controls: moveInterfaceEntryV2(current.controls, controlIndex, -1).map(
                                    (candidate, order) => ({ ...candidate, order }),
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        <ChevronUp size={14} />
                      </ModiffIconButton>
                      <ModiffIconButton
                        label={`Move control ${control.label} down`}
                        size="compact"
                        disabled={controlIndex === interfaceDraft.controls.length - 1}
                        onClick={() =>
                          setInterfaceDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  controls: moveInterfaceEntryV2(current.controls, controlIndex, 1).map(
                                    (candidate, order) => ({ ...candidate, order }),
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        <ChevronDown size={14} />
                      </ModiffIconButton>
                      <ModiffIconButton
                        label={`Remove control ${control.label}`}
                        size="compact"
                        disabled={Boolean(control.sealed)}
                        onClick={() =>
                          setInterfaceDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  controls: current.controls
                                    .filter((candidate) => candidate.controlId !== control.controlId)
                                    .map((candidate, order) => ({ ...candidate, order })),
                                }
                              : current,
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </ModiffIconButton>
                    </div>
                  </div>
                  <MirrorBindingsEditorV2
                    entryKey={entryKey}
                    valueType={control.valueType}
                    primary={control.binding}
                    mirrors={mirrors}
                    options={controlBindingOptions}
                    selected={newMirrorBinding[entryKey] ?? ''}
                    disabled={Boolean(control.sealed)}
                    onSelected={(value) => setNewMirrorBinding((current) => ({ ...current, [entryKey]: value }))}
                    onAdd={(option) => {
                      setInterfaceDraft((current) =>
                        current
                          ? {
                              ...current,
                              controls: current.controls.map((candidate) =>
                                candidate.controlId === control.controlId
                                  ? {
                                      ...candidate,
                                      mirrorBindings: [
                                        ...(candidate.mirrorBindings ?? []),
                                        { nodeId: option.nodeId, fieldId: option.fieldId },
                                      ].sort(compareInterfaceBindingsV2),
                                    }
                                  : candidate,
                              ),
                            }
                          : current,
                      );
                      setNewMirrorBinding((current) => ({ ...current, [entryKey]: '' }));
                    }}
                    onRemove={(binding) =>
                      setInterfaceDraft((current) =>
                        current
                          ? {
                              ...current,
                              controls: current.controls.map((candidate) => {
                                if (candidate.controlId !== control.controlId) return candidate;
                                const next = (candidate.mirrorBindings ?? []).filter(
                                  (mirror) => mirror.nodeId !== binding.nodeId || mirror.fieldId !== binding.fieldId,
                                );
                                const withoutMirrors = { ...candidate };
                                delete withoutMirrors.mirrorBindings;
                                return next.length ? { ...withoutMirrors, mirrorBindings: next } : withoutMirrors;
                              }),
                            }
                          : current,
                      )
                    }
                  />
                </div>
              );
            })}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <ModiffSelect
                value={newInterfaceBinding.control}
                onValueChange={(value) => setNewInterfaceBinding((current) => ({ ...current, control: value }))}
                options={controlBindingOptions.map((option) => ({ value: option.key, label: option.label }))}
                placeholder="Choose an internal parameter"
              />
              <ModiffIconButton
                label="Add editable control"
                size="compact"
                disabled={!newInterfaceBinding.control}
                onClick={() => {
                  const option = controlBindingOptions.find(
                    (candidate) => candidate.key === newInterfaceBinding.control,
                  );
                  if (!option) return;
                  const controlId = interfaceEntryIdV2('control', option, interfaceDraft);
                  const defaultValue = blockInterfaceFieldValueV2(snapshot, option.nodeId, option.fieldId);
                  setInterfaceDraft((current) =>
                    current
                      ? {
                          ...current,
                          controls: [
                            ...current.controls,
                            {
                              controlId,
                              label: option.label,
                              binding: { nodeId: option.nodeId, fieldId: option.fieldId },
                              valueType: option.valueType,
                              ...(defaultValue === undefined ? {} : { defaultValue }),
                              order: current.controls.length,
                            },
                          ],
                        }
                      : current,
                  );
                  setNewInterfaceBinding((current) => ({ ...current, control: '' }));
                }}
              >
                <Plus size={14} />
              </ModiffIconButton>
            </div>
          </section>
        </div>
      ) : null}
    </ModiffDialog>
  );
}
