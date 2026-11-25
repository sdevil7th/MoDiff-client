import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJsonHash } from './canonical-json.mjs';
import { verifyNativeLoadedImage } from './native-image-load-evidence.mjs';
import {
  backendContractIdentity,
  backendSourceEvidence,
  canonicalGraphIdentity,
  normalizeBackendRuntime,
  directImagePromptAccountingExecutionPlan,
  directImagePromptRoutes,
  selectBackendRuntimeFingerprintEvidence,
  selectInstalledModelIdentity,
  stableStringify,
} from './live-proof-provenance.mjs';
import {
  bindRetainedCpuFloat32Recipe,
  validateLateNativeImageVariantRun,
  validateNativeVariantOutput,
  validateNativeVariantRun,
  validateUnmodifiedExpertPreparation,
} from './native-variant-run-evidence.mjs';
import {
  canonicalWorkflowAuthoringContract,
  exportCanonicalWorkflowGraphs,
  readCanonicalEvidenceFile,
} from './release-contract-core.mjs';

// These are the reviewed authored prompt exercises, with no external inputs
// or changes to the rest of either published recipe. The native observations
// are narrower than full call accounting and do not qualify public assets.
const textRoute = {
  format: 'modiff.private.smollm2-prompt-variant.v1',
  workflowId: 'HuggingFaceTextGenerationModel:text_generation',
  outputKind: 'json',
  displayType: 'text',
  contentType: 'text/plain',
  platform: /^Windows-/u,
  backend: 'cuda',
  modelRepo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
  modelRevision: '12fd25f77366fa6b3b4b768ec3050bf629380bac',
  loaderContract: [],
  chain: [
    [
      'loader',
      'modules.HuggingFaceTransformers',
      'LoadTextGenerationModel',
      'device dtype model_id pipeline_class revision',
    ],
    ['generator', 'modules.HuggingFaceTransformers', 'GenerateText', 'prompt'],
    ['preview', 'modules.Primitive', 'DataViewer', ''],
  ],
};

const janusTextRoute = {
  ...textRoute,
  format: 'modiff.private.janus-text-prompt-variant.v1',
  workflowId: 'HuggingFaceAnyToAnyModel:text_generation',
  modelRepo: 'deepseek-community/Janus-Pro-1B',
  modelRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
  chain: [
    ['loader', 'modules.HuggingFaceTransformers', 'LoadAnyToAnyModel', 'device dtype model_id pipeline_class revision'],
    ['generator', 'modules.HuggingFaceTransformers', 'GenerateAnyToAny', 'prompt'],
    ['preview', 'modules.Primitive', 'DataViewer', ''],
  ],
};

const janusImageRoute = {
  ...janusTextRoute,
  format: 'modiff.private.janus-image-prompt-variant.v1',
  workflowId: 'HuggingFaceAnyToAnyModel:text_to_image',
  outputKind: 'image',
  displayType: 'image',
  contentType: 'image/webp',
  chain: [...janusTextRoute.chain.slice(0, 2), ['preview', 'modules.Image', 'Preview', 'device']],
};

const janusCaptionRoute = {
  ...janusTextRoute,
  format: 'modiff.private.janus-caption-variant.v1',
  workflowId: 'HuggingFaceAnyToAnyModel:image_to_text',
  bindsImage: true,
  baselinePrompt: 'Describe the image.',
  chain: [['source', 'modules.Image', 'Load', ''], ...janusTextRoute.chain],
};

const smolVlmCaptionRoute = {
  ...textRoute,
  format: 'modiff.private.smolvlm-caption-variant.v1',
  workflowId: 'HuggingFaceImageTextToTextModel:image_to_text',
  modelRepo: 'HuggingFaceTB/SmolVLM-256M-Instruct',
  modelRevision: '7e3e67edbbed1bf9888184d9df282b700a323964',
  bindsImage: true,
  baselinePrompt: 'Describe the image.',
  executedTask: 'image_to_text',
  chain: [
    ['source', 'modules.Image', 'Load', ''],
    [
      'loader',
      'modules.HuggingFaceTransformers',
      'LoadImageTextToTextModel',
      'device dtype model_id pipeline_class revision',
    ],
    ['generator', 'modules.HuggingFaceTransformers', 'GenerateImageVideoText', 'prompt'],
    ['preview', 'modules.Primitive', 'DataViewer', ''],
  ],
};

const videoRoute = {
  format: 'modiff.private.shap-e-prompt-variant.v1',
  workflowId: 'ShapEPipeline:text_to_3d',
  outputKind: 'video',
  displayType: 'video',
  contentType: 'video/mp4',
  platform: /^Linux-/u,
  backend: 'rocm',
  modelRepo: 'openai/shap-e',
  modelRevision: '7bd337afdea1c17842e1c3cc45c4e268356dba40',
  loaderContract: ['modules.DiffusersThreeD.LoadPipeline'],
  chain: [
    ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2', 'dtype'],
    [
      'recipe',
      'modules.DiffusersRuntime',
      'DiffusersExecutionRecipe',
      'attention_backend device offload_mode vae_slicing vae_tiling',
    ],
    [
      'loader',
      'modules.DiffusersThreeD',
      'LoadPipeline',
      'auto_offload device dtype model_id offload_mode pipeline_class revision',
    ],
    [
      'generator',
      'modules.DiffusersThreeD',
      'GenerateRenderedArtifact',
      'guidance_scale num_inference_steps prompt seed',
    ],
    ['preview', 'modules.Video', 'Export', 'fps'],
  ],
};

const audioRoute = {
  format: 'modiff.private.longcat-audio-prompt-variant.v1',
  workflowId: 'LongCatAudioDiTPipeline:text_to_audio',
  outputKind: 'audio',
  displayType: 'audio',
  contentType: 'audio/wav',
  platform: /^Windows-/u,
  backend: 'cuda',
  modelRepo: 'ruixiangma/LongCat-AudioDiT-1B-Diffusers',
  modelRevision: 'f4c063ea37f262ba5e6129ebd80095a6d6a9de4d',
  loaderContract: ['modules.DiffusersAudio.LoadPipeline'],
  bindSeed: true,
  chain: [
    ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2', 'dtype'],
    [
      'recipe',
      'modules.DiffusersRuntime',
      'DiffusersExecutionRecipe',
      'attention_backend device offload_mode vae_slicing vae_tiling',
    ],
    [
      'loader',
      'modules.DiffusersAudio',
      'LoadPipeline',
      'auto_offload device dtype enable_vae_tiling model_id offload_mode pipeline_class revision',
    ],
    ['generator', 'modules.DiffusersAudio', 'Generate', 'prompt seed audio_duration sample_rate'],
    ['preview', 'modules.Audio', 'Export', 'sample_rate'],
  ],
};

const audioLdmRoute = {
  ...audioRoute,
  format: 'modiff.private.audioldm2-prompt-variant.v1',
  workflowId: 'AudioLDM2Pipeline:text_to_audio',
  modelType: 'AudioLDM2Pipeline',
  previousExpertFamily: 'StableDiffusionXLControlNetInpaintPipeline',
  modelRepo: 'cvssp/audioldm2',
  modelRevision: 'c8e7e189d324425c05c4c2f81214041ef4107983',
  chain: audioRoute.chain.map((stage) =>
    stage[0] === 'generator'
      ? ['generator', 'modules.DiffusersAudio', 'Generate', 'prompt seed audio_duration sample_rate']
      : stage,
  ),
};

const wanA14BRoute = {
  format: 'modiff.private.wan-a14b-video-prompt-variant.v1',
  workflowId: 'Wan22Pipeline:text_to_video',
  modelType: 'Wan22Pipeline',
  outputKind: 'video',
  displayType: 'video',
  contentType: 'video/mp4',
  platform: /^Linux-/u,
  backend: 'rocm',
  previousExpertFamily: 'WanAnimatePipeline',
  modelRepo: 'Wan-AI/Wan2.2-T2V-A14B-Diffusers',
  modelRevision: '5be7df9619b54f4e2667b2755bc6a756675b5cd7',
  loaderContract: ['modules.DiffusersVideo.LoadPipeline'],
  bindSeed: true,
  executedTask: 'text_to_video',
  chain: [
    ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2', 'dtype'],
    [
      'recipe',
      'modules.DiffusersRuntime',
      'DiffusersExecutionRecipe',
      'attention_backend device offload_mode vae_slicing vae_tiling',
    ],
    [
      'loader',
      'modules.DiffusersVideo',
      'LoadPipeline',
      'auto_offload device dtype model_id offload_mode pipeline_class revision',
    ],
    [
      'generator',
      'modules.DiffusersVideo',
      'Generate',
      'conditioning_scale frame_rate guidance_scale height max_sequence_length negative_prompt num_frames num_inference_steps output_type prompt secondary_guidance_scale seed strength true_cfg_scale width',
    ],
    ['preview', 'modules.Video', 'Export', 'fps'],
  ],
};

