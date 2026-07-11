import { useSettingsStore } from '../stores/useSettingsStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';
import { diffStudioFormValues, publishStudioChange } from './presetDiff';
import { createOrUpdateStudioGraph } from './graphBridge';
import { getTemplateLockedSettings } from './templateExactness';
import { addLoraWorkflowBlock, addUpscaleWorkflowBlock } from './controlledWorkflows';
import type { StudioFormState, StudioTemplate, StudioTemplateWorkflowBlock } from './types';

export type TemplateWorkflowResult = {
  graphCreated: boolean;
  graphError?: string;
  warnings: string[];
};

async function applyWorkflowBlock(block: StudioTemplateWorkflowBlock, form: StudioFormState, template: StudioTemplate) {
  if (block === 'lora') {
    await addLoraWorkflowBlock(form, template.workflowBlockSettings?.lora);
    return;
  }
  await addUpscaleWorkflowBlock(form, template.workflowBlockSettings?.upscaler);
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
  useStudioStore.getState().setCanvasTransition({
    type: 'template_graph_building',
    workflowTabId,
    templateId: template.id,
    startedAt: Date.now(),
  });
  const before = useStudioStore.getState().form;
  useStudioStore.getState().applyTemplate(template);
  const after = useStudioStore.getState().form;

  let graphCreated = false;
  let graphError: string | undefined;
  let warnings: string[] = [];

  try {
    await waitForTemplateCanvasPaint();
    const result = await createOrUpdateStudioGraph(after);
    graphCreated = true;
    warnings = result.warnings;
    for (const block of template.workflowBlocks ?? []) {
      try {
        await applyWorkflowBlock(block, after, template);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${template.label} could not add the ${block} block: ${message}`);
      }
    }
  } catch (error) {
    graphError = error instanceof Error ? error.message : String(error);
    blankCurrentCanvas();
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
