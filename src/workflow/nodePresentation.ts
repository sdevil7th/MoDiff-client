import type { NodeData } from '../stores/useNodeStore';
import type { OperationContract } from './operationContracts';

type Presentation = { label: string; previous: string[]; imageGeneration?: true };

/** Presentation only. Never replace execution identities or infer an operation
 * from a substring in its class name. Unrecognized and user-defined titles stay intact. */
const PRESENTATIONS: Record<string, Presentation> = {
  'modules.Audio.Load': { label: 'Load Audio', previous: ['Load'] },
  'modules.Image.Load': { label: 'Load Image', previous: ['Load'] },
  'modules.ModularDiffusers.ModelsLoader': {
    label: 'Load Modular Components',
    previous: ['Load Models', 'Load model'],
  },
  'modules.ModularDiffusers.AutoModelLoader': { label: 'Load Model Component', previous: ['Load Model'] },
  'modules.DiffusersImage.LoadPipeline': {
    label: 'Load Image Pipeline',
    previous: ['Load Diffusers Image Pipeline', 'Load pipeline'],
  },
  'modules.DiffusersAudio.LoadPipeline': {
    label: 'Load Audio Pipeline',
    previous: ['Load Diffusers Audio Pipeline', 'Load pipeline'],
  },
  'modules.DiffusersVideo.LoadPipeline': {
    label: 'Load Video Pipeline',
    previous: ['Load Diffusers Video Pipeline', 'Load pipeline'],
  },
  'modules.DiffusersThreeD.LoadPipeline': {
    label: 'Load 3D Pipeline',
    previous: ['Load Diffusers 3D Pipeline', 'Load 3D pipeline'],
  },
  'modules.DiffusersVideo.WanVACELoadPipeline': {
    label: 'Load Wan VACE Pipeline',
    previous: ['Load Wan VACE', 'Load pipeline'],
  },
  'modules.DiffusersImage.Generate': {
    label: 'Generate Image',
    previous: ['Diffusers Image Generate', 'Generate image'],
  },
  'modules.DiffusersAudio.Generate': {
    label: 'Generate Audio',
    previous: ['Diffusers Audio Generate', 'Generate audio'],
  },
  'modules.DiffusersImage.LoadAdapter': {
    label: 'Load Image Adapter',
    previous: ['Load Diffusers Image Adapter', 'Load adapter'],
  },
  'modules.DiffusersAudio.LoadAdapter': {
    label: 'Load Audio LoRA',
    previous: ['Load Diffusers Audio LoRA'],
  },
  'modules.DiffusersThreeD.GenerateRenderedArtifact': {
    label: 'Render 3D Orbit',
    previous: ['Diffusers 3D Rendered Generate', 'Render 3D orbit'],
  },
  'modules.Video.LyricOverlay': {
    label: 'Add Timed Lyrics',
    previous: ['Timed Lyric Overlay', 'Add timed lyrics'],
  },
  'modules.DiffusersImage.UnconditionalGenerate': {
    label: 'Generate Unconditional Image',
    previous: ['Diffusers Unconditional Image Generate', 'Sample image'],
    imageGeneration: true,
  },
  'modules.DiffusersImage.ControlGenerate': {
    label: 'Generate Image with Control',
    previous: ['Diffusers Control Generate', 'Generate image'],
    imageGeneration: true,
  },
  'modules.DiffusersImage.Edit': {
    label: 'Edit Image',
    previous: ['Diffusers Image Edit', 'Edit image'],
    imageGeneration: true,
  },
  'modules.DiffusersImage.ControlEdit': {
    label: 'Edit Image with Control',
    previous: ['Diffusers Control Edit', 'Edit image'],
    imageGeneration: true,
  },
  'modules.DiffusersImage.Inpaint': {
    label: 'Inpaint Image',
    previous: ['Diffusers Image Inpaint', 'Inpaint'],
    imageGeneration: true,
  },
  'modules.DiffusersImage.ControlInpaint': {
    label: 'Inpaint Image with Control',
    previous: ['Diffusers Control Inpaint', 'Edit image'],
    imageGeneration: true,
  },
  'modules.DiffusersImage.LayerDecompose': {
    label: 'Decompose Image Layers',
    previous: ['Diffusers Layer Decompose'],
  },
  'modules.DiffusersImage.PredictMap': { label: 'Predict Image Map', previous: ['Diffusers Predict Map'] },
  'modules.DiffusersImage.OutpaintCanvas': {
    label: 'Prepare Outpaint Canvas',
    previous: ['Outpaint Canvas', 'Edit image'],
  },
  'modules.Audio.Preview': { label: 'Preview Audio', previous: ['Preview'] },
  'modules.Image.Preview': { label: 'Preview Image', previous: ['Preview'] },
  'modules.ModularDiffusers.LatentsPreview': { label: 'Preview Latents', previous: ['Latents Preview', 'Preview'] },
  'modules.Audio.Export': { label: 'Export Audio', previous: ['Export'] },
  'modules.Image.Save': { label: 'Save Image', previous: ['Export'] },
  'modules.Primitive.ExportData': { label: 'Export Data', previous: ['Export'] },
  'modules.Video.Export': { label: 'Export Video', previous: ['Export'] },
  'modules.Video.ExportAsset': { label: 'Export Video Asset', previous: ['Export Retained Video Asset', 'Export'] },
  'modules.Spandrel.Upscaler': { label: 'Upscale Image or Video', previous: ['Upscale with model'] },
  'modules.DiffusersVideo.Generate': {
    label: 'Generate Video',
    previous: ['Diffusers Video Generate', 'Generate video'],
  },
  'modules.DiffusersVideo.GenerateShotJob': {
    label: 'Generate Video Shot',
    previous: ['Generate Video Shot Job', 'Generate video'],
  },
  'modules.DiffusersVideo.WanVACEGenerate': {
    label: 'Generate Video with Wan VACE',
    previous: ['Wan VACE Generate', 'Generate video'],
  },
  'modules.DiffusersVideo.GenerateSequence': {
    label: 'Generate Video Sequence',
    previous: ['Diffusers Video Generate Sequence', 'Generate video sequence'],
  },
  'modules.DiffusersVideo.GenerateVideoAudio': {
    label: 'Generate Video and Audio',
    previous: ['Diffusers Video + Audio Generate', 'Generate video + audio'],
  },
};

