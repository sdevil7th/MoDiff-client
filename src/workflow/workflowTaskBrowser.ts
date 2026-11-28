import { workflowTaskLabel, type WorkflowChoice } from './workflowChoices';

export const WORKFLOW_CATEGORIES = ['Image', 'Audio', 'Video', '3D', 'Text & Utilities'] as const;
export type WorkflowCategory = (typeof WORKFLOW_CATEGORIES)[number];

/** Task presentation only; capability and execution remain backend-owned. */
export function workflowTaskCategory(task: string): WorkflowCategory {
  if (task.includes('video') || task === 'flf2v' || task.startsWith('character_')) return 'Video';
  if (task.endsWith('_to_text')) return 'Text & Utilities';
  if (task.includes('audio') || task.includes('speech') || task.includes('music')) return 'Audio';
  if (task.includes('3d')) return '3D';
  if (task === 'mask_composite' || /image|inpaint|outpaint|controlnet|ip_adapter|depth|layer_decomposition/.test(task))
    return 'Image';
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
  flf2v: 'Choose the opening and closing images to guide the motion between them.',
  first_last_frame_to_video_with_audio: 'Connect two supplied images with a moving shot and a synchronized soundtrack.',
  in_context_to_video: 'Use a reference clip to guide the shape and motion of a new shot.',
  text_to_video: 'Describe a scene, its movement and the camera.',
  image_to_video: 'Animate a supplied opening image.',
  video_to_video: 'Change the look or motion of a source clip.',
  text_to_audio: 'Generate audio from a text description.',
  audio_continuation: 'Continue an existing audio recording.',
  audio_variation: 'Create a variation of an audio recording.',
  audio_repaint: 'Regenerate part of an audio recording.',
  action_forward_dynamics: 'Predict the next observation from a supplied action.',
  action_inverse_dynamics: 'Infer the action between two observations.',
  action_policy: 'Predict an action from the supplied observation.',
  character_animate: 'Transfer motion to a character reference.',
  character_replace: 'Replace a character while following the source motion.',
  image_to_text: 'Describe the contents of an image.',
  image_to_3d: 'Create a 3D result from a reference image.',
  text_to_3d: 'Create a 3D result from a prompt.',
  depth_estimation: 'Estimate scene depth from an image.',
  layer_decomposition: 'Separate parts of an image into layers.',
  mask_composite: 'Combine images using a mask.',
  video_inpaint: 'Replace a masked area across video frames.',
  video_outpaint: 'Extend the canvas around a source clip.',
  reference_to_video: 'Guide a new video using a reference.',
  text_to_video_with_audio: 'Create a video and soundtrack from a prompt.',
  image_to_video_with_audio: 'Animate an image with a synchronized soundtrack.',
  video_to_video_with_audio: 'Transform a supplied clip with sound.',
  condition_to_video_with_audio: 'Guide a video and soundtrack with supplied conditioning.',
};

const PRIMARY_IMAGE_TASKS = ['text_to_image', 'image_to_image', 'edit_image', 'inpaint', 'outpaint', 'image_upscale'];

export function matchesWorkflowTask(card: ReturnType<typeof workflowTaskCards>[number], query: string) {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const haystack = normalize([card.label, card.task, card.category, card.description].join(' '));
  return query
    .trim()
    .split(/\s+/)
    .every((word) => haystack.includes(normalize(word)));
}

function taskDescription(task: string) {
  if (DESCRIPTIONS[task]) return DESCRIPTIONS[task];
  if (/control|ip_adapter/.test(task)) {
    const inputs =
      task.includes('ip_adapter') && task.includes('controlnet')
        ? 'reference and control images'
        : task.includes('ip_adapter')
          ? 'a reference image'
          : 'a control image';
    return task.includes('inpaint')
      ? `Replace a masked area using ${inputs} for guidance.`
      : task.includes('edit') || task.includes('image2image')
        ? `Edit a source image using ${inputs} for guidance.`
        : `Guide generation using ${inputs}.`;
  }
  return '';
}

export function workflowTaskCards(choices: WorkflowChoice[]) {
  const order = PRIMARY_IMAGE_TASKS;
  return [...new Set(choices.map((c) => c.task))]
    .map((task) => ({
      task,
      label: workflowTaskLabel(task),
      category: workflowTaskCategory(task),
      description: taskDescription(task),
      specialist: workflowTaskCategory(task) === 'Image' && !PRIMARY_IMAGE_TASKS.includes(task),
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
