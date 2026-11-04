import type { CustomNodeType } from '../stores/useFlowStore';
import { CONTROLLED_WORKFLOW_NODE_KEYS as KEYS } from './controlledWorkflowContracts';
import { lyricVideoWorkflowFieldValues } from './controlledWorkflowValues';
import type { StudioFormState, StudioTemplateWorkflowBlockSettings } from './types';

/** Append the actual visible lyric/media stages to an ordinary audio starter. */
export function attachTemplateLyricVideo({
  form,
  settings,
  audioGenerate,
  utility,
  set,
  connect,
}: {
  form: StudioFormState;
  settings: StudioTemplateWorkflowBlockSettings['lyricVideo'];
  audioGenerate: CustomNodeType | undefined;
  utility: (key: string, index: number) => CustomNodeType;
  set: (node: CustomNodeType, fields: string[], value: unknown) => void;
  connect: (from: CustomNodeType, outputs: string[], to: CustomNodeType, inputs: string[]) => void;
}) {
  if (!settings || !audioGenerate || audioGenerate.data.params.audio?.type !== 'audio')
    throw new Error('The lyric composite needs one declared audio generator and its complete branch settings.');
  const nodes = {
    quantization: utility(KEYS.lyricVideoQuantization, 0),
    recipe: utility(KEYS.lyricVideoRecipe, 1),
    pipeline: utility(KEYS.videoPipeline, 2),
    sequence: utility(KEYS.videoSequence, 3),
    compose: utility(KEYS.videoCompose, 4),
    upscaler: utility(KEYS.upscaler, 5),
    overlay: utility(KEYS.lyricOverlay, 6),
    audioGenerate,
    audioFit: utility(KEYS.audioFit, 7),
    exporter: utility(KEYS.exportWithAudio, 8),
  };
  const values = lyricVideoWorkflowFieldValues(settings, form);
  // Registry selectors transport source/value. Immutable revision is a separate
  // declared loader field; never drop it with the legacy selector decoration.
  values.pipeline = values.pipeline.map((item) =>
    item.fields[0] === 'model_id'
      ? { fields: item.fields, value: { source: settings.visualModel.source, value: settings.visualModel.value } }
      : item,
  );
  if (!settings.visualModel.revision || !/^[a-f0-9]{40}$/.test(settings.visualModel.revision))
    throw new Error('The lyric visual branch needs an immutable model revision.');
  values.pipeline.push({ fields: ['revision'], value: settings.visualModel.revision });
  for (const role of Object.keys(nodes) as (keyof typeof nodes)[])
    for (const { fields, value } of values[role]) {
      const param = fields.map((name) => nodes[role].data.params[name]).find(Boolean);
      // Ordinary factory fields retain their native random-control shape.
      set(
        nodes[role],
        fields,
        param?.display === 'random' && typeof value === 'number'
          ? { value, isRandom: role === 'sequence' && form.randomSeed }
          : value,
      );
    }
  connect(nodes.quantization, ['quantization_config'], nodes.recipe, ['quantization_config']);
  connect(nodes.recipe, ['execution_recipe'], nodes.pipeline, ['execution_recipe']);
  connect(nodes.pipeline, ['pipeline'], nodes.sequence, ['pipeline']);
  connect(nodes.sequence, ['clips'], nodes.compose, ['clip_1']);
  connect(nodes.compose, ['video'], nodes.upscaler, ['image']);
  connect(nodes.upscaler, ['output'], nodes.overlay, ['video']);
  connect(nodes.overlay, ['output'], nodes.exporter, ['video']);
  connect(nodes.audioGenerate, ['audio'], nodes.audioFit, ['audio']);
  connect(nodes.audioFit, ['output'], nodes.exporter, ['audio']);
}
