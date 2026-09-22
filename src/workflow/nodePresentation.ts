import type { NodeData } from '../stores/useNodeStore';

type Presentation = { label: string; previous: string[] };

/** Presentation only. Never replace execution identities or infer an operation
 * from a substring in its class name. Unrecognized and user-defined titles stay intact. */
const PRESENTATIONS: Record<string, Presentation> = {
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
  },
  'modules.DiffusersImage.ControlGenerate': {
    label: 'Generate Image with Control',
    previous: ['Diffusers Control Generate', 'Generate image'],
  },
  'modules.DiffusersImage.Edit': { label: 'Edit Image', previous: ['Diffusers Image Edit', 'Edit image'] },
  'modules.DiffusersImage.ControlEdit': {
    label: 'Edit Image with Control',
    previous: ['Diffusers Control Edit', 'Edit image'],
  },
  'modules.DiffusersImage.Inpaint': { label: 'Inpaint Image', previous: ['Diffusers Image Inpaint', 'Inpaint'] },
  'modules.DiffusersImage.ControlInpaint': {
    label: 'Inpaint Image with Control',
    previous: ['Diffusers Control Inpaint', 'Edit image'],
  },
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

export function nodeDisplayLabel(node: Pick<NodeData, 'module' | 'action' | 'label' | 'operationAuthoring'>): string {
  // Canonical authoring nodes already have a task-specific semantic label. Raw
  // implementation names must not replace that label on a bound workflow.
  if (node.operationAuthoring && node.label) return node.label;
  const identity = `${node.module}.${node.action}`;
  const presentation = PRESENTATIONS[identity];
  if (presentation && (!node.label || node.label === identity || presentation.previous.includes(node.label)))
    return presentation.label;
  return node.label || `${node.module}.${node.action}`;
}

export function nodeSearchAliases(node: Pick<NodeData, 'module' | 'action'>): string[] {
  return PRESENTATIONS[`${node.module}.${node.action}`]?.previous ?? [];
}