const wanA14BOpeningRoute = {
  ...wanA14BRoute,
  format: 'modiff.private.wan-a14b-opening-image-variant.v1',
  workflowId: 'WanImageToVideoPipeline:image_to_video',
  modelType: 'WanImageToVideoPipeline',
  previousExpertFamily: 'QwenImageLayeredPipeline',
  modelRepo: 'Wan-AI/Wan2.2-I2V-A14B-Diffusers',
  modelRevision: '596658fd9ca6b7b71d5057529bbf319ecbc61d74',
  sourceFingerprint: 'sha256:backend-source-v1:ce7ac712b4620d0e8efb35022a558a551e2d4ae6ef20b844744c4d674527b0b3',
  executedTask: 'image_to_video',
  bindsImage: true,
  imageInputPort: 'reference_images',
  bindSeed: false,
  bindNegativePrompt: true,
  baselinePromptHash: '9d8fe468ce8939dd73a197fa8ee97d01363a709cf34df18397fe589a4064d6b7',
  baselineNegativePromptHash: '7a8923279a40a635424ada051ad177b63dab90cf78a7d60f9b9b9d5bf1cd2134',
  chain: [['source', 'modules.Image', 'Load', ''], ...wanA14BRoute.chain],
};

const wanAnimateFiles = [
  ['face', 'face_video', 256, 256],
  ['pose', 'pose_video', 768, 512],
];
const wanAnimateRoute = {
  ...wanA14BRoute,
  format: 'modiff.private.wan-character-animate-inputs.v1',
  workflowId: 'WanAnimatePipeline:character_animate',
  modelType: 'WanAnimatePipeline',
  previousExpertFamily: 'LattePipeline',
  modelRepo: 'Wan-AI/Wan2.2-Animate-14B-Diffusers',
  modelRevision: '6f4df10861c758af86ac3c979aacc1bf5c03eff0',
  sourceFingerprint: 'sha256:backend-source-v1:b29a5b0d317aaa781ae2a5205b46b518eea5a3d68a214eb0968dba4ac0660af7',
  executedTask: 'character_animate',
  bindsImage: true,
  imageInputPort: 'reference_images',
  retainedImageLoadFields: true,
  bindSeed: false,
  videoConditioners: wanAnimateFiles,
  chain: [
    ['face', 'modules.Video', 'Load', ''],
    ['source', 'modules.Image', 'Load', ''],
    ['pose', 'modules.Video', 'Load', ''],
    ...wanA14BRoute.chain,
  ],
};
const wanReplaceRoute = {
  ...wanAnimateRoute,
  format: 'modiff.private.wan-character-replace-inputs.v1',
  workflowId: 'WanAnimatePipeline:character_replace',
  previousExpertFamily: 'WanAnimatePipeline',
  executedTask: 'character_replace',
  videoConditioners: [...wanAnimateFiles, ['background', 'background_video', 768, 512], ['mask', 'mask', 768, 512]],
  chain: [
    ['background', 'modules.Video', 'Load', ''],
    ...wanAnimateRoute.chain.slice(0, 2),
    ['mask', 'modules.Video', 'Load', ''],
    ...wanAnimateRoute.chain.slice(2),
  ],
};

const cogVideoRoute = {
  ...wanA14BRoute,
  format: 'modiff.private.cogvideox-video-prompt-variant.v1',
  workflowId: 'CogVideoXPipeline:text_to_video',
  modelType: 'CogVideoXPipeline',
  previousExpertFamily: null,
  modelRepo: 'zai-org/CogVideoX-2b',
  modelRevision: '1137dacfc2c9c012bed6a0793f4ecf2ca8e7ba01',
  retainedVaeTiling: true,
};

const cogVideoEditRoute = {
  ...cogVideoRoute,
  format: 'modiff.private.cogvideox-source-video-variant.v1',
  workflowId: 'CogVideoXVideoToVideoPipeline:video_to_video',
  modelType: 'CogVideoXVideoToVideoPipeline',
  retainedVaeTiling: false,
  executedTask: 'video_to_video',
  bindsVideoUpload: true,
  sourceFingerprint: 'sha256:backend-source-v1:43f2ed10792fc6167b963166287cf7d5a0429afa26029e6455b0418e2123be86',
  chain: [
    ['source', 'modules.Video', 'Load', ''],
    ['normalize', 'modules.VideoConditioning', 'Normalize', 'height num_frames width'],
    ...cogVideoRoute.chain,
  ],
};

const animateDiffPagRoute = {
  ...wanA14BRoute,
  format: 'modiff.private.animatediff-pag-video-prompt-variant.v1',
  workflowId: 'AnimateDiffPAGPipeline:text_to_video',
  modelType: 'AnimateDiffPAGPipeline',
  platform: /^Windows-/u,
  backend: 'cuda',
  previousExpertFamily: 'AudioLDM2Pipeline',
  modelRepo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
  modelRevision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
  motionAdapter: {
    repoId: 'guoyww/animatediff-motion-adapter-v1-5-2',
    revision: '6167b88ffe39b4441fdf2113e77b99a6f56b7906',
  },
  configuredUnobservedControls: ['pag_scale', 'pag_adaptive_scale'],
};

const animateDiffEditRoute = {
  ...cogVideoEditRoute,
  format: 'modiff.private.animatediff-source-video-variant.v1',
  workflowId: 'AnimateDiffVideoToVideoPipeline:video_to_video',
  modelType: 'AnimateDiffVideoToVideoPipeline',
  platform: animateDiffPagRoute.platform,
  backend: animateDiffPagRoute.backend,
  modelRepo: animateDiffPagRoute.modelRepo,
  modelRevision: animateDiffPagRoute.modelRevision,
  motionAdapter: animateDiffPagRoute.motionAdapter,
  sourceFingerprint: 'sha256:backend-source-v1:2beaa95aae8558e64cf99f056b011d00c0653dc7d03987cd67c8ed7e774c770e',
  replayedRuntimeContract: 'e5d045d5ecf997c0cfe8dba771fd92cfc1fef6d3e10d91791b2b5e747f384b3c',
  reviewedSettings: [['generator', 'strength', 0.8, 0.45]],
};

const animateDiffGuideChain = [
  ['guide', 'modules.Video', 'Load', ''],
  ['normalizeGuide', 'modules.VideoConditioning', 'Normalize', 'height num_frames width'],
  ['edges', 'modules.VideoConditioning', 'EdgePreprocessor', ''],
];

const animateDiffGuideRoute = {
  ...animateDiffEditRoute,
  format: 'modiff.private.animatediff-guide-video-variant.v1',
  workflowId: 'AnimateDiffControlNetPipeline:control_to_video',
  modelType: 'AnimateDiffControlNetPipeline',
  executedTask: 'control_to_video',
  bindsVideoUpload: false,
  bindsVideoGuide: true,
  sourceFingerprint: 'sha256:backend-source-v1:a107f0838ce3b1be98034123eb3bf3393928a09c5ad7e3c133687d5a7c58be57',
  reviewedSettings: [],
  controlAdapter: {
    repoId: 'lllyasviel/control_v11p_sd15_canny',
    revision: '115a470d547982438f70198e353a921996e2e819',
  },
  chain: [...animateDiffGuideChain, ...wanA14BRoute.chain],
};

const animateDiffGuidedEditRoute = {
  ...animateDiffGuideRoute,
  format: 'modiff.private.animatediff-source-and-guide-video-variant.v1',
  workflowId: 'AnimateDiffVideoToVideoControlNetPipeline:control_video_to_video',
  modelType: 'AnimateDiffVideoToVideoControlNetPipeline',
  executedTask: 'control_video_to_video',
  bindsVideoUpload: true,
  sourceFingerprint: 'sha256:backend-source-v1:b4a707d462a5f13dae1660c1665ed5195f45ed4ffbfcd7d80de879cd881aea86',
  chain: [...animateDiffGuideChain, ...animateDiffEditRoute.chain],
};

const allegroRoute = {
  ...wanA14BRoute,
  format: 'modiff.private.allegro-video-prompt-variant.v1',
  workflowId: 'AllegroPipeline:text_to_video',
  modelType: 'AllegroPipeline',
  previousExpertFamily: 'AllegroPipeline',
  modelRepo: 'rhymes-ai/Allegro',
  modelRevision: 'c1b9207bb5cb79e2aa08f3d139c17d26c0de55b6',
  sourceFingerprint: 'sha256:backend-source-v1:b29a5b0d317aaa781ae2a5205b46b518eea5a3d68a214eb0968dba4ac0660af7',
  bindNegativePrompt: true,
  retainedNativeMathDefault: true,
  reviewedSettings: [
    ['recipe', 'attention_backend', '_native_math', 'auto'],
    ['recipe', 'offload_mode', 'sequential_cpu', 'model_cpu'],
  ],
  retainedOffloadFallback: 'sequential_cpu',
};

const sanaVideoRoute = {
  ...wanA14BRoute,
  format: 'modiff.private.sana-video-prompt-variant.v1',
  workflowId: 'SanaVideoPipeline:text_to_video',
  modelType: 'SanaVideoPipeline',
  previousExpertFamily: 'AllegroPipeline',
  modelRepo: 'Efficient-Large-Model/SANA-Video_2B_480p_diffusers',
  modelRevision: 'db5f398b13ca086d09a50ce156c20527773841b1',
  bindNegativePrompt: true,
};

