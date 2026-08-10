export const CONTROLLED_WORKFLOW_NODE_KEYS = {
  lora: 'modules.ModularDiffusers.Lora',
  directLora: 'modules.DiffusersImage.LoadAdapter',
  audioLora: 'modules.DiffusersAudio.LoadAdapter',
  upscaler: 'modules.Spandrel.Upscaler',
  preview: 'modules.Image.Preview',
  videoSequence: 'modules.DiffusersVideo.GenerateSequence',
  videoCompose: 'modules.Video.Compose',
  lyricOverlay: 'modules.Video.LyricOverlay',
  exportWithAudio: 'modules.Video.ExportWithAudio',
  soundtrackQuantization: 'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  soundtrackRecipe: 'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  soundtrackPipeline: 'modules.DiffusersAudio.LoadPipeline',
  soundtrackGenerate: 'modules.DiffusersAudio.Generate',
  audioFit: 'modules.Audio.FitDuration',
  videoPipeline: 'modules.DiffusersVideo.LoadPipeline',
  lyricVideoQuantization: 'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  lyricVideoRecipe: 'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  qualityVideoQuantization: 'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  qualityVideoRecipe: 'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  qualityVideoShots: 'modules.WorkflowControl.AuthorShotList',
  qualityVideoJobs: 'modules.DiffusersVideo.BuildShotJobs',
  qualityVideoLoopItems: 'modules.WorkflowControl.LoopItems',
  qualityVideoGenerate: 'modules.DiffusersVideo.GenerateShotJob',
  qualityVideoRetain: 'modules.Video.ExportAsset',
  qualityVideoLoopResult: 'modules.WorkflowControl.LoopResult',
  qualityVideoJoin: 'modules.Video.ConcatenateAssets',
} as const;

export const CONTROLLED_GRAPH_CONTRACT_IDS = [
  'lora.modular.v1',
  'lora.diffusers-image.v1',
  'lora.diffusers-audio.v1',
  'upscale.image.v1',
  'upscale.video.v1',
  'upscale.quality-loop.v1',
  'video-sequence.v1',
  'quality-video.i2v.v1',
  'quality-video.t2v.v1',
  'soundtrack.v1',
  'lyric-video.v1',
] as const;

export type ControlledGraphContractId = (typeof CONTROLLED_GRAPH_CONTRACT_IDS)[number];

export type ControlledNodeRole =
  | 'loraAdapter'
  | `loraAdapter:${number}`
  | 'upscaler'
  | 'upscalePreview'
  | 'videoSequence'
  | 'videoCompose'
  | 'lyricOverlay'
  | 'exportWithAudio'
  | 'soundtrackQuantization'
  | 'soundtrackRecipe'
  | 'soundtrackPipeline'
  | 'soundtrackGenerate'
  | 'soundtrackAudioFit'
  | 'lyricAudioFit'
  | 'lyricVideoPipeline'
  | 'lyricVideoQuantization'
  | 'lyricVideoRecipe'
  | 'qualityVideoQuantization'
  | 'qualityVideoRecipe'
  | 'qualityVideoShots'
  | 'qualityVideoJobs'
  | 'qualityVideoLoop'
  | 'qualityVideoLoopItems'
  | 'qualityVideoGenerate'
  | 'qualityVideoRetain'
  | 'qualityVideoLoopResult'
  | 'qualityVideoJoin';

export const CONTROLLED_ROLE_NODE_KEYS: Partial<Record<ControlledNodeRole, string>> = {
  upscaler: CONTROLLED_WORKFLOW_NODE_KEYS.upscaler,
  upscalePreview: CONTROLLED_WORKFLOW_NODE_KEYS.preview,
  videoSequence: CONTROLLED_WORKFLOW_NODE_KEYS.videoSequence,
  videoCompose: CONTROLLED_WORKFLOW_NODE_KEYS.videoCompose,
  lyricOverlay: CONTROLLED_WORKFLOW_NODE_KEYS.lyricOverlay,
  exportWithAudio: CONTROLLED_WORKFLOW_NODE_KEYS.exportWithAudio,
  soundtrackQuantization: CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackQuantization,
  soundtrackRecipe: CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackRecipe,
  soundtrackPipeline: CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackPipeline,
  soundtrackGenerate: CONTROLLED_WORKFLOW_NODE_KEYS.soundtrackGenerate,
  soundtrackAudioFit: CONTROLLED_WORKFLOW_NODE_KEYS.audioFit,
  lyricAudioFit: CONTROLLED_WORKFLOW_NODE_KEYS.audioFit,
  lyricVideoPipeline: CONTROLLED_WORKFLOW_NODE_KEYS.videoPipeline,
  lyricVideoQuantization: CONTROLLED_WORKFLOW_NODE_KEYS.lyricVideoQuantization,
  lyricVideoRecipe: CONTROLLED_WORKFLOW_NODE_KEYS.lyricVideoRecipe,
  qualityVideoQuantization: CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoQuantization,
  qualityVideoRecipe: CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoRecipe,
  qualityVideoShots: CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoShots,
  qualityVideoJobs: CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoJobs,
  qualityVideoLoopItems: CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoLoopItems,
  qualityVideoGenerate: CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoGenerate,
  qualityVideoRetain: CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoRetain,
  qualityVideoLoopResult: CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoLoopResult,
  qualityVideoJoin: CONTROLLED_WORKFLOW_NODE_KEYS.qualityVideoJoin,
};
