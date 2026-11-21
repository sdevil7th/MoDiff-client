import type { NodeData } from '../stores/useNodeStore';

const GENERATION_CONTRACTS = new Map([
  [
    'modules.DiffusersImage',
    {
      inputType: 'image_diffusion_pipeline',
      actions: new Set([
        'Generate',
        'Edit',
        'Inpaint',
        'ControlGenerate',
        'ControlEdit',
        'ControlInpaint',
        'UnconditionalGenerate',
        'PredictMap',
        'LayerDecompose',
      ]),
    },
  ],
  ['modules.DiffusersAudio', { inputType: 'audio_diffusion_pipeline', actions: new Set(['Generate']) }],
  [
    'modules.DiffusersVideo',
    { inputType: 'video_diffusion_pipeline', actions: new Set(['Generate', 'GenerateVideoAudio']) },
  ],
]);

export function isWholePipelineStage({ module, action, params }: Pick<NodeData, 'module' | 'action' | 'params'>) {
  const contract = GENERATION_CONTRACTS.get(module);
  return Boolean(
    contract?.actions.has(action) &&
    params.pipeline?.type === contract.inputType &&
    (params.pipeline.display === 'input' || params.pipeline.isInput === true),
  );
}
