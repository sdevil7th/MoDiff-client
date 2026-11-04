import type { CustomNodeType } from '../stores/useFlowStore';
import { buildLyricVideoWorkflow } from './controlledWorkflowValues';
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
  if (!settings.visualModel.revision || !/^[a-f0-9]{40}$/.test(settings.visualModel.revision))
    throw new Error('The lyric visual branch needs an immutable model revision.');
  let index = 0;
  buildLyricVideoWorkflow(
    settings,
    form,
    audioGenerate,
    (key) => utility(key, index++),
    (node, fields, value, role) => {
      // Registry selectors transport source/value with a separate immutable pin.
      if (role === 'pipeline' && fields[0] === 'model_id') {
        set(node, fields, { source: settings.visualModel.source, value: settings.visualModel.value });
        set(node, ['revision'], settings.visualModel.revision);
        return;
      }
      const param = fields.map((name) => node.data.params[name]).find(Boolean);
      // Ordinary factory fields retain their native random-control shape.
      set(
        node,
        fields,
        param?.display === 'random' && typeof value === 'number'
          ? { value, isRandom: role === 'sequence' && form.randomSeed }
          : value,
      );
    },
    connect,
  );
}
