import { workflowTaskLabel, type WorkflowChoice } from './workflowChoices';

export const WORKFLOW_CATEGORIES = ['Image', 'Audio', 'Video', '3D', 'Text & Utilities'] as const;
export type WorkflowCategory = (typeof WORKFLOW_CATEGORIES)[number];

/** Task presentation only; capability and execution remain backend-owned. */
export function workflowTaskCategory(task: string): WorkflowCategory {
  if (task.includes('video') || task === 'flf2v' || task.startsWith('character_')) return 'Video';
  if (task.includes('audio') || task.includes('speech') || task.includes('music')) return 'Audio';
  if (task.includes('3d')) return '3D';
  if (/image|inpaint|outpaint|controlnet|ip_adapter|depth|layer_decomposition/.test(task)) return 'Image';
  return 'Text & Utilities';
}

const DESCRIPTIONS: Record<string, string> = {
  text_to_image: 'Create an image from an editable text prompt.',
  image_to_image: 'Transform an image using a prompt and strength.',
  edit_image: 'Describe the changes to make to an input image.',
  multi_image_reference_edit: 'Combine or edit multiple reference images.',
  inpaint: 'Replace a masked area of an image.',
  outpaint: 'Expand an image beyond its existing borders.',
  image_upscale: 'Increase image resolution.',
  control_image: 'Guide image generation with a control image.',
  text_to_audio: 'Generate audio from a text description.',
  audio_continuation: 'Continue an existing audio recording.',
  audio_variation: 'Create a variation of an audio recording.',
  audio_repaint: 'Regenerate part of an audio recording.',
};

export function workflowTaskCards(choices: WorkflowChoice[]) {
  const order = ['text_to_image', 'image_to_image', 'edit_image', 'inpaint', 'outpaint', 'image_upscale'];
  return [...new Set(choices.map((c) => c.task))]
    .map((task) => ({
      task,
      label: workflowTaskLabel(task),
      category: workflowTaskCategory(task),
      description: DESCRIPTIONS[task] ?? `Create a connected ${workflowTaskLabel(task).toLowerCase()} workflow.`,
      downloaded: choices.some((c) => c.task === task && c.cache?.runnable),
    }))
    .sort(
      (a, b) =>
        (order.indexOf(a.task) < 0 ? 99 : order.indexOf(a.task)) -
          (order.indexOf(b.task) < 0 ? 99 : order.indexOf(b.task)) || a.label.localeCompare(b.label),
    );
}

/** Prefer available, composable adapters; never allocate or install a model. */
export function defaultWorkflowChoice(choices: WorkflowChoice[], task: string): WorkflowChoice | undefined {
  const rank = (c: WorkflowChoice) =>
    (c.support.dependencies === 'ready' ? 8 : 0) +
    (c.cache?.runnable ? 4 : 0) +
    (c.support.execution === 'adapter' ? 2 : 0) +
    (c.support.decomposition === 'stages' ? 1 : 0);
  return choices
    .filter((c) => c.task === task)
    .sort((a, b) => rank(b) - rank(a) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))[0];
}
