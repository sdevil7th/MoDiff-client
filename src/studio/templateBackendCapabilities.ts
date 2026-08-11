import {
  QWEN_INPAINT_GENERATE_NODE_KEY,
  QWEN_INPAINT_PIPELINE_NODE_KEY,
  QWEN_OUTPAINT_CANVAS_NODE_KEY,
  QWEN_T2I_GENERATE_NODE_KEY,
  QWEN_T2I_PIPELINE_NODE_KEY,
} from './modelProfiles';
import type { StudioTemplate } from './types';

const QWEN_MODULAR_EDIT_NODE_KEYS = [
  'modules.ModularDiffusers.ModelsLoader',
  'modules.ModularDiffusers.EncodePrompt',
  'modules.ModularDiffusers.ImageEncode',
  'modules.ModularDiffusers.Denoise',
  'modules.ModularDiffusers.DecodeLatents',
  'modules.Image.Load',
  'modules.Image.Preview',
];

const CAPABILITY_NODE_KEYS: Record<string, readonly string[]> = {
  'Qwen direct Auto Diffusers path': [QWEN_T2I_PIPELINE_NODE_KEY, QWEN_T2I_GENERATE_NODE_KEY],
  'Qwen ControlNet Union graph contract': [
    'modules.ModularDiffusers.AutoModelLoader',
    'modules.ModularDiffusers.Controlnet',
  ],
  'Qwen multi-image reference edit': QWEN_MODULAR_EDIT_NODE_KEYS,
  'Qwen single-image reference edit': QWEN_MODULAR_EDIT_NODE_KEYS,
  'Modular Diffusers Qwen Image Edit Plus': QWEN_MODULAR_EDIT_NODE_KEYS,
  'LoRA loader node with pinned adapter hash': [
    'modules.ModularDiffusers.ModelsLoader',
    'modules.ModularDiffusers.Lora',
  ],
  'Modular Diffusers LoRA scheduler metadata': [
    'modules.ModularDiffusers.ModelsLoader',
    'modules.ModularDiffusers.Lora',
  ],
  'pinned LoRA adapter verification': ['modules.DiffusersImage.LoadAdapter'],
  'Spandrel or equivalent upscaler graph block': ['modules.Spandrel.Upscaler', 'modules.Image.Preview'],
  'layer output metadata and per-layer media hashes': [
    'modules.ModularDiffusers.DecodeLatents',
    'modules.Image.Preview',
  ],
  'visual collection loops': ['modules.WorkflowControl.LoopItems', 'modules.WorkflowControl.LoopResult'],
  'native inpaint mask graph contract': [
    QWEN_INPAINT_PIPELINE_NODE_KEY,
    QWEN_INPAINT_GENERATE_NODE_KEY,
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'outpaint canvas, mask, and placement controls': [
    QWEN_INPAINT_PIPELINE_NODE_KEY,
    QWEN_OUTPAINT_CANVAS_NODE_KEY,
    QWEN_INPAINT_GENERATE_NODE_KEY,
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'outpaint canvas, mask, and boundary-fill graph contract': [
    QWEN_INPAINT_PIPELINE_NODE_KEY,
    QWEN_OUTPAINT_CANVAS_NODE_KEY,
    QWEN_INPAINT_GENERATE_NODE_KEY,
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'modules.VideoConditioning.ReferenceImages': ['modules.Image.Load', 'modules.DiffusersVideo.Generate'],
  'Diffusers audio direct pipeline': [
    'modules.DiffusersAudio.LoadPipeline',
    'modules.DiffusersAudio.Generate',
    'modules.Audio.Export',
  ],
  'Diffusers image direct pipeline': [
    'modules.DiffusersImage.LoadPipeline',
    'modules.DiffusersImage.Generate',
    'modules.Image.Preview',
  ],
  'Diffusers image edit pipeline': [
    'modules.DiffusersImage.LoadPipeline',
    'modules.DiffusersImage.Edit',
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'Diffusers image inpaint pipeline': [
    'modules.DiffusersImage.LoadPipeline',
    'modules.DiffusersImage.Inpaint',
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'Diffusers image control pipeline': [
    'modules.DiffusersImage.LoadPipeline',
    'modules.DiffusersImage.ControlGenerate',
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'Diffusers video direct pipeline': [
    'modules.DiffusersVideo.LoadPipeline',
    'modules.DiffusersVideo.Generate',
    'modules.Video.Export',
  ],
  'Diffusers artifact quantization node': ['modules.ModelArtifact.QuantizeDiffusersComponents'],
};

export function isTemplateBackendCapabilityRecognized(capability: string) {
  return capability.startsWith('modules.') || CAPABILITY_NODE_KEYS[capability] !== undefined;
}

export function backendNodeKeysForCapability(capability: string): readonly string[] | null {
  const mappedNodeKeys = CAPABILITY_NODE_KEYS[capability];
  if (mappedNodeKeys) return mappedNodeKeys;
  return capability.startsWith('modules.') ? [capability] : null;
}

export function templateBackendNodeKeys(template: Pick<StudioTemplate, 'requiredBackendCapabilities'>): string[] {
  return [
    ...new Set(
      (template.requiredBackendCapabilities ?? []).flatMap(
        (capability) => backendNodeKeysForCapability(capability) ?? [],
      ),
    ),
  ].sort();
}