const sanaOpeningImageRoute = {
  ...sanaVideoRoute,
  format: 'modiff.private.sana-opening-image-variant.v1',
  workflowId: 'SanaImageToVideoPipeline:image_to_video',
  modelType: 'SanaImageToVideoPipeline',
  previousExpertFamily: null,
  executedTask: 'image_to_video',
  bindsImage: true,
  imageInputPort: 'reference_images',
  retainedImageLoadFields: true,
  retainedNativeMathDefault: true,
  reviewedSettings: [['recipe', 'attention_backend', '_native_math', 'auto']],
  chain: [['source', 'modules.Image', 'Load', ''], ...sanaVideoRoute.chain],
};

const mochiVideoRoute = {
  ...wanA14BRoute,
  format: 'modiff.private.mochi-video-prompt-variant.v1',
  workflowId: 'MochiPipeline:text_to_video',
  modelType: 'MochiPipeline',
  modelRepo: 'genmo/mochi-1-preview',
  modelRevision: '14be5fcea23095ed330cb214647916a451e38b6e',
  previousExpertFamily: 'SanaImageToVideoPipeline',
  sourceFingerprint: 'sha256:backend-source-v1:b29a5b0d317aaa781ae2a5205b46b518eea5a3d68a214eb0968dba4ac0660af7',
  bindNegativePrompt: true,
  retainedNativeMathDefault: true,
  reviewedSettings: [['recipe', 'attention_backend', '_native_math', 'auto']],
};

const animateDiffVideoRoute = {
  ...animateDiffPagRoute,
  format: 'modiff.private.animatediff-video-prompt-variant.v1',
  workflowId: 'AnimateDiffPipeline:text_to_video',
  modelType: 'AnimateDiffPipeline',
  previousExpertFamily: 'AnimateLCMPipeline',
  sourceFingerprint: 'sha256:backend-source-v1:2faeaaa03b7902a03df5cd0cea38129b7419f6d844125c0ca7e29ccfaf635290',
  configuredUnobservedControls: undefined,
};

const animateLcmVideoRoute = {
  ...animateDiffVideoRoute,
  format: 'modiff.private.animatelcm-video-prompt-variant.v1',
  workflowId: 'AnimateLCMPipeline:text_to_video',
  modelType: 'AnimateLCMPipeline',
  motionAdapter: { repoId: 'wangfuyun/AnimateLCM', revision: '3d4d00fc113225e1040f4d3bec504b6ec750c10c' },
};

const latteVideoRoute = {
  ...wanA14BRoute,
  format: 'modiff.private.latte-video-prompt-variant.v1',
  workflowId: 'LattePipeline:text_to_video',
  modelType: 'LattePipeline',
  modelRepo: 'maxin-cn/Latte-1',
  modelRevision: '0653024365272f061fc44d1078134df22842b687',
  previousExpertFamily: null,
  sourceFingerprint: mochiVideoRoute.sourceFingerprint,
  bindNegativePrompt: true,
};

const wanVaceVideoRoute = {
  ...wanA14BRoute,
  format: 'modiff.private.wan-vace-video-prompt-variant.v1',
  workflowId: 'WanVACEPipeline:text_to_video',
  modelType: 'WanVACEPipeline',
  modelRepo: 'Wan-AI/Wan2.1-VACE-1.3B-diffusers',
  modelRevision: 'ec4d2cb062b548996b179d493fdd05340de702a1',
  previousExpertFamily: 'WanVACEPipeline',
  sourceFingerprint: mochiVideoRoute.sourceFingerprint,
  baselinePromptHash: '156339977073854795a350225015284e3676c45a49a30bff4d8120389e841848',
  baselineNegativePromptHash: '767ef620d530158fb8c7a406c8b7f5f968b617d70b4d9eaf1796b4b5ffa57c98',
  bindNegativePrompt: true,
  videoUpscaler: {
    repoId: 'nateraw/real-esrgan',
    file: {
      source: 'hub',
      value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
      revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
      byteSize: 67061725,
      sha256: '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb',
      license: 'bsd-3-clause',
    },
    scale: 2,
  },
  chain: [
    ...wanA14BRoute.chain.slice(0, -1),
    ['upscaler', 'modules.Spandrel', 'Upscaler', 'device model_id'],
    wanA14BRoute.chain.at(-1),
  ],
};

const promptModelSet = (profile) =>
  [
    ...(profile.motionAdapter ? [profile.motionAdapter] : []),
    ...(profile.controlAdapter ? [profile.controlAdapter] : []),
    { repoId: profile.modelRepo, revision: profile.modelRevision },
    ...(profile.videoUpscaler
      ? [{ repoId: profile.videoUpscaler.file.value, revision: profile.videoUpscaler.file.revision }]
      : []),
  ].sort((left, right) => (left.repoId === right.repoId ? 0 : left.repoId < right.repoId ? -1 : 1));

const imagePromptRoute = {
  outputKind: 'image',
  displayType: 'image',
  contentType: 'image/webp',
  loaderContract: ['modules.DiffusersImage.LoadPipeline'],
  bindSeed: true,
  chain: [
    ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2', ''],
    ['recipe', 'modules.DiffusersRuntime', 'DiffusersExecutionRecipe', ''],
    ['loader', 'modules.DiffusersImage', 'LoadPipeline', ''],
    ['generator', 'modules.DiffusersImage', 'Generate', ''],
    ['preview', 'modules.Image', 'Preview', ''],
  ],
};

const same = (actual, expected, message) => assert.equal(stableStringify(actual), stableStringify(expected), message);
const keys = (record, fields, message) => same(Object.keys(record ?? {}).sort(), [...fields].sort(), message);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const graphEnvelope = (graph, hinted = false) =>
  keys(
    graph,
    ['sid', 'nodes', 'paths', ...(hinted ? ['runtimeHints'] : [])],
    'Unreviewed prompt variant graph envelope.',
  );

const hasFileInput = (profile, role) =>
  (role === 'source' && (profile.bindsImage || profile.bindsVideoUpload)) ||
  (role === 'guide' && profile.bindsVideoGuide) ||
  profile.videoConditioners?.some(([name]) => name === role);

function owners(profile, api) {
  const [path] = api.paths;
  assert.equal(api.paths.length, 1, 'Expected one prompt variant execution path.');
  same(
    [...path].sort(),
    Object.keys(api.nodes).sort(),
    'Prompt variant contains an uncontrolled node or repeated path item.',
  );
  assert.equal(path.length, profile.chain.length);
  return Object.fromEntries(
    profile.chain.map(([role, module, action, capturedFields], index) => {
      const id = path[index];
      const node = api.nodes[id];
      keys(node, ['module', 'action', 'params'], 'Unreviewed prompt variant node definition.');
      assert.equal(node.module, module);
      assert.equal(node.action, action);
      const fileFields = Object.keys(node.params).filter((name) => node.params[name].display === 'filebrowser');
      same(fileFields, hasFileInput(profile, role) ? ['file'] : []);
      return [role, { id, node, capturedFields: capturedFields ? capturedFields.split(' ') : [] }];
    }),
  );
}

