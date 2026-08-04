import { Play, Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import { useFlowStore } from '../stores/useFlowStore';
import {
  captureWorkflowOperationContext,
  isWorkflowOperationCancelled,
  useStudioStore,
} from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { syncStudioGraphValues } from '../studio/graphBridge';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { validateCurrentRun } from '../studio/runReadiness';
import { ensureStudioAutoPlanReadyForRun } from '../studio/useStudioRunActions';
import type { AppModeConfig, AppModeInput, StudioFormState } from '../studio/types';
import {
  SectionHeader,
  ModiffFieldShell,
  StudioButton,
  StudioCheckbox,
  StudioChip,
  StudioInput,
  StudioSelect,
  StudioSlider,
  StatusLine,
} from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';

const FORM_INPUTS: AppModeInput[] = [
  { id: 'studio:prompt', kind: 'studio-form', label: 'Prompt', formKey: 'prompt' },
  { id: 'studio:negativePrompt', kind: 'studio-form', label: 'Negative prompt', formKey: 'negativePrompt' },
  { id: 'studio:seed', kind: 'studio-form', label: 'Seed', formKey: 'seed' },
  { id: 'studio:steps', kind: 'studio-form', label: 'Steps', formKey: 'steps' },
  { id: 'studio:guidanceScale', kind: 'studio-form', label: 'Guidance', formKey: 'guidanceScale' },
  { id: 'studio:strength', kind: 'studio-form', label: 'Strength', formKey: 'strength' },
  { id: 'studio:width', kind: 'studio-form', label: 'Width', formKey: 'width' },
  { id: 'studio:height', kind: 'studio-form', label: 'Height', formKey: 'height' },
  { id: 'studio:referenceImages', kind: 'studio-form', label: 'Reference images', formKey: 'referenceImages' },
  { id: 'studio:controlImage', kind: 'studio-form', label: 'Control image', formKey: 'controlImage' },
  { id: 'studio:maskImage', kind: 'studio-form', label: 'Mask image', formKey: 'maskImage' },
];

function isNode(value: unknown): value is {
  id: string;
  data?: {
    label?: string;
    params?: Record<string, { label?: string; value?: unknown; default?: unknown; isInput?: boolean }>;
  };
} {
  return Boolean(
    value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string',
  );
}

function graphInputs(nodes: unknown[]): AppModeInput[] {
  return nodes.filter(isNode).flatMap((node) =>
    Object.entries(node.data?.params ?? {})
      .filter(([key, param]) => !param.isInput && !['image', 'output', 'images', 'latents'].includes(key))
      .slice(0, 10)
      .map(([key, param]) => ({
        id: `graph:${node.id}:${key}`,
        kind: 'graph-param' as const,
        label: `${node.data?.label || node.id} / ${param.label || key}`,
        nodeId: node.id,
        paramKey: key,
      })),
  );
}

function graphOutputs(nodes: unknown[]) {
  return nodes
    .filter(isNode)
    .filter((node) => /preview|save|output|video|audio|image/i.test(`${node.data?.label ?? ''} ${node.id}`))
    .map((node) => ({
      id: `output:${node.id}`,
      label: node.data?.label || node.id,
      nodeId: node.id,
      fieldKey: 'output',
    }));
}

function numberValue(value: string, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function formatFormValue(value: StudioFormState[keyof StudioFormState]) {
  if (Array.isArray(value)) return value.join('\n');
  return String(value ?? '');
}

function parseFormValue(form: StudioFormState, key: keyof StudioFormState, value: string) {
  const current = form[key];
  if (Array.isArray(current))
    return value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  if (typeof current === 'number') return numberValue(value, current);
  if (typeof current === 'boolean') return value === 'true';
  return value;
}

function inputSelected(config: AppModeConfig, input: AppModeInput) {
  return config.exposedInputs.some((item) => item.id === input.id);
}

export default function AppModePanel() {
  const form = useStudioStore((state) => state.form);
  const workflowTabs = useStudioStore((state) => state.workflowTabs);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const appModeConfigs = useStudioStore((state) => state.appModeConfigs);
  const activeAppModeConfigId = useStudioStore((state) => state.activeAppModeConfigId);
  const createAppModeConfig = useStudioStore((state) => state.createAppModeConfig);
  const updateAppModeConfig = useStudioStore((state) => state.updateAppModeConfig);
  const deleteAppModeConfig = useStudioStore((state) => state.deleteAppModeConfig);
  const setActiveAppModeConfig = useStudioStore((state) => state.setActiveAppModeConfig);
  const switchWorkflowTab = useStudioStore((state) => state.switchWorkflowTab);
  const updateForm = useStudioStore((state) => state.updateForm);
  const nodes = useFlowStore((state) => state.nodes);
  const sid = useWebsocketStore((state) => state.sid);
  const isConnected = useWebsocketStore((state) => state.isConnected);

  const selectedConfig =
    appModeConfigs.find((config) => config.id === activeAppModeConfigId) ?? appModeConfigs[0] ?? null;
  const selectedTab =
    workflowTabs.find((tab) => tab.id === selectedConfig?.workflowTabId) ??
    workflowTabs.find((tab) => tab.id === activeWorkflowTabId) ??
    null;
  const configIsActive = Boolean(selectedConfig && selectedConfig.workflowTabId === activeWorkflowTabId);
  const sourceNodes = useMemo(
    () => (configIsActive ? nodes : (selectedTab?.snapshot.nodes ?? [])),
    [configIsActive, nodes, selectedTab],
  );
  const availableInputs = useMemo(() => [...FORM_INPUTS, ...graphInputs(sourceNodes)], [sourceNodes]);
  const availableOutputs = useMemo(() => graphOutputs(sourceNodes), [sourceNodes]);
  const canCreateAppMode = Boolean(activeWorkflowTabId && sourceNodes.length > 0 && availableOutputs.length > 0);
  const canRunAppMode = Boolean(selectedConfig && selectedConfig.exposedOutputs.length > 0 && sid && isConnected);

  const createForActive = () => {
    if (!canCreateAppMode) {
      enqueueSnackbar('Use a graph with at least one output node before creating Run as app.', {
        variant: 'error',
        autoHideDuration: 3500,
      });
      return;
    }
    const id = createAppModeConfig(activeWorkflowTabId);
    if (id) {
      enqueueSnackbar('Run as app created for this workflow', { variant: 'success', autoHideDuration: 2000 });
    }
  };

  const toggleInput = (input: AppModeInput) => {
    if (!selectedConfig) return;
    const exposedInputs = inputSelected(selectedConfig, input)
      ? selectedConfig.exposedInputs.filter((item) => item.id !== input.id)
      : [...selectedConfig.exposedInputs, input];
    updateAppModeConfig(selectedConfig.id, { exposedInputs });
  };

  const toggleOutput = (output: AppModeConfig['exposedOutputs'][number]) => {
    if (!selectedConfig) return;
    const exposedOutputs = selectedConfig.exposedOutputs.some((item) => item.id === output.id)
      ? selectedConfig.exposedOutputs.filter((item) => item.id !== output.id)
      : [...selectedConfig.exposedOutputs, output];
    updateAppModeConfig(selectedConfig.id, { exposedOutputs });
  };

  const updateFormInput = (input: AppModeInput, value: string) => {
    if (input.kind !== 'studio-form' || !input.formKey) return;
    updateForm({ [input.formKey]: parseFormValue(form, input.formKey, value) } as Partial<StudioFormState>);
    queueMicrotask(() => syncStudioGraphValues());
  };

  const updateGraphInput = (input: AppModeInput, value: string) => {
    if (input.kind !== 'graph-param' || !input.nodeId || !input.paramKey) return;
    useFlowStore.getState().setParamWithHistory(input.nodeId, input.paramKey, value);
  };

  const runApp = async () => {
    if (!selectedConfig || !sid || !isConnected) {
      enqueueSnackbar('Connect to the MoDiff server before running as app.', {
        variant: 'error',
        autoHideDuration: 4000,
      });
      return;
    }
    if (selectedConfig.exposedOutputs.length === 0) {
      enqueueSnackbar('Expose at least one output before running as app.', {
        variant: 'error',
        autoHideDuration: 3500,
      });
      return;
    }
    if (selectedConfig.workflowTabId !== activeWorkflowTabId) {
      switchWorkflowTab(selectedConfig.workflowTabId);
    }
    const context = captureWorkflowOperationContext();
    const managedGraph = Boolean(useStudioStore.getState().graphBinding);
    try {
      if (managedGraph) {
        const autoReady = await ensureStudioAutoPlanReadyForRun(context);
        if (!autoReady) return;
      }
      const validation = validateCurrentRun({ sid, isConnected, includeStudio: managedGraph, showDialog: true });
      if (!validation.canRun) return;
      await coordinateGraphRun({
        sid,
        studioContext: { applyRuntimeMetadata: managedGraph },
        workflowContext: context,
      });
      enqueueSnackbar('Run as app queued', { variant: 'success', autoHideDuration: 2200 });
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    }
  };

  return (
    <div className="grid gap-3 p-3 text-sm text-modiff-text" data-testid="app-mode-panel">
      <section>
        <SectionHeader
          title="Run as app"
          action={
            <StudioButton
              tone="primary"
              icon={<Plus size={15} />}
              disabled={!canCreateAppMode}
              onClick={createForActive}
              data-testid="app-mode-create"
            >
              Create
            </StudioButton>
          }
        />
        <StatusLine>Expose selected inputs and outputs from this graph.</StatusLine>
      </section>

      {appModeConfigs.length > 0 && (
        <StudioSelect
          aria-label="Saved app configuration"
          value={selectedConfig?.id ?? ''}
          onValueChange={setActiveAppModeConfig}
          options={appModeConfigs.map((config) => ({ value: config.id, label: config.name }))}
        />
      )}

      {!selectedConfig ? (
        <div className="border border-modiff-border bg-modiff-bg p-3 text-xs text-modiff-subtle-text">
          Create Run as app from the active graph.
        </div>
      ) : (
        <>
          <section className="grid gap-2 border border-modiff-border bg-modiff-panel p-3">
            <StudioInput
              label="App name"
              value={selectedConfig.name}
              onChange={(value) => updateAppModeConfig(selectedConfig.id, { name: value })}
            />
            <div className="flex flex-wrap items-center gap-2">
              <StudioChip active={configIsActive}>{configIsActive ? 'Workflow open' : 'Workflow saved'}</StudioChip>
              <StudioChip>{selectedTab?.title ?? 'Missing workflow'}</StudioChip>
              {!configIsActive && (
                <StudioButton tone="ghost" onClick={() => switchWorkflowTab(selectedConfig.workflowTabId)}>
                  Open workflow
                </StudioButton>
              )}
              <StudioButton
                tone="danger"
                icon={<Trash2 size={15} />}
                onClick={() => deleteAppModeConfig(selectedConfig.id)}
              >
                Delete
              </StudioButton>
            </div>
          </section>

          <section>
            <SectionHeader title="Choose inputs" />
            <div className="grid gap-1">
              {availableInputs.slice(0, 36).map((input) => (
                <StudioCheckbox
                  key={input.id}
                  checked={inputSelected(selectedConfig, input)}
                  label={input.label}
                  onChange={() => toggleInput(input)}
                />
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title="Guided inputs" />
            <div className="grid gap-2">
              {selectedConfig.exposedInputs.length === 0 && <StatusLine>No inputs exposed yet.</StatusLine>}
              {selectedConfig.exposedInputs.map((input) => {
                if (input.kind === 'studio-form' && input.formKey) {
                  const current = form[input.formKey];
                  if (input.formKey === 'guidanceScale' || input.formKey === 'strength') {
                    return (
                      <ModiffFieldShell key={input.id} label={`${input.label}: ${String(current)}`}>
                        <StudioSlider
                          min={0}
                          max={input.formKey === 'strength' ? 1 : 12}
                          step={0.05}
                          value={typeof current === 'number' ? current : 0}
                          onChange={(value) => updateFormInput(input, String(value))}
                        />
                      </ModiffFieldShell>
                    );
                  }
                  return (
                    <StudioInput
                      key={input.id}
                      label={input.label}
                      disabled={!configIsActive}
                      multiline={
                        input.formKey === 'prompt' ||
                        input.formKey === 'negativePrompt' ||
                        input.formKey === 'referenceImages'
                      }
                      value={formatFormValue(current)}
                      onChange={(value) => updateFormInput(input, value)}
                    />
                  );
                }
                return (
                  <StudioInput
                    key={input.id}
                    label={input.label}
                    disabled={!configIsActive}
                    value={String(
                      input.nodeId && input.paramKey
                        ? (useFlowStore.getState().getParam(input.nodeId, input.paramKey, 'value') ?? '')
                        : '',
                    )}
                    onChange={(value) => updateGraphInput(input, value)}
                  />
                );
              })}
            </div>
          </section>

          <section>
            <SectionHeader title="Outputs" />
            <div className="grid gap-1">
              {availableOutputs.length === 0 && <StatusLine>No output nodes detected.</StatusLine>}
              {availableOutputs.map((output) => (
                <StudioCheckbox
                  key={output.id}
                  checked={selectedConfig.exposedOutputs.some((item) => item.id === output.id)}
                  label={output.label}
                  onChange={() => toggleOutput(output)}
                />
              ))}
            </div>
          </section>

          <StudioButton
            tone="primary"
            icon={<Play size={15} />}
            disabled={!canRunAppMode}
            onClick={() => {
              void runApp();
            }}
            data-testid="app-mode-run"
          >
            Run app
          </StudioButton>
        </>
      )}
    </div>
  );
}
