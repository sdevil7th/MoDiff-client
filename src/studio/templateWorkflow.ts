import { useSettingsStore } from '../stores/useSettingsStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import {
  advanceWorkflowOperationContext,
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  currentAutoResourcePlanTarget,
  isWorkflowOperationCancelled,
  useStudioStore,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { diffStudioFormValues, publishStudioChange } from './presetDiff';
import { createOrUpdateStudioGraph, waitForStudioGraphFinalization } from './graphBridge';
import {
  autoPlanIsReady,
  autoPlanKeyForForm,
  fetchAutoResourcePlan,
  formPatchForAutoCandidate,
  selectedAutoCandidate,
} from './autoResource';
import { getTemplateLockedSettings } from './templateExactness';
import { materializeTemplateDefaultInputs } from './templateInputs';
import { waitForGraphNodeMeasurements } from '../workflow/graphLayout';
import {
  addLoraWorkflowBlock,
  addLyricVideoWorkflowBlock,
  addQualityVideoSequenceWorkflowBlock,
  addSoundtrackWorkflowBlock,
  addUpscaleWorkflowBlock,
  addVideoSequenceWorkflowBlock,
} from './controlledWorkflows';
import type { StudioFormState, StudioTemplate, StudioTemplateWorkflowBlock } from './types';

export type TemplateWorkflowResult = {
  graphCreated: boolean;
  graphError?: string;
  warnings: string[];
};

async function applyWorkflowBlock(
  block: StudioTemplateWorkflowBlock,
  form: StudioFormState,
  template: StudioTemplate,
  options: { graphPrepared?: boolean; notify?: boolean; workflowContext?: WorkflowOperationContext } = {},
) {
  if (block === 'lora') {
    await addLoraWorkflowBlock(form, template.workflowBlockSettings?.lora, options);
    return;
  }
  if (block === 'upscaler') {
    await addUpscaleWorkflowBlock(form, template.workflowBlockSettings?.upscaler, options);
    return;
  }
  if (block === 'video_sequence') {
    await addVideoSequenceWorkflowBlock(form, template.workflowBlockSettings?.videoSequence, options);
    return;
  }
  if (block === 'quality_video_sequence') {
    await addQualityVideoSequenceWorkflowBlock(form, template.workflowBlockSettings?.qualityVideoSequence, options);
    return;
  }
  if (block === 'soundtrack') {
    await addSoundtrackWorkflowBlock(form, template.workflowBlockSettings?.soundtrack, options);
    return;
  }
  await addLyricVideoWorkflowBlock(form, template.workflowBlockSettings?.lyricVideo, options);
}