export function bindPromptVariant(
  profile,
  original,
  created,
  output,
  baselineHash,
  sourceValue,
  guideValue,
  videos = [],
) {
  graphEnvelope(original);
  graphEnvelope(created);
  graphEnvelope(output, true);
  const expected = structuredClone(original);
  const expectedOwners = owners(profile, expected);
  if (profile.retainedVaeTiling) {
    const tiling = expectedOwners.recipe.node.params.vae_tiling;
    same(tiling, { value: false }, 'CogVideoX tiling default changed.');
    tiling.value = true;
  }
  if (profile.executionDevice === 'cpu:0') bindRetainedCpuFloat32Recipe(expectedOwners);
  if (profile.retainedNativeMathDefault) {
    const attention = expectedOwners.recipe.node.params.attention_backend;
    assert.ok(['auto', '_native_math'].includes(attention.value));
    assert.ok(!attention.sourceId && !attention.sourceKey);
    // Verify the archive's literal pre-change graph identity before applying
    // the recorded selection that became the current canonical default.
    attention.value = '_native_math';
  }
  const baseline = canonicalGraphIdentity(expected);
  assert.equal(baseline.hash, baselineHash, 'The current authored prompt recipe differs from the original baseline.');
  for (const [role, field, defaultValue, reviewedValue] of profile.reviewedSettings ?? []) {
    const param = expectedOwners[role].node.params[field];
    assert.equal(param.value, defaultValue);
    assert.ok(!param.sourceId && !param.sourceKey, 'The reviewed setting must be literal.');
    param.value = reviewedValue;
  }
  const expectedInputs = expectedOwners.generator.node.params;
  if (profile.bindsImage) {
    assert.match(sourceValue, /^@data\/images\/[a-z0-9_-]{1,120}[.]png$/iu);
    const { params } = expectedOwners.source.node;
    same(params.file, { display: 'filebrowser', value: [] });
    assert.equal(params.alpha_channel.value, 'ignore');
    same(expectedInputs[profile.imageInputPort ?? 'images'], {
      display: 'input',
      sourceId: expectedOwners.source.id,
      sourceKey: 'image',
    });
    params.file.value = [sourceValue];
  }
  if (profile.bindsVideoUpload) {
    assert.match(sourceValue, /^@data\/videos\/[a-z0-9_-]{1,120}[.]mp4$/iu);
    const { source, normalize } = expectedOwners;
    same(source.node.params.file, { display: 'filebrowser', value: '' });
    same(normalize.node.params.video, { display: 'input', sourceId: source.id, sourceKey: 'video' });
    same(expectedInputs.video, { display: 'input', sourceId: normalize.id, sourceKey: 'output' });
    source.node.params.file.value = [sourceValue];
  }
  if (profile.bindsVideoGuide) {
    assert.match(guideValue, /^@data\/videos\/[a-z0-9_-]{1,120}[.]mp4$/iu);
    assert.notEqual(guideValue, sourceValue, 'Guide and source must be distinct video selections.');
    const { guide, normalizeGuide, edges } = expectedOwners;
    same(guide.node.params.file, { display: 'filebrowser', value: '' });
    same(normalizeGuide.node.params.video, { display: 'input', sourceId: guide.id, sourceKey: 'video' });
    same(edges.node.params.video, { display: 'input', sourceId: normalizeGuide.id, sourceKey: 'output' });
    same(expectedInputs.control_video, { display: 'input', sourceId: edges.id, sourceKey: 'output' });
    guide.node.params.file.value = [guideValue];
  }
  for (const [role, port] of profile.videoConditioners ?? []) {
    const { sourceValue } = videos.find((input) => input.role === role);
    assert.match(sourceValue, /^@data\/videos\/[a-z0-9_-]{1,120}[.]mp4$/iu);
    const owner = expectedOwners[role];
    same(owner.node.params.file, { display: 'filebrowser', value: '' });
    same(expectedInputs[port], { display: 'input', sourceId: owner.id, sourceKey: 'video' });
    owner.node.params.file.value = [sourceValue];
  }
  const promptSlot = expectedInputs.prompt;
  assert.equal(
    profile.baselinePromptHash ? digest(promptSlot.value) : promptSlot.value,
    profile.baselinePromptHash ?? profile.baselinePrompt ?? '',
    'The authored prompt differs from the reviewed default.',
  );
  assert.ok(!promptSlot.sourceId, 'The authored prompt must be an unconnected literal.');
  const submittedOwners = owners(profile, output);
  const prompt = submittedOwners.generator.node.params.prompt.value;
  assert.ok(typeof prompt === 'string' && prompt.length <= 4096 && prompt.trim() === prompt && prompt.length > 0);
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(prompt), 'Prompt exercise contains an unsupported control character.');
  promptSlot.value = prompt;
  let negativePrompt;
  if (profile.bindNegativePrompt) {
    const slot = expectedInputs.negative_prompt;
    const baselineValue = profile.baselineNegativePromptHash ? slot.value : '';
    assert.deepEqual(slot, { value: baselineValue, display: 'textarea' });
    if (profile.baselineNegativePromptHash) {
      assert.equal(digest(slot.value), profile.baselineNegativePromptHash);
    }
    negativePrompt = submittedOwners.generator.node.params.negative_prompt.value;
    assert.ok(
      typeof negativePrompt === 'string' && negativePrompt.length <= 4096 && negativePrompt.trim() === negativePrompt,
    );
    assert.ok(!/[\u0000-\u001f\u007f]/u.test(negativePrompt));
    slot.value = negativePrompt;
  }
  let seed;
  if (profile.bindSeed) {
    const seedSlot = expectedInputs.seed;
    const actualSeed = submittedOwners.generator.node.params.seed;
    for (const input of [seedSlot, actualSeed])
      assert.ok(input && !input.sourceId && !input.sourceKey, 'Prompt variant requires a literal seed.');
    const raw = actualSeed.value;
    seed = typeof raw === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(raw) ? Number(raw) : raw;
    assert.ok(Number.isSafeInteger(seed) && seed >= 0, 'Prompt variant requires a safely representable unsigned seed.');
    seedSlot.value = raw;
  }
  const identity = canonicalGraphIdentity(expected);
  const mismatch = profile.bindsImage
    ? 'Image-bound variant changed the canonical graph outside its reviewed input and controls.'
    : profile.bindSeed
      ? 'Prompt variant changed a field or wire outside the bound prompt and seed.'
      : 'Prompt variant changed a field or wire outside the empty prompt.';
  for (const graph of [created, output]) same(canonicalGraphIdentity(graph), identity, mismatch);
  return { ...submittedOwners, identity, prompt, negativePrompt, expected, seed };
}

function validateConsumedPromptVariant(profile, bound, output, suppliedImage) {
  const consumed = output.resolvedExecutionInputs;
  assert.equal(consumed.schemaVersion, 1);
  assert.equal(consumed.source, 'backend-execution');
  assert.equal(consumed.taskId, output.taskId);
  assert.equal(consumed.attemptIndex, 0);
  assert.equal(consumed.nodeId, bound.preview.id);
  assert.equal(consumed.truncated, false);
  for (const key of ['unavailableFields', 'uncapturedNodeIds']) same(consumed[key], []);
  if (profile === audioRoute) {
    same(bound.loader.node.params.execution_recipe, {
      display: 'input',
      sourceId: bound.recipe.id,
      sourceKey: 'execution_recipe',
    });
    assert.equal(bound.recipe.node.params.vae_tiling.value, false);
    // The connected execution recipe wins over this retained loader fallback.
    assert.equal(bound.loader.node.params.enable_vae_tiling.value, true);
    same(consumed.ambiguousFields, ['vaeTiling']);
  } else if (profile.retainedOffloadFallback) {
    assert.equal(bound.loader.node.params.offload_mode.value, profile.retainedOffloadFallback);
    assert.equal(bound.recipe.node.params.offload_mode.value, 'model_cpu');
    same(consumed.ambiguousFields, ['offloadMode']);
  } else {
    // The loader and reviewed upscaler each supply a repository. Their
    // typed records below independently bind the two selector values.
    same(consumed.ambiguousFields, profile.videoUpscaler ? ['repo'] : []);
  }
  const roles = profile.chain.map(([role]) => bound[role]);
  same(
    consumed.nodes.map(({ nodeId }) => nodeId).sort(),
    roles.map(({ id }) => id).sort(),
    'Native prompt variant scope differs.',
  );
  let image;
  for (const { id, node, capturedFields } of roles) {
    const row = consumed.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(row.module, node.module);
    assert.equal(row.action, node.action);
    same(row.omittedFields, {});
    if (profile.bindsImage && id === bound.source.id) {
      let decodedImage;
      if (profile.retainedImageLoadFields) {
        assert.equal(row.mediaEvidence, undefined);
        const [width] = row.fields.source_widths.value;
        const [height] = row.fields.source_heights.value;
        for (const dimension of [width, height]) assert.ok(Number.isSafeInteger(dimension) && dimension > 0);
        same(
          row.fields,
          Object.fromEntries(
            Object.entries({
              alpha_channel: 'ignore',
              source_hashes: [suppliedImage.file.sha256],
              source_widths: [width],
              source_heights: [height],
              source_modes: ['RGB'],
            }).map(([field, value]) => [field, { value, source: 'literal' }]),
          ),
          'Opening image differs from the retained Load fields.',
        );
        decodedImage = { width, height, mode: 'RGB' };
      } else {
        const native = verifyNativeLoadedImage(node, row, 'RGB');
        assert.equal(native.sourceFile.sourceValue, suppliedImage.sourceValue);
        assert.equal(
          native.sourceFile.sha256,
          suppliedImage.file.sha256,
          'Source bytes differ from the native image load.',
        );
        assert.equal(native.sourceFile.byteSize, suppliedImage.file.bytes);
        decodedImage = native.decodedImage;
      }
      image = { nodeId: id, field: 'file', sha256: suppliedImage.file.sha256, decodedImage };
      continue;
    }
    const expected = Object.fromEntries(
      capturedFields.map((field) => {
        const { value, sourceId } = node.params[field];
        assert.notEqual(value, undefined);
        assert.equal(sourceId, undefined);
        return [field, { value: field === 'model_id' ? value.value : value, source: 'literal' }];
      }),
    );
    if (profile.executedTask && id === bound.generator.id) {
      expected.executed_task = { value: profile.executedTask, source: 'literal' };
    }
    if (profile === audioRoute && id === bound.generator.id) {
      assert.equal(node.params.negative_prompt.value, '');
      assert.equal(node.params.stable_audio_steps.value, 16);
      assert.equal(node.params.stable_audio_guidance.value, 4);
      assert.equal(node.params.audio_duration.value, 5);
      for (const [name, value] of Object.entries({
        negative_prompt: null,
        num_inference_steps: node.params.stable_audio_steps.value,
        guidance_scale: node.params.stable_audio_guidance.value,
        output_type: 'pt',
      }))
        expected[name] = { value, source: 'literal' };
    }
    if (profile === audioLdmRoute && id === bound.generator.id) {
      assert.equal(node.params.negative_prompt.value, '');
      expected.negative_prompt = { value: null, source: 'literal' };
      expected.output_type = { value: 'pt', source: 'literal' };
      // The generic audio contract exposes these controls for AudioLDM2.
      // The ACE-style fallback values in the same graph are inactive.
      assert.equal(node.params.audio_contract.value.fieldParams.num_inference_steps.hidden, true);
      assert.equal(node.params.audio_contract.value.fieldParams.guidance_scale.hidden, true);
      expected.num_inference_steps = { value: node.params.stable_audio_steps.value, source: 'literal' };
      expected.guidance_scale = { value: node.params.stable_audio_guidance.value, source: 'literal' };
    }
    same(row.fields, expected, `Actual consumed fields differ for ${node.action}.`);
  }
  return image;
}

