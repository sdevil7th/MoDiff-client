import type { CustomNodeType } from '../stores/useFlowStore';
import type { OperationGraph } from '../workflow/operationAuthoring';
import { CONTROLLED_WORKFLOW_NODE_KEYS as KEYS } from './controlledWorkflowContracts';
import type { StudioFormState, StudioTemplateWorkflowBlockSettings } from './types';

/** Author ordinary image nodes inside the existing fresh-template transaction. */
export function attachTemplateImageComposite({
  graph,
  form,
  settings,
  preview,
  utility,
  set,
  connect,
}: {
  graph: OperationGraph;
  form: StudioFormState;
  settings: StudioTemplateWorkflowBlockSettings['maskedComposite'];
  preview: CustomNodeType | undefined;
  utility: (key: string, index: number) => CustomNodeType;
  set: (node: CustomNodeType, names: string[], value: unknown) => void;
  connect: (from: CustomNodeType, outputs: string[], to: CustomNodeType, inputs: string[]) => void;
}) {
  const input = graph.edges.find((edge) => edge.target === preview?.id && edge.targetHandle === 'image');
  const source = input && graph.nodes.find((node) => node.id === input.source);
  if (!settings || !preview || !input || !source)
    throw new Error('The masked composite template needs one declared decoded image output.');
  const index = settings.backgroundReferenceIndex;
  if (!Number.isSafeInteger(index) || index < 0 || index >= form.referenceImages.length)
    throw new Error('The masked composite background must select an existing ordered reference.');
  const backgroundPath = form.referenceImages[index];
  if (typeof backgroundPath !== 'string' || !backgroundPath.trim() || !form.maskImage.trim())
    throw new Error('Choose the background reference and protection mask before creating this workflow.');
  if (form.batchSize !== 1) throw new Error('The masked composite template needs one image per prompt.');
  for (const size of [settings.foregroundSize, settings.verticalPad, settings.horizontalPad, settings.crop]) {
    if (!size || ![size.width, size.height].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 8192))
      throw new Error('The masked composite dimensions must be whole numbers between 1 and 8192.');
  }
  if (![settings.crop.x, settings.crop.y].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 8191))
    throw new Error('The masked composite crop origin is invalid.');
  if (typeof settings.invertMask !== 'boolean') throw new Error('The masked composite mask inversion is invalid.');

  const background = utility(KEYS.imageLoad, 0);
  const mask = utility(KEYS.imageLoad, 1);
  set(background, ['file'], [backgroundPath]);
  set(mask, ['file'], [form.maskImage]);
  for (const node of [background, mask]) set(node, ['alpha_channel'], 'ignore');
  background.data.label = 'Protected background';
  mask.data.label = 'Protection mask';
  let foreground = source;
  let sourceHandle = input.sourceHandle!;
  for (const [position, size] of [settings.foregroundSize, settings.verticalPad, settings.horizontalPad].entries()) {
    const resize = utility(KEYS.imageResize, position + 2);
    set(resize, ['width'], size.width);
    set(resize, ['height'], size.height);
    set(resize, ['method'], position === 0 ? 'stretch' : 'pad');
    set(resize, ['multiple_of'], 1);
    set(resize, ['interpolation'], 'lanczos');
    connect(foreground, [sourceHandle], resize, ['image']);
    foreground = resize;
    sourceHandle = 'output';
  }
  const crop = utility(KEYS.imageCrop, 5);
  for (const field of ['x', 'y', 'width', 'height'] as const) set(crop, [field], settings.crop[field]);
  connect(foreground, [sourceHandle], crop, ['image']);
  const composite = utility(KEYS.imageMaskComposite, 6);
  set(composite, ['mask_channel'], settings.maskChannel);
  set(composite, ['invert_mask'], settings.invertMask);
  connect(background, ['image'], composite, ['background']);
  connect(crop, ['output'], composite, ['foreground']);
  connect(mask, ['image'], composite, ['mask']);
  const save = utility(KEYS.imageSave, 7);
  if (save.data.params.saved_images?.fieldOptions?.format !== 'PNG')
    throw new Error('Refresh the paired backend to use the lossless Save Image Gallery preview.');
  set(save, ['filename'], 'studio/outputs/composite_{HASH:12}.png');
  set(save, ['quality'], 100);
  set(save, ['metadata'], '');
  save.data.label = 'Protected image (PNG)';
  save.data.studioRole = 'compositeOutput';
  connect(composite, ['output'], save, ['image']);
}