const FIELD_PRESENTATIONS: Record<string, Record<string, readonly [string, string]>> = {
  'modules.VideoConditioning.Normalize': {
    video: ['Video', 'Source frames'],
    num_frames: ['Frames', 'Target frames'],
    output: ['Video', 'Normalized video'],
    frames_out: ['Frames', 'Actual frame count'],
  },
  'modules.ModularDiffusers.Scheduler': {
    scheduler_in: ['Scheduler', 'Base scheduler'],
    scheduler: ['Scheduler', 'Scheduler type'],
    scheduler_out: ['Scheduler', 'Configured scheduler'],
  },
  'modules.Video.MuxAudioAsset': {
    fit: ['Duration', 'Audio fit'],
    duration_seconds: ['Duration', 'Measured duration (s)'],
  },
  'modules.DiffusersAudio.Generate': {
    sample_rate: ['Sample Rate', 'Requested sample rate'],
    sample_rate_out: ['Sample Rate', 'Actual sample rate'],
  },
  'modules.Audio.FitDuration': {
    target_sample_rate: ['Target SR', 'Target sample rate'],
  },
};

/** Improve built-in captions at render time while keeping authored aliases and field IDs. */
export function nodeFieldDisplayLabel(identity: string, field: string, label: string): string {
  const presentation = FIELD_PRESENTATIONS[identity]?.[field];
  return presentation?.[0] === label ? presentation[1] : label;
}

/** Built-in composite metadata carries an exact runtime key, not a user title. */
export function builtinNodeDisplayLabel(identity: string, fallback: string) {
  return PRESENTATIONS[identity]?.label ?? fallback;
}

/** Give distinct built-in image tasks their own caption when the backend
 * binds them to the shared generation operation. */
export function imageActionCaption(operation: Pick<OperationContract, 'nodeKey' | 'operationId' | 'task'>) {
  if (operation.operationId !== 'diffusion.generate_image') return undefined;
  const presentation = PRESENTATIONS[operation.nodeKey];
  if (!presentation?.imageGeneration) return undefined;
  if (operation.nodeKey === 'modules.DiffusersImage.Inpaint' && operation.task === 'outpaint') return 'Outpaint Image';
  return presentation.label;
}

export function nodeDisplayLabel(node: Pick<NodeData, 'module' | 'action' | 'label' | 'operationAuthoring'>): string {
  const identity = `${node.module}.${node.action}`;
  const operation = node.operationAuthoring?.operation;
  if (node.operationAuthoring && node.label) {
    // The starter derives this default from the shared operation ID. Refine
    // that caption without rewriting it or overriding a distinct saved title.
    if (node.label === 'Generate Image' && operation?.nodeKey === identity)
      return imageActionCaption(operation) ?? node.label;
    return node.label;
  }
  const presentation = PRESENTATIONS[identity];
  if (presentation && (!node.label || node.label === identity || presentation.previous.includes(node.label)))
    return presentation.label;
  return node.label || `${node.module}.${node.action}`;
}

export function nodeSearchAliases(node: Pick<NodeData, 'module' | 'action'>): string[] {
  return PRESENTATIONS[`${node.module}.${node.action}`]?.previous ?? [];
}