function validateNativePromptRuntime(profile, bound, task, hints, graphCompleted, observations) {
  const controlledArtifacts = [];
  if (profile.videoUpscaler) {
    const { file, repoId: repository } = profile.videoUpscaler;
    const { module, action, params } = bound.upscaler.node;
    same(params.model_id.value, file);
    assert.ok(file.value.startsWith(repository + '/'));
    const payload = {
      schemaVersion: 1,
      kind: 'spandrel_upscaler',
      module,
      action,
      artifact: {
        source: file.source,
        repository,
        revision: file.revision,
        weightName: file.value.slice(repository.length + 1),
        sha256: file.sha256,
      },
    };
    controlledArtifacts.push({ ...payload, descriptorSha256: digest(stableStringify(payload)) });
  }
  same(
    graphCompleted.runtimeHints,
    { ...hints, controlledArtifacts, loaderContract: profile.loaderContract },
    'Native completion has unreviewed runtime authority.',
  );
  assert.match(task.runtimeFingerprint.packages.platform, profile.platform);
  assert.equal(task.runtimeFingerprint.torch.cuda_available, true);
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  assert.ok(runtime, 'Native runtime fingerprint is incomplete.');
  const { backend, device, peakMeasurementVersion, elapsedSeconds, peakAllocatedBytes } = task.runtimeMeasurement;
  assert.equal(backend, profile.backend);
  assert.equal(device, profile.executionDevice === 'cpu:0' ? 'cuda:0' : bound.loader.node.params.device.value);
  assert.equal(peakMeasurementVersion, 2);
  assert.ok(Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 && elapsedSeconds <= 7200);
  assert.ok(Number.isSafeInteger(peakAllocatedBytes));
  if (profile.executionDevice === 'cpu:0') assert.equal(peakAllocatedBytes, 0);
  else assert.ok(peakAllocatedBytes > 0);
  for (const { repoId, revision } of promptModelSet(profile)) {
    const installedRepo = repoId === profile.videoUpscaler?.file.value ? profile.videoUpscaler.repoId : repoId;
    const matching = observations.filter((observation) => selectInstalledModelIdentity(observation, installedRepo));
    assert.equal(matching.length, 1, 'Expected a single installed identity for ' + installedRepo);
    const [observation] = matching;
    assert.equal(observation.error, false);
    assert.equal(observation.runtimeFingerprint, runtime.fingerprint);
    assert.equal(observation.models.length, 1);
    const model = selectInstalledModelIdentity(observation, installedRepo);
    const [{ complete, repairRequired }] = observation.models;
    assert.equal(complete, true);
    assert.equal(repairRequired, false);
    assert.equal(model.selectedRevision, revision);
    assert.equal(model.modelRevision, installedRepo + '@' + revision);
  }
  same(bound.loader.node.params.model_id.value, { source: 'hub', value: profile.modelRepo });
  assert.equal(bound.loader.node.params.revision.value, profile.modelRevision);
  if (profile.motionAdapter) {
    const { motion_adapter_id, motion_adapter_revision } = bound.loader.node.params;
    same(motion_adapter_id.value, { source: 'hub', value: profile.motionAdapter.repoId });
    assert.equal(motion_adapter_revision.value, profile.motionAdapter.revision);
  }
  return { runtime, measurement: task.runtimeMeasurement };
}

export function validateSampledCpuWorkerMemory(bytes, worker, source, task) {
  keys(worker, ['origin', 'pid', 'source']);
  assert.match(worker.origin, /^http:\/\/127[.]0[.]0[.]1:[1-9][0-9]{0,4}$/u);
  assert.ok(Number.isSafeInteger(worker.pid) && worker.pid > 0);
  assert.equal(worker.source.fingerprint, source.fingerprint);
  assert.equal(worker.source.fileCount, source.files.length);
  assert.equal(worker.source.gitCommit, source.gitCommit);
  const samples = new TextDecoder('utf-8', { fatal: true })
    .decode(bytes)
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const { started_at: started, completed_at: completed } = task;
  assert.ok(Number.isFinite(started) && Number.isFinite(completed) && completed > started);
  assert.ok(samples.length >= 3 && samples.length <= 10000);
  assert.ok(samples[0].unixTime <= started && started - samples[0].unixTime < 15);
  assert.ok(samples.at(-1).unixTime >= completed && samples.at(-1).unixTime - completed < 15);
  let previous = -Infinity;
  let peak = 0;
  for (const sample of samples) {
    keys(sample, ['unixTime', 'hostAvailable', 'workerRss', 'accelerator']);
    const { unixTime, workerRss, hostAvailable } = sample;
    assert.ok(Number.isFinite(unixTime) && unixTime > previous);
    if (Number.isFinite(previous)) assert.ok(unixTime - previous <= 3);
    assert.ok(Number.isSafeInteger(workerRss) && workerRss > 0);
    assert.ok(Number.isSafeInteger(hostAvailable) && hostAvailable > 0);
    if (unixTime >= started && unixTime <= completed) peak = Math.max(peak, workerRss);
    previous = unixTime;
  }
  assert.ok(
    Number.isSafeInteger(task.runtimeMeasurement.processRssBytes) && task.runtimeMeasurement.processRssBytes > 0,
  );
  assert.ok(peak >= task.runtimeMeasurement.processRssBytes);
  return peak;
}

export function validateImagePromptPreparation(preparation, { modelType, previousExpertFamily }) {
  const previous = preparation?.previousModelFamily ?? null;
  assert.ok(previous === null || previous === previousExpertFamily, 'Unreviewed previous Expert model family.');
  if (preparation?.performed !== true) {
    validateUnmodifiedExpertPreparation(preparation, modelType, previous);
    return;
  }
  const { cleanup, reasons, ...unchanged } = preparation;
  validateUnmodifiedExpertPreparation(
    { ...unchanged, performed: false, cleanup: null, reasons: [] },
    modelType,
    previous,
  );
  let reason = 'cached model family is unknown';
  if (previous === modelType) {
    reason = `resource recipe changed within ${modelType}`;
  } else if (previous !== null) {
    reason = `model family changed from ${previous} to ${modelType}`;
  }
  same(reasons, [reason], 'Unreviewed direct image cache cleanup.');
  keys(cleanup, ['released', 'allocatorTrimmed', 'errors']);
  same(cleanup.errors, [], 'Direct image cache cleanup failed.');
  assert.equal(typeof cleanup.allocatorTrimmed, 'boolean');
  keys(cleanup.released, ['nodes', 'models', 'diffusers_components', 'offload_files']);
  assert.ok(Object.values(cleanup.released).every((count) => Number.isSafeInteger(count) && count >= 0));
}

function nativeTextResult(bytes, item) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(bytes.equals(Buffer.from(text)), 'Original JSON output encoding differs.');
  const payload = JSON.parse(text);
  assert.ok(Array.isArray(payload) && payload.length === 1 && typeof payload[0] === 'string');
  assert.ok(
    stableStringify(item.value) === stableStringify(payload),
    'Original text does not match the saved native output.',
  );
  return JSON.parse(payload[0]);
}

function validateGeneratedText(result, bound) {
  assert.equal(result.schemaVersion, 1);
  assert.ok(typeof result.text === 'string' && result.text.trim() && result.text.length <= 4096);
  assert.ok(['stop', 'length'].includes(result.finishReason));
  assert.ok(Number.isSafeInteger(result.inputTokens) && result.inputTokens > 0);
  assert.ok(Number.isSafeInteger(result.generatedTokens) && result.generatedTokens > 0);
  assert.ok(result.generatedTokens <= bound.generator.node.params.max_new_tokens.value);
}