export async function reconcileTemplateWorkflowBlocks(
  template: StudioTemplate,
  form: StudioFormState,
  context: WorkflowOperationContext = captureWorkflowOperationContext(),
) {
  assertWorkflowOperationContext(context);
  const failures: string[] = [];
  for (const block of template.workflowBlocks ?? []) {
    try {
      await applyWorkflowBlock(block, form, template, { notify: false, workflowContext: context });
      assertWorkflowOperationContext(context);
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) throw error;
      failures.push(`${block}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const finalized = await waitForStudioGraphFinalization(15_000, context);
  assertWorkflowOperationContext(context);
  if (!finalized) {
    throw new Error('Template workflow block preparation timed out. Retry the Auto/Expert mode change.');
  }
  if (failures.length > 0) {
    throw new Error(`Could not reconcile template workflow blocks: ${failures.join('; ')}`);
  }
}

function waitForTemplateCanvasPaint() {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function blankCurrentCanvas() {
  useFlowStore.getState().replaceGraph({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

export async function createWorkflowFromTemplate(template: StudioTemplate): Promise<TemplateWorkflowResult> {
  const studio = useStudioStore.getState();
  const workflowTabId = studio.createWorkflowTab(template.label, undefined, 'template', template.id);
  const context = captureWorkflowOperationContext();
  useStudioStore.getState().setCanvasTransition({
    type: 'template_graph_building',
    workflowTabId,
    templateId: template.id,
    startedAt: Date.now(),
  });
  const before = useStudioStore.getState().form;
  let after = before;

  let graphCreated = false;
  let graphError: string | undefined;
  let warnings: string[] = [];

  try {
    // Do not construct a legacy skeleton while initial backend execution
    // definitions are still loading. Their arrival would invalidate it.
    if (useNodesStore.getState().discoveryRequests.capabilities.status !== 'success') {
      await useNodesStore.getState().fetchStudioModelCapabilities();
      assertWorkflowOperationContext(context);
      const discovery = useNodesStore.getState().discoveryRequests.capabilities;
      if (discovery.status !== 'success')
        throw new Error(discovery.error || 'Model capabilities are not ready. Retry opening the template.');
    }
    const inputDefaults = await materializeTemplateDefaultInputs(template);
    assertWorkflowOperationContext(context);
    useStudioStore.getState().applyTemplate(template, inputDefaults);
    advanceWorkflowOperationContext(context);
    useStudioStore.getState().saveActiveWorkflowTab(true);
    after = useStudioStore.getState().form;
    await waitForTemplateCanvasPaint();
    assertWorkflowOperationContext(context);
    let result = await createOrUpdateStudioGraph(after, context);
    assertWorkflowOperationContext(context);
    if (after.resourceMode === 'auto') {
      const initialPlanKey = autoPlanKeyForForm(after);
      const plan = useStudioStore.getState().autoResourcePlans[initialPlanKey] ?? (await fetchAutoResourcePlan(after));
      assertWorkflowOperationContext(context);
      if (!plan.error) useStudioStore.getState().setAutoResourcePlans({ [initialPlanKey]: plan });
      useStudioStore.getState().setAutoResourcePlan(plan);
      if (autoPlanIsReady(plan, after)) {
        const target = currentAutoResourcePlanTarget(plan, after, useStudioStore.getState().graphBinding);
        if (target) {
          useStudioStore.getState().setLastError(target);
        } else {
          const patch = formPatchForAutoCandidate(selectedAutoCandidate(plan, after), after);
          useStudioStore.getState().applyAutoResourcePlan(plan, patch);
          advanceWorkflowOperationContext(context);
          after = useStudioStore.getState().form;
          result = await createOrUpdateStudioGraph(after, context);
          assertWorkflowOperationContext(context);
        }
      }
    }
    graphCreated = true;
    warnings = result.warnings;
    for (const block of template.workflowBlocks ?? []) {
      try {
        await applyWorkflowBlock(block, after, template, { graphPrepared: true, workflowContext: context });
        assertWorkflowOperationContext(context);
      } catch (error) {
        if (isWorkflowOperationCancelled(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${template.label} could not add the ${block} block: ${message}`);
      }
    }
    const finalized = await waitForStudioGraphFinalization(15_000, context);
    assertWorkflowOperationContext(context);
    if (!finalized) {
      throw new Error(`${template.label} graph preparation timed out. No incomplete graph was kept; try again.`);
    }
    await waitForGraphNodeMeasurements(() => useFlowStore.getState().nodes, 500);
    assertWorkflowOperationContext(context);
    await useFlowStore.getState().arrangeGraph({ history: false });
    assertWorkflowOperationContext(context);
    await waitForTemplateCanvasPaint();
    assertWorkflowOperationContext(context);
    useStudioStore.getState().saveActiveWorkflowTab(true);
  } catch (error) {
    if (isWorkflowOperationCancelled(error)) throw error;
    assertWorkflowOperationContext(context);
    graphError = error instanceof Error ? error.message : String(error);
    blankCurrentCanvas();
    useStudioStore.getState().setGraphBinding(null);
    useStudioStore.getState().setGraphFinalization(null);
    useStudioStore.getState().saveActiveWorkflowTab(true);
  } finally {
    const transition = useStudioStore.getState().canvasTransition;
    if (transition?.workflowTabId === workflowTabId && transition.templateId === template.id) {
      useStudioStore.getState().setCanvasTransition(null);
    }
  }

  const changedKeys = Object.keys(getTemplateLockedSettings(template)) as Array<keyof StudioFormState>;
  const fields = diffStudioFormValues(before, after, changedKeys);
  publishStudioChange(
    `${template.label} recipe applied`,
    fields,
    useStudioStore.getState().graphBinding?.managedNodeIds ?? [],
  );

  useSettingsStore.getState().setRightPanelOpen(true);
  useSettingsStore.getState().setRightPanelTab('studio');

  return { graphCreated, graphError, warnings };
}