export function validatePromptVariantText(bytes, item, bound, runtime) {
  const result = nativeTextResult(bytes, item);
  keys(result, ['schemaVersion', 'task', 'text', 'finishReason', 'inputTokens', 'generatedTokens', 'modelReceipt']);
  assert.equal(result.task, 'text-generation');
  validateGeneratedText(result, bound);
  const { receiptDigest, ...record } = result.modelReceipt;
  const version = runtime.packages.transformers;
  assert.match(version, /^\d+(?:\.\d+){2}(?:[a-z0-9.+-]+)?$/u);
  same(
    record,
    {
      schemaVersion: 1,
      library: 'transformers',
      task: 'text-generation',
      loader: { modelAutoClass: 'AutoModelForCausalLM', preprocessorAutoClass: 'AutoTokenizer' },
      runtime: {
        architectures: ['LlamaForCausalLM'],
        device: bound.loader.node.params.device.value,
        dtype: bound.loader.node.params.dtype.value,
        modelClass: 'LlamaForCausalLM',
        modelType: 'llama',
        preprocessorClass: 'GPT2Tokenizer',
        quantization: { mode: 'none' },
        transformersVersion: version,
      },
      security: { hostedInference: false, localFilesOnly: true, safetensorsOnly: true, trustRemoteCode: false },
      source: { kind: 'hub', repository: textRoute.modelRepo, revision: textRoute.modelRevision },
    },
    'Native text model-selection receipt differs from the executed local recipe.',
  );
  assert.equal(receiptDigest, `sha256:${canonicalJsonHash(record)}`, 'Native text model receipt digest differs.');
  return {
    schemaVersion: 1,
    kind: 'json',
    finishReason: result.finishReason,
    inputTokens: result.inputTokens,
    generatedTokens: result.generatedTokens,
    modelReceiptDigest: receiptDigest,
  };
}

function validateJanusPromptVariantText(bytes, item, bound, runtime, source) {
  const result = nativeTextResult(bytes, item);
  keys(result, [
    'schemaVersion',
    'task',
    'adapter',
    'outputModality',
    'text',
    'image',
    'audio',
    'finishReason',
    'inputTokens',
    'generatedTokens',
    'inputImageCount',
    'inputMediaPixels',
    'modelReceipt',
  ]);
  assert.equal(result.task, 'any-to-any-generation');
  assert.equal(result.adapter, 'janus-v1');
  assert.equal(result.outputModality, 'text');
  assert.equal(result.image, null);
  assert.equal(result.audio, null);
  assert.equal(result.inputImageCount, source ? 1 : 0);
  assert.equal(result.inputMediaPixels, source ? source.width * source.height : 0);
  validateGeneratedText(result, bound);
  const { receiptDigest, ...record } = result.modelReceipt;
  const version = runtime.packages.transformers;
  assert.match(version, /^\d+(?:\.\d+){2}(?:[a-z0-9.+-]+)?$/u);
  same(
    record,
    {
      schemaVersion: 1,
      library: 'transformers',
      task: 'any-to-any-generation',
      adapter: {
        adapterId: 'janus-v1',
        imageGeneration: { height: 384, patchSize: 16, tokenCount: 576, width: 384 },
        inputModalities: ['image', 'text'],
        modelType: 'janus',
        outputModalities: ['image', 'text'],
      },
      loader: {
        configAutoClass: 'AutoConfig',
        modelAutoClass: 'AutoModelForMultimodalLM',
        pipelineClass: 'AnyToAnyPipeline',
        preprocessorAutoClass: 'AutoProcessor',
      },
      runtime: {
        architectures: ['JanusForConditionalGeneration'],
        device: bound.loader.node.params.device.value,
        dtype: bound.loader.node.params.dtype.value,
        modelClass: 'JanusForConditionalGeneration',
        modelType: 'janus',
        pipelineClass: 'AnyToAnyPipeline',
        preprocessorClass: 'JanusProcessor',
        transformersVersion: version,
      },
      security: { hostedInference: false, localFilesOnly: true, safetensorsOnly: true, trustRemoteCode: false },
      source: { kind: 'hub', repository: janusTextRoute.modelRepo, revision: janusTextRoute.modelRevision },
    },
    'Native Janus model-selection receipt differs from the executed local recipe.',
  );
  assert.equal(receiptDigest, `sha256:${canonicalJsonHash(record)}`, 'Native Janus model receipt digest differs.');
  return {
    schemaVersion: 1,
    kind: 'json',
    finishReason: result.finishReason,
    inputTokens: result.inputTokens,
    generatedTokens: result.generatedTokens,
    modelReceiptDigest: receiptDigest,
  };
}

function validateSmolVlmCaption(bytes, item, bound, runtime, source) {
  const result = nativeTextResult(bytes, item);
  keys(result, [
    'schemaVersion',
    'task',
    'text',
    'finishReason',
    'inputTokens',
    'generatedTokens',
    'imageCount',
    'videoFrameCount',
    'mediaPixels',
    'modelReceipt',
  ]);
  assert.equal(result.task, 'image-video-to-text');
  assert.equal(result.imageCount, 1);
  assert.equal(result.videoFrameCount, 0);
  assert.equal(result.mediaPixels, source.width * source.height);
  validateGeneratedText(result, bound);
  const { receiptDigest, ...record } = result.modelReceipt;
  const version = runtime.packages.transformers;
  assert.match(version, /^\d+(?:\.\d+){2}(?:[a-z0-9.+-]+)?$/u);
  same(
    record,
    {
      schemaVersion: 1,
      library: 'transformers',
      task: 'image-video-to-text',
      loader: { modelAutoClass: 'AutoModelForImageTextToText', preprocessorAutoClass: 'AutoProcessor' },
      runtime: {
        architectures: ['Idefics3ForConditionalGeneration'],
        device: bound.loader.node.params.device.value,
        dtype: bound.loader.node.params.dtype.value,
        modelClass: 'Idefics3ForConditionalGeneration',
        modelType: 'idefics3',
        preprocessorClass: 'Idefics3Processor',
        quantization: { mode: 'none' },
        transformersVersion: version,
      },
      security: { hostedInference: false, localFilesOnly: true, safetensorsOnly: true, trustRemoteCode: false },
      source: { kind: 'hub', repository: smolVlmCaptionRoute.modelRepo, revision: smolVlmCaptionRoute.modelRevision },
    },
    'Native SmolVLM model-selection receipt differs from the executed local recipe.',
  );
  assert.equal(receiptDigest, `sha256:${canonicalJsonHash(record)}`, 'Native SmolVLM model receipt digest differs.');
  return {
    schemaVersion: 1,
    kind: 'json',
    finishReason: result.finishReason,
    inputTokens: result.inputTokens,
    generatedTokens: result.generatedTokens,
    modelReceiptDigest: receiptDigest,
  };
}

export function validatePromptVariantVideo(decoded, item, bound) {
  const frameSize = bound.generator.node.params.frame_size.value;
  const fps = bound.preview.node.params.fps.value;
  return validateNativeVideoDelivery(decoded, item, { width: frameSize, height: frameSize, fps, frames: 20 });
}

export function validateNativeVideoDelivery(decoded, item, { width, height, fps, frames }) {
  const native = item.mediaMetadata;
  assert.equal(native.source, 'encoded-file');
  assert.equal(native.width, width);
  assert.equal(native.height, height);
  assert.equal(native.fps, fps);
  assert.equal(native.frame_count, frames);
  assert.ok(Math.abs(native.duration_seconds - native.frame_count / fps) <= 0.01);
  same(
    [decoded.width, decoded.height, decoded.fps, decoded.frames],
    [native.width, native.height, native.fps, native.frame_count],
    'Decoded video properties differ from native encoded-file metadata.',
  );
  assert.ok(Math.abs(decoded.durationSeconds - native.duration_seconds) <= 0.02);
  assert.equal(decoded.codecName, 'h264');
  assert.equal(decoded.hasAudio, false);
  assert.equal(decoded.uniqueFrameRatio, 1);
  return {
    kind: 'video',
    width: decoded.width,
    height: decoded.height,
    fps: decoded.fps,
    frames: decoded.frames,
    durationSeconds: decoded.durationSeconds,
    hash: decoded.hash,
  };
}

export async function readPromptVariantEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  const imageRoute = directImagePromptRoutes.find(({ workflowId }) => workflowId === target.workflowId);
  const profile = imageRoute
    ? { ...imagePromptRoute, ...imageRoute }
    : [
        textRoute,
        janusTextRoute,
        janusImageRoute,
        janusCaptionRoute,
        smolVlmCaptionRoute,
        videoRoute,
        audioRoute,
        audioLdmRoute,
        wanA14BRoute,
        wanA14BOpeningRoute,
        wanAnimateRoute,
        wanReplaceRoute,
        cogVideoRoute,
        cogVideoEditRoute,
        animateDiffPagRoute,
        animateDiffEditRoute,
        animateDiffGuideRoute,
        animateDiffGuidedEditRoute,
        allegroRoute,
        sanaVideoRoute,
        sanaOpeningImageRoute,
        mochiVideoRoute,
        animateDiffVideoRoute,
        animateLcmVideoRoute,
        latteVideoRoute,
        wanVaceVideoRoute,
      ].find(({ workflowId }) => workflowId === target.workflowId);
  assert.ok(profile, 'Prompt variant route is not reviewed.');
  const generatedVideo =
    profile.outputKind === 'video' &&
    (['text_to_video', 'image_to_video', 'video_to_video'].includes(profile.executedTask) ||
      profile.bindsVideoGuide ||
      Boolean(profile.videoConditioners));
  const generatedAudio = profile === audioRoute || profile === audioLdmRoute;
  const requiresOriginalRequest =
    imageRoute !== undefined ||
    profile === janusTextRoute ||
    profile === janusImageRoute ||
    profile === janusCaptionRoute ||
    profile === smolVlmCaptionRoute ||
    generatedAudio ||
    generatedVideo;
  const sampledCpuMemory = profile.executionDevice === 'cpu:0';
  same(target.modelSet, promptModelSet(profile));
  assert.equal(target.outputPlan.minimumAssetCount, 1);
  assert.ok(target.outputPlan.mediaKinds.includes(profile.outputKind));
  const stat = lstatSync(evidencePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 65536);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  keys(evidence, [
    'schemaVersion',
    'format',
    'originalGraphHash',
    'workflowId',
    'creatorPackage',
    'outputPackage',
    'runDetail',
    'nodes',
    'backendSourceBefore',
    'backendSourceAfter',
    'graphCompleted',
    'modelObservations',
    'inputs',
    'outputs',
    ...(requiresOriginalRequest ? ['graphRequest', 'graphAcknowledgment'] : []),
    ...(profile.lateNativeSnapshot ? ['persistedOutputs'] : []),
    ...(sampledCpuMemory ? ['worker', 'resourceSamples'] : []),
    ...(profile.replayedRuntimeContract ? ['registryReplay'] : []),
  ]);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, profile.format);
  assert.equal(evidence.workflowId, profile.workflowId);
  assert.ok(Array.isArray(evidence.inputs));
  const hasSourceInput = profile.bindsImage || profile.bindsVideoUpload;
  const videoConditioners = profile.videoConditioners ?? [];
  assert.equal(
    evidence.inputs.length,
    Number(Boolean(hasSourceInput)) + Number(Boolean(profile.bindsVideoGuide)) + videoConditioners.length,
  );
  const suppliedInput = hasSourceInput ? evidence.inputs[0] : undefined;
  const suppliedGuide = profile.bindsVideoGuide ? evidence.inputs.at(-1) : undefined;
  const suppliedVideos = videoConditioners.length ? evidence.inputs.slice(1) : [];
  for (const input of evidence.inputs) {
    keys(input, ['sourceValue', 'file', 'upload', ...(suppliedVideos.includes(input) ? ['role'] : [])]);
  }
  same(
    suppliedVideos.map(({ role }) => role),
    videoConditioners.map(([role]) => role),
    'The motion input roles differ from the exact recipe.',
  );
  assert.equal(new Set(evidence.inputs.map(({ file }) => file.sha256)).size, evidence.inputs.length);
  if (suppliedInput && suppliedGuide) assert.notEqual(suppliedInput.file.sha256, suppliedGuide.file.sha256);
  assert.equal(evidence.modelObservations.length, target.modelSet.length);
  assert.equal(evidence.outputs.length, 1);
  const [outputRef] = evidence.outputs;
  keys(outputRef, ['backendPath', 'mediaType', 'file']);
  const root = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  function read(ref, maximum = 16 * 1024 * 1024) {
    const physical = readCanonicalEvidenceFile(root, ref, maximum);
    retainedFiles.push({ ...ref, absolutePath: physical.file });
    return physical;
  }
  const json = (ref) => JSON.parse(read(ref).bytes);
  const creator = json(evidence.creatorPackage);
  const outputPackage = json(evidence.outputPackage);
  const run = json(evidence.runDetail);
  const graphCompleted = json(evidence.graphCompleted);
  const submitted = outputPackage.latestOutput.apiGraphSnapshot;
  const [expectedApi, creatorApi, outputApi, runApi] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    outputPackage.latestOutput.graphSnapshot,
    run.workflow_snapshot,
  ]);
  const bound = bindPromptVariant(
    profile,
    expectedApi,
    creator.apiGraph,
    submitted,
    evidence.originalGraphHash,
    suppliedInput?.sourceValue,
    suppliedGuide?.sourceValue,
    suppliedVideos,
  );
  for (const api of [creatorApi, outputApi, runApi]) {
    graphEnvelope(api);
    same(
      canonicalGraphIdentity(api),
      bound.identity,
      'Saved visual graph differs from the exact submitted prompt variant.',
    );
  }
  const runOptions = {
    target,
    outputNodeId: bound.preview.id,
    displayType: profile.displayType,
    creator,
    outputPackage,
    run,
    graphCompleted,
    ...(requiresOriginalRequest
      ? {
          graphRequest: json(evidence.graphRequest),
          graphAcknowledgment: json(evidence.graphAcknowledgment),
        }
      : {}),
    ...(imageRoute || generatedVideo || profile === audioLdmRoute
      ? { validatePreparation: (preparation) => validateImagePromptPreparation(preparation, profile) }
      : {}),
    ...(profile === videoRoute || profile === audioRoute
      ? { validatePreparation: (preparation) => validateUnmodifiedExpertPreparation(preparation, target.modelType) }
      : {}),
  };
  let validatedRun;
  let accountingRun = run;
  if (profile.lateNativeSnapshot) {
    const store = json(evidence.persistedOutputs);
    assert.equal(store.outputs.length, 1);
    const [persistedOutput] = store.outputs;
    validatedRun = validateLateNativeImageVariantRun({ ...runOptions, persistedOutput });
    accountingRun = { ...run, outputs: [persistedOutput] };
  } else {
    validatedRun = validateNativeVariantRun(runOptions);
  }
  const { task, output, hints } = validatedRun;
  same(hints.workflowSnapshot.studioForm, output.formSnapshot, 'Run snapshot form differs from persisted form.');
  const source = backendSourceEvidence({
    before: json(evidence.backendSourceBefore).identity,
    after: json(evidence.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  same(source.blockers, [], 'Backend source differs from the running process.');
  if (profile.sourceFingerprint) {
    assert.equal(source.identity.fingerprint, profile.sourceFingerprint, 'The archived source fingerprint differs.');
  }
  const accounting = imageRoute
    ? directImagePromptAccountingExecutionPlan({
        expectedApiGraph: bound.expected,
        apiGraph: submitted,
        consumed: output.resolvedExecutionInputs,
        target,
        runtimeEvidence: { run: accountingRun, output, graphCompleted, sourceFingerprint: source.identity.fingerprint },
      })
    : null;
  let inputBinding = accounting ? undefined : validateConsumedPromptVariant(profile, bound, output, suppliedInput);
  if (profile.bindsImage) {
    const source = read(suppliedInput.file, 2 * 1024 * 1024);
    const upload = json(suppliedInput.upload);
    const { width, height } = inputBinding.decodedImage;
    assert.equal(upload.error, false);
    assert.equal(upload.path, suppliedInput.sourceValue);
    same(
      upload.media,
      {
        filename: suppliedInput.sourceValue.split('/').at(-1),
        extension: '.png',
        sizeBytes: source.bytes.length,
        sha256: inputBinding.sha256,
        kind: 'image',
        mimeType: 'image/png',
        width,
        height,
        frames: 1,
      },
      'Caption input differs from the original image upload.',
    );
    if (profile.retainedImageLoadFields) {
      const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
      const decoded = await decodedMediaHash(source.file, 'image');
      same([decoded.width, decoded.height], [width, height], 'Opening image dimensions differ from the original file.');
    }
  }
  const bindRetainedVideo = async (input, load, frames) => {
    const { bytes, file } = read(input.file);
    const upload = json(input.upload);
    const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
    const decoded = await decodedMediaHash(file, 'video');
    assert.equal(upload.error, false);
    assert.equal(upload.path, input.sourceValue);
    same(
      upload.media,
      {
        filename: input.sourceValue.split('/').at(-1),
        extension: '.mp4',
        sizeBytes: bytes.length,
        sha256: digest(bytes),
        kind: 'video',
        mimeType: 'video/mp4',
        durationSeconds: decoded.durationSeconds,
        width: decoded.width,
        height: decoded.height,
      },
      'Archived video upload differs from the retained bytes.',
    );
    assert.equal(decoded.frames, frames);
    assert.equal(decoded.hasAudio, false);
    return {
      nodeId: load.id,
      field: 'file',
      sha256: digest(bytes),
      decodedVideo: {
        width: decoded.width,
        height: decoded.height,
        frames: decoded.frames,
        fps: decoded.fps,
        hash: decoded.hash,
      },
    };
  };
  if (profile.bindsVideoUpload) {
    inputBinding = await bindRetainedVideo(suppliedInput, bound.source, bound.normalize.node.params.num_frames.value);
  }
  const guideBinding = profile.bindsVideoGuide
    ? await bindRetainedVideo(suppliedGuide, bound.guide, bound.normalizeGuide.node.params.num_frames.value)
    : undefined;
  const boundVideos = [];
  for (const [index, [role, consumerPort, width, height]] of videoConditioners.entries()) {
    const frames = bound.generator.node.params.num_frames.value;
    const binding = await bindRetainedVideo(suppliedVideos[index], bound[role], frames);
    same([binding.decodedVideo.width, binding.decodedVideo.height], [width, height]);
    assert.equal(binding.decodedVideo.fps, bound.preview.node.params.fps.value);
    boundVideos.push({ role, consumerPort, ...binding });
  }
  if (!inputBinding) inputBinding = guideBinding;
  const nodeBytes = read(evidence.nodes).bytes;
  const nodes = JSON.parse(nodeBytes);
  if (profile.replayedRuntimeContract) {
    same(json(evidence.registryReplay), {
      scope: profile.bindsVideoGuide
        ? 'metadata-only replay from exact source and runtime contract'
        : 'Original nodes handler only, with exact source and runtime contract',
      modelRuns: 0,
      fileCount: source.identity.files.length,
      sourceFingerprint: source.identity.fingerprint,
      runtimeContract: profile.replayedRuntimeContract,
      nodeHash: digest(nodeBytes),
      nodeBytes: nodeBytes.length,
    });
  }
  const backendContract = backendContractIdentity(nodes, bound.identity.canonicalGraph);
  assert.ok(backendContract.fingerprint, 'Native backend contract fingerprint is missing.');
  for (const [role, module, action] of profile.chain) {
    const contract = (nodes.nodes ?? nodes)[`${module}.${action}`];
    assert.equal(contract?.module, module);
    assert.equal(contract.action, action);
    same(
      Object.keys(contract.params).filter((name) => contract.params[name].display === 'filebrowser'),
      hasFileInput(profile, role) ? ['file'] : [],
    );
  }
  const { runtime, measurement } = validateNativePromptRuntime(
    profile,
    bound,
    task,
    hints,
    graphCompleted,
    evidence.modelObservations.map(json),
  );
  const peakMemoryBytes = sampledCpuMemory
    ? validateSampledCpuWorkerMemory(
        read(evidence.resourceSamples, 1024 * 1024).bytes,
        json(evidence.worker),
        source.identity,
        task,
      )
    : measurement.peakAllocatedBytes;
  const media = read(outputRef.file, 2 * 1024 * 1024);
  const item = validateNativeVariantOutput({
    output,
    outputRef,
    task,
    bytes: media.bytes,
    displayType: profile.displayType,
    contentType: profile.contentType,
  });
  assert.match(output.id, /^run-output-[a-f0-9]{24}$/u);
  const extension = { image: 'webp', json: 'txt', video: 'mp4', audio: 'wav' }[profile.outputKind];
  assert.equal(item.backendPath, `@data/studio/outputs/${output.id}_item_00.${extension}`);
  assert.equal(output.mediaCollectionHash, `sha256:collection:${digest(JSON.stringify([item.mediaHash]))}`);
  let decodedOutput;
  if (profile === textRoute) {
    decodedOutput = validatePromptVariantText(media.bytes, item, bound, runtime);
  } else if (profile === janusTextRoute || profile === janusCaptionRoute) {
    decodedOutput = validateJanusPromptVariantText(media.bytes, item, bound, runtime, inputBinding?.decodedImage);
  } else if (profile === smolVlmCaptionRoute) {
    decodedOutput = validateSmolVlmCaption(media.bytes, item, bound, runtime, inputBinding.decodedImage);
  } else if (profile === videoRoute || generatedVideo) {
    const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
    const decoded = await decodedMediaHash(media.file, 'video');
    if (generatedVideo) {
      const { width, height, num_frames } = bound.generator.node.params;
      const scale = profile.videoUpscaler?.scale ?? 1;
      decodedOutput = validateNativeVideoDelivery(decoded, item, {
        width: width.value * scale,
        height: height.value * scale,
        frames: num_frames.value,
        fps: bound.preview.node.params.fps.value,
      });
    } else decodedOutput = validatePromptVariantVideo(decoded, item, bound);
  } else if (generatedAudio) {
    assert.equal(media.bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(media.bytes.toString('ascii', 8, 12), 'WAVE');
    const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
    const decoded = await decodedMediaHash(media.file, 'audio');
    const rate = bound.generator.node.params.sample_rate.value;
    const duration = bound.generator.node.params.audio_duration.value;
    assert.equal(rate, profile === audioRoute ? 24000 : 16000);
    assert.equal(duration, profile === audioRoute ? 5 : 10);
    assert.equal(decoded.sourceSampleRate, rate);
    assert.equal(decoded.channels, 1);
    assert.equal(decoded.clippedSampleRatio, 0);
    assert.ok(decoded.durationSeconds >= duration - 0.1 && decoded.durationSeconds <= duration);
    assert.ok(decoded.peakAmplitude > 0.05 && decoded.silenceRatio < 0.75);
    decodedOutput = {
      kind: 'audio',
      hash: decoded.hash,
      durationSeconds: decoded.durationSeconds,
      sampleRate: decoded.sourceSampleRate,
      channels: decoded.channels,
    };
  } else {
    const { decodedMediaHash, technicalMediaErrors } = await import('./template-gallery-harness.mjs');
    const decoded = await decodedMediaHash(media.file, 'image');
    same(technicalMediaErrors(decoded, { width: item.width, height: item.height }), []);
    if (profile === janusImageRoute) {
      same([decoded.width, decoded.height], [384, 384], 'Janus image dimensions differ from the reviewed image route.');
    }
    decodedOutput = { kind: 'image', hash: decoded.hash, width: decoded.width, height: decoded.height };
  }
  for (const ref of retainedFiles) readCanonicalEvidenceFile(root, ref, 16 * 1024 * 1024);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes), 'Prompt variant descriptor changed during validation.');
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: inputBinding ? 'real_backend_input_bound_model_variant' : 'real_backend_prompt_bound_model_variant',
    ...target,
    taskId: task.task_id,
    outputId: output.id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    graphHash: bound.identity.hash,
    runtimeFingerprint: normalizeBackendRuntime(runtime).lockFingerprint,
    backendSourceFingerprint: source.identity.fingerprint,
    backendContractFingerprint: backendContract.fingerprint,
    resourceCandidateId: null,
    outputHash: item.mediaHash,
    executionDurationSeconds: measurement.elapsedSeconds,
    peakMemoryBytes,
    canonicalDefaultsExecuted: false,
    promptBinding: { nodeId: bound.generator.id, field: 'prompt', sha256: digest(bound.prompt) },
    ...(profile.bindNegativePrompt
      ? {
          negativePromptBinding: {
            nodeId: bound.generator.id,
            field: 'negative_prompt',
            sha256: digest(bound.negativePrompt),
          },
        }
      : {}),
    ...(inputBinding ? { inputBinding } : {}),
    ...(guideBinding ? { guideBinding } : {}),
    ...(boundVideos.length ? { videoConditionBindings: boundVideos } : {}),
    ...(accounting ? { seedBinding: { nodeId: bound.generator.id, field: 'seed', value: bound.seed } } : {}),
    decodedOutput,
    observationLimits: {
      fullConsumedFieldAccounting: Boolean(accounting && !accounting.retainedGenerator),
      physicalPlatformQualification: false,
      ...(accounting?.retainedGenerator && imageRoute.typedOnly?.length
        ? { configuredUnobservedControls: [...imageRoute.typedOnly] }
        : {}),
      ...(sampledCpuMemory ? { memoryMeasurement: 'sampled_worker_rss' } : {}),
      ...(profile.bindsVideoUpload
        ? { sourceVideoByteWitness: 'original-upload-and-typed-wire', normalizedConsumerFramesObserved: false }
        : {}),
      ...(profile.motionAdapter ? { motionAdapterBoundByGraph: true } : {}),
      ...(profile.bindsVideoGuide
        ? {
            guideVideoByteWitness: 'original-upload-normalize-and-edge-wire',
            normalizedGuideFramesObserved: false,
            controlAdapterObservedAsInstalled: true,
            controlAdapterAppliedObserved: false,
          }
        : {}),
      ...(profile.configuredUnobservedControls
        ? { configuredUnobservedControls: profile.configuredUnobservedControls }
        : {}),
      ...(profile.retainedOffloadFallback ? { retainedLoaderOffloadFallback: profile.retainedOffloadFallback } : {}),
      ...(profile.retainedImageLoadFields
        ? { openingImageLoadFieldsObserved: true, samplerInputPixelsObserved: false }
        : {}),
      ...(boundVideos.length
        ? { motionVideoBytesWitnessed: 'original-uploads-and-typed-wires', consumedMotionFramesObserved: false }
        : {}),
      ...(profile === wanA14BOpeningRoute
        ? { openingImageByteWitness: 'native-load-and-upload-with-typed-wire', samplerInputPixelsObserved: false }
        : {}),
    },
    qualificationClaims: {
      publicTemplate: false,
      qualityApproved: false,
      rightsApproved: false,
      hardwareQualified: false,
      modelResourceQualified: false,
    },
  };
  return {
    receipt,
    provenance: {
      format: inputBinding ? 'modiff.input-bound-model-variant-proof.v1' : 'modiff.prompt-bound-model-variant-proof.v1',
      receipt,
    },
    evidence,
    descriptorBytes,
    retainedFiles,
    evidenceRoot: root,
  };
}
