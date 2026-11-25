import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { stableJsonValue } from './canonical-json.mjs';
import { verifyNativeLoadedImages, verifyRetainedHostImageFiles } from './native-image-load-evidence.mjs';
import {
  backendContractIdentity,
  backendSourceEvidence,
  canonicalGraphIdentity,
  normalizeBackendRuntime,
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
import { validateImagePromptPreparation, validateSampledCpuWorkerMemory } from './prompt-variant-evidence.mjs';

export const PRIVATE_IMAGE_EDIT_FORMAT = 'modiff.private.lcm-source-bound-edit.v1';
export const DIRECT_IMAGE_EDIT_FORMAT = 'modiff.private.direct-image-edit-source-bound.v1';
export const NATIVE_PNG_EDIT_FORMAT = 'modiff.private.direct-image-edit-native-png.v1';
export const NATIVE_PNG_INPAINT_FORMAT = 'modiff.private.direct-image-inpaint-native-png.v1';
export const SAVED_PNG_EDIT_FORMAT = 'modiff.private.saved-image-edit-native-png.v1';
const SAVED_WEBP_EDIT_FORMAT = 'modiff.private.saved-image-edit-native-webp.v1';
const FLUX_ENAMEL_EDIT_FORMAT = 'modiff.private.flux-enamel-edit-native-webp.v1';
const SAVED_HOST_FILE_EDIT_FORMAT = 'modiff.private.saved-image-edit-native-host-file.v1';
const RETAINED_SERVER_EDIT_FORMAT = 'modiff.private.server-retained-image-edit-native-png.v1';
const baseConsumed = ['num_inference_steps', 'output_type', 'prompt', 'seed'];
const imageGeometry = ['height', 'max_sequence_length', 'width'];
const stableDiffusionEditConsumed = [...baseConsumed, 'negative_prompt', 'guidance_scale', 'strength'];
const retainedImageEdit = {
  format: SAVED_PNG_EDIT_FORMAT,
  captureFormat: 'modiff.private.direct-image-edit-observation.v1',
  consumed: [...baseConsumed, ...imageGeometry, 'negative_prompt', 'guidance_scale'],
  inactiveRecorded: ['strength'],
  inputPathPrefix: '@data/images/',
  nativeSourceMedia: true,
  outputGeometryFromSettings: true,
};
const joyPlusEdit = {
  ...retainedImageEdit,
  modelRepo: 'jdopensource/JoyAI-Image-Edit-Plus-Diffusers',
  modelRevision: 'c2686460c7b64d8aa11bc4d0da423fb316b33f9e',
  loaderClass: 'JoyImageEditPlusPipeline',
};
const qwenPlusEdit = {
  ...retainedImageEdit,
  modelRepo: 'Qwen/Qwen-Image-Edit-2511',
  modelRevision: '6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9',
  loaderClass: 'QwenImageEditPlusPipeline',
  sourceFingerprint: 'sha256:backend-source-v1:e3aea8f8d102572ad10fdd0700f0c42d92061e864ede89777efcd6a3269770a8',
  runtimeContractDigest: '8cbe038eeeb6d4a4c079783b8d7e4915d9f78faad9495cb8e354504c66925cf5',
  fullNativeSnapshot: true,
  guidanceObservedAsTrueCfg: true,
};
const retainedCfgInpaint = {
  ...retainedImageEdit,
  captureFormat: 'modiff.private.direct-image-inpaint-observation.v1',
  consumed: [...retainedImageEdit.consumed, 'strength'],
  inactiveRecorded: [],
  sourceFingerprint: 'sha256:backend-source-v1:43f2ed10792fc6167b963166287cf7d5a0429afa26029e6455b0418e2123be86',
  runtimeContractDigest: qwenPlusEdit.runtimeContractDigest,
  fullNativeSnapshot: true,
  guidanceObservedAsTrueCfg: true,
  masked: true,
};
const retainedOutpaint = {
  ...retainedCfgInpaint,
  masked: false,
  captureFormat: retainedImageEdit.captureFormat,
  sourceFingerprint: qwenPlusEdit.sourceFingerprint,
  guidanceObservedAsTrueCfg: false,
  task: 'outpaint',
  canvasVariant: [
    ['overlap', 24, 80],
    ['feather', 8, 28],
  ],
  unobservedControls: ['left', 'right', 'top', 'bottom', 'overlap', 'feather', 'fill_color'],
};
const editRoutes = new Map([
  [
    'DreamLitePipeline:edit_image',
    {
      ...retainedImageEdit,
      format: SAVED_WEBP_EDIT_FORMAT,
      modelRepo: 'carlofkl/DreamLite-base',
      modelRevision: '751cb8dbb9072a8c8ffd8684e0f254b50f20531b',
      loaderClass: 'DreamLitePipeline',
      sourceFingerprint: 'sha256:backend-source-v1:6c9e4842b9ebdfd2427b449dd490bef2b22ff3346d7c440bf4a90b2365184385',
      originalRegistryHash: '946f902f4cd1c1e65f9b3b0413393278670905fd755e5bd9e5f506e2e72bc5e0',
      fullNativeSnapshot: true,
    },
  ],
  [
    'DreamLiteMobilePipeline:edit_image',
    {
      modelRepo: 'carlofkl/DreamLite-mobile',
      modelRevision: '6695c3f4be230f0493fa5dbf78be3bc4d3bb2ab4',
      loaderClass: 'DreamLiteMobilePipeline',
      format: DIRECT_IMAGE_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-edit-observation.v1',
      consumed: [...baseConsumed, ...imageGeometry],
      fullNativeSnapshot: true,
    },
  ],
  [
    'FluxDevPipeline:edit_image',
    {
      ...retainedImageEdit,
      format: SAVED_WEBP_EDIT_FORMAT,
      modelRepo: 'black-forest-labs/FLUX.1-dev',
      modelRevision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
      loaderClass: 'FluxImg2ImgPipeline',
      consumed: [...retainedImageEdit.consumed, 'strength'],
      inactiveRecorded: [],
      sourceFingerprint: retainedCfgInpaint.sourceFingerprint,
      runtimeContractDigest: retainedCfgInpaint.runtimeContractDigest,
      fullNativeSnapshot: true,
      guidanceObservedAsTrueCfg: true,
      savedNativeRecipe: {
        format: FLUX_ENAMEL_EDIT_FORMAT,
        sourceFingerprint: 'sha256:backend-source-v1:b29a5b0d317aaa781ae2a5205b46b518eea5a3d68a214eb0968dba4ac0660af7',
        originalRegistryHash: '194fdfe25573ca708535e0913337cfee8c1137a2b3860f5c5c5a7c5419951d46',
        strengthVariant: { original: 0.8, retained: 0.92 },
        guidanceVariant: { original: 3.5, retained: 4 },
        nativeSourceMedia: false,
      },
    },
  ],
  [
    'ChromaImg2ImgPipeline:edit_image',
    {
      ...retainedImageEdit,
      modelRepo: 'lodestones/Chroma1-HD',
      modelRevision: '0e0c60ece1e82b17cb7f77342d765ba5024c40c0',
      loaderClass: 'ChromaImg2ImgPipeline',
      consumed: [...retainedImageEdit.consumed, 'strength'],
      inactiveRecorded: [],
      sourceFingerprint: 'sha256:backend-source-v1:b29a5b0d317aaa781ae2a5205b46b518eea5a3d68a214eb0968dba4ac0660af7',
      originalRegistryHash: 'c4e99d780fef75bce44f4c5e7414d99840a794999355308f69f03176bd573193',
      fullNativeSnapshot: true,
      previousExpertFamily: 'QwenImageImg2ImgPipeline',
    },
  ],
  [
    'FluxKontextInpaintPipeline:outpaint',
    {
      ...retainedOutpaint,
      modelRepo: 'black-forest-labs/FLUX.1-Kontext-dev',
      modelRevision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
      loaderClass: 'FluxKontextInpaintPipeline',
      sourceFingerprint: 'sha256:backend-source-v1:272116bf77447dfb20b0899666ae417b68401993dd97ca438db63d91ff79cab6',
      originalRegistryHash: '33be3a472703c43591f907916a3c4b8901af522c24d1930eb88f75c8033f4cec',
      fullNativeSnapshot: false,
      guidanceObservedAsTrueCfg: true,
      canvasVariant: [
        ['overlap', 24, 72],
        ['feather', 8, 28],
      ],
      strengthVariant: { original: 0.85, retained: 1 },
    },
  ],
  [
    'FluxKontextInpaintPipeline:inpaint',
    {
      ...retainedCfgInpaint,
      format: SAVED_WEBP_EDIT_FORMAT,
      modelRepo: 'black-forest-labs/FLUX.1-Kontext-dev',
      modelRevision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
      loaderClass: 'FluxKontextInpaintPipeline',
      originalRegistryHash: '4a6a3ee6a0ba2f07d6e2f66daf085d4d43b70e0180a4b277b44b0b25f7a4c06c',
      fullNativeSnapshot: false,
    },
  ],
  [
    'ChromaInpaintPipeline:outpaint',
    {
      ...retainedOutpaint,
      modelRepo: 'lodestones/Chroma1-HD',
      modelRevision: '0e0c60ece1e82b17cb7f77342d765ba5024c40c0',
      loaderClass: 'ChromaInpaintPipeline',
      sourceFingerprint: 'sha256:backend-source-v1:70bc1ff7fe61307be52cfda86b38c6400f2156cbc8240a489b62ff19a93d58dc',
      originalRegistryHash: '67979c2308c670f70d5d4fd38672be0a3ccd3cae7f083d1c7e7ae2e2169f90e8',
      alternateSourceRegistryPair: {
        sourceFingerprint: 'sha256:backend-source-v1:ee86f26ee410419fae168f4380029a01d302ec0fd0607308d9b1e40ae2ace7f7',
        registryHash: '100a85d1bff56ef6d0bf236fb4a69f869b3c909a7a4ec31683bbc7f24d24d80c',
        // This worker records the original upload and native load hashes and dimensions.
        nativeSourceMedia: false,
      },
      canvasVariant: [],
    },
  ],
  [
    'StableDiffusionXLPAGPipeline:edit_image',
    {
      ...retainedImageEdit,
      modelRepo: 'stabilityai/stable-diffusion-xl-base-1.0',
      modelRevision: '462165984030d82259a11f4367a4eed129e94a7b',
      loaderClass: 'StableDiffusionXLPAGImg2ImgPipeline',
      consumed: stableDiffusionEditConsumed,
      inactiveRecorded: ['width', 'height', 'max_sequence_length'],
      sourceFingerprint: 'sha256:backend-source-v1:2faeaaa03b7902a03df5cd0cea38129b7419f6d844125c0ca7e29ccfaf635290',
      originalRegistryHash: 'fd66c8907b4a7969c1a87757f4d9e629d62395c55b8b74f730432cf1ce47d13e',
      fullNativeSnapshot: true,
      windowsCudaRuntime: true,
      previousUnmodifiedModelFamily: 'StableDiffusionXLPAGInpaintPipeline',
      unobservedControls: ['pag_scale', 'pag_adaptive_scale'],
      reviewedSourceRecipes: new Map([
        [
          '4cbc984b44c398b6e92b4350513d3543139e9dffe01a38857845c8a7698272c8',
          { strengthVariant: { original: 0.8, retained: 0.85 }, previousExpertFamily: 'AnimateLCMPipeline' },
        ],
      ]),
    },
  ],
  [
    'QwenImageModularPipeline:edit_image',
    {
      ...retainedImageEdit,
      format: SAVED_WEBP_EDIT_FORMAT,
      modelRepo: 'Qwen/Qwen-Image-2512',
      modelRevision: '25468b98e3276ca6700de15c6628e51b7de54a26',
      loaderClass: 'QwenImageImg2ImgPipeline',
      consumed: [...retainedImageEdit.consumed, 'strength'],
      inactiveRecorded: [],
      guidanceObservedAsTrueCfg: true,
      sourceFingerprint: 'sha256:backend-source-v1:b29a5b0d317aaa781ae2a5205b46b518eea5a3d68a214eb0968dba4ac0660af7',
      originalRegistryHash: 'c4e99d780fef75bce44f4c5e7414d99840a794999355308f69f03176bd573193',
      fullNativeSnapshot: true,
      previousExpertFamily: 'OmniGenPipeline',
    },
  ],
  [
    'Flux2KleinInpaintPipeline:outpaint',
    {
      ...retainedOutpaint,
      modelRepo: 'black-forest-labs/FLUX.2-klein-4B',
      modelRevision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
      loaderClass: 'Flux2KleinInpaintPipeline',
      consumed: [...baseConsumed, ...imageGeometry, 'guidance_scale', 'strength'],
      inactiveRecorded: ['negative_prompt'],
      strengthVariant: { original: 0.85, retained: 1 },
    },
  ],
  [
    'ZImageInpaintPipeline:outpaint',
    {
      ...retainedOutpaint,
      modelRepo: 'Tongyi-MAI/Z-Image-Turbo',
      modelRevision: 'f332072aa78be7aecdf3ee76d5c247082da564a6',
      loaderClass: 'ZImageInpaintPipeline',
      fullNativeSnapshot: false,
    },
  ],
  [
    'StableDiffusionXLPAGPipeline:inpaint',
    {
      ...retainedCfgInpaint,
      modelRepo: 'stabilityai/stable-diffusion-xl-base-1.0',
      modelRevision: '462165984030d82259a11f4367a4eed129e94a7b',
      loaderClass: 'StableDiffusionXLPAGInpaintPipeline',
      consumed: [...stableDiffusionEditConsumed, 'width', 'height'],
      inactiveRecorded: ['max_sequence_length'],
      sourceFingerprint: 'sha256:backend-source-v1:2faeaaa03b7902a03df5cd0cea38129b7419f6d844125c0ca7e29ccfaf635290',
      originalRegistryHash: 'fd66c8907b4a7969c1a87757f4d9e629d62395c55b8b74f730432cf1ce47d13e',
      guidanceObservedAsTrueCfg: false,
      windowsCudaRuntime: true,
      previousExpertFamily: 'AnimateDiffPipeline',
      strengthVariant: { original: 0.8, retained: 1 },
      unobservedControls: ['pag_scale', 'pag_adaptive_scale'],
    },
  ],
  [
    'Flux2KleinInpaintPipeline:inpaint',
    {
      ...retainedCfgInpaint,
      modelRepo: 'black-forest-labs/FLUX.2-klein-4B',
      modelRevision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
      loaderClass: 'Flux2KleinInpaintPipeline',
      consumed: [...baseConsumed, ...imageGeometry, 'guidance_scale', 'strength'],
      inactiveRecorded: ['negative_prompt'],
      sourceFingerprint: qwenPlusEdit.sourceFingerprint,
      guidanceObservedAsTrueCfg: false,
    },
  ],
  [
    'ZImageInpaintPipeline:inpaint',
    {
      ...retainedCfgInpaint,
      modelRepo: 'Tongyi-MAI/Z-Image-Turbo',
      modelRevision: 'f332072aa78be7aecdf3ee76d5c247082da564a6',
      loaderClass: 'ZImageInpaintPipeline',
      sourceFingerprint: qwenPlusEdit.sourceFingerprint,
      guidanceObservedAsTrueCfg: false,
    },
  ],
  [
    'OmniGenPipeline:edit_image',
    {
      ...retainedImageEdit,
      format: RETAINED_SERVER_EDIT_FORMAT,
      modelRepo: 'Shitao/OmniGen-v1-diffusers',
      modelRevision: '016e2f61d12a98303f6bbdf122687694d7984268',
      loaderClass: 'OmniGenPipeline',
      consumed: [...baseConsumed, 'width', 'height', 'guidance_scale'],
      inactiveRecorded: ['negative_prompt', 'max_sequence_length', 'strength'],
      inputImagePromptPrefix: '<img><|image_1|></img> ',
      unobservedControls: ['image_guidance_scale'],
      sourceFingerprint: 'sha256:backend-source-v1:b29a5b0d317aaa781ae2a5205b46b518eea5a3d68a214eb0968dba4ac0660af7',
      originalRegistryHash: 'c4e99d780fef75bce44f4c5e7414d99840a794999355308f69f03176bd573193',
      serverRetainedOutput: true,
      previousExpertFamily: 'ChromaImg2ImgPipeline',
    },
  ],
  [
    'OmniGenPipeline:multi_image_reference_edit',
    {
      ...retainedImageEdit,
      modelRepo: 'Shitao/OmniGen-v1-diffusers',
      modelRevision: '016e2f61d12a98303f6bbdf122687694d7984268',
      loaderClass: 'OmniGenPipeline',
      consumed: [...baseConsumed, 'width', 'height', 'guidance_scale'],
      inactiveRecorded: ['negative_prompt', 'max_sequence_length', 'strength'],
      orderedReferences: 1,
      task: 'multi_image_reference_edit',
      retainedFormMode: 'edit_image',
      inputImagePromptPrefix: '<img><|image_1|></img> <img><|image_2|></img> ',
      unobservedControls: ['image_guidance_scale'],
      sourceFingerprint: 'sha256:backend-source-v1:b29a5b0d317aaa781ae2a5205b46b518eea5a3d68a214eb0968dba4ac0660af7',
      originalRegistryHash: 'c4e99d780fef75bce44f4c5e7414d99840a794999355308f69f03176bd573193',
      fullNativeSnapshot: true,
      previousExpertFamily: 'LongCatImagePipeline',
    },
  ],
  [
    'Kandinsky3Pipeline:edit_image',
    {
      ...retainedImageEdit,
      modelRepo: 'kandinsky-community/kandinsky-3',
      modelRevision: 'bf79e6c219da8a94abb50235fdc4567eb8fb4632',
      loaderClass: 'Kandinsky3Img2ImgPipeline',
      consumed: stableDiffusionEditConsumed,
      inactiveRecorded: imageGeometry,
      sourceFingerprint: 'sha256:backend-source-v1:175112f2430928958bd90dc5ae78b50ce0a54403e42e28cfc68096945d05fbe6',
      originalRegistryHash: 'c4e6cbddbff684ac03dfb6625a04048f484d0ed38d58bb14daf072e629458d69',
      cpuExecution: true,
    },
  ],
  [
    'LongCatImageEditPipeline:edit_image',
    {
      ...retainedImageEdit,
      format: SAVED_WEBP_EDIT_FORMAT,
      modelRepo: 'meituan-longcat/LongCat-Image-Edit',
      modelRevision: '7b54ef423aa7854be7861600024be5c56ab7875a',
      loaderClass: 'LongCatImageEditPipeline',
      consumed: [...baseConsumed, 'negative_prompt', 'guidance_scale'],
      inactiveRecorded: [...imageGeometry, 'strength'],
      sourceFingerprint: retainedCfgInpaint.sourceFingerprint,
      runtimeContractDigest: retainedCfgInpaint.runtimeContractDigest,
      fullNativeSnapshot: true,
    },
  ],
  [
    'LatentConsistencyModelPipeline:edit_image',
    {
      modelRepo: 'SimianLuo/LCM_Dreamshaper_v7',
      modelRevision: 'a85df6a8bd976cdd08b4fd8f3b73f229c9e54df5',
      loaderClass: 'LatentConsistencyModelImg2ImgPipeline',
      format: PRIVATE_IMAGE_EDIT_FORMAT,
      captureFormat: 'modiff.private.lcm-image-edit-observation.v1',
      consumed: [...baseConsumed, 'guidance_scale', 'strength'],
    },
  ],
  [
    'SanaSprintPipeline:edit_image',
    {
      modelRepo: 'Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers',
      modelRevision: 'aa76e7f4f4928f378716b6716a2130fba3caf5b1',
      loaderClass: 'SanaSprintImg2ImgPipeline',
      format: DIRECT_IMAGE_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-edit-observation.v1',
      consumed: [...baseConsumed, ...imageGeometry, 'guidance_scale', 'strength'],
      fullNativeSnapshot: true,
      strengthVariant: { original: 0.5, retained: 0.75 },
    },
  ],
  [
    'StableDiffusionPipeline:edit_image',
    {
      modelRepo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
      modelRevision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
      loaderClass: 'StableDiffusionImg2ImgPipeline',
      format: DIRECT_IMAGE_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-edit-observation.v1',
      consumed: stableDiffusionEditConsumed,
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      windowsCudaRuntime: true,
      nativePngEvidence: true,
    },
  ],
  [
    'StableDiffusionPipeline:inpaint',
    {
      modelRepo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
      modelRevision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
      loaderClass: 'StableDiffusionInpaintPipeline',
      format: NATIVE_PNG_INPAINT_FORMAT,
      captureFormat: 'modiff.private.direct-image-inpaint-observation.v1',
      consumed: [...stableDiffusionEditConsumed, 'width', 'height'],
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      windowsCudaRuntime: true,
      nativePngEvidence: true,
      masked: true,
    },
  ],
  [
    'StableDiffusionXLPipeline:edit_image',
    {
      modelRepo: 'stabilityai/stable-diffusion-xl-base-1.0',
      modelRevision: '462165984030d82259a11f4367a4eed129e94a7b',
      loaderClass: 'StableDiffusionXLImg2ImgPipeline',
      format: DIRECT_IMAGE_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-edit-observation.v1',
      consumed: stableDiffusionEditConsumed,
      fullOrLateNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      nativePngEvidence: true,
      savedNativeRecipe: {
        ...retainedImageEdit,
        consumed: stableDiffusionEditConsumed,
        outputGeometryFromSettings: false,
        samplerSourceProjection: true,
        sourceFingerprint: 'sha256:backend-source-v1:2faeaaa03b7902a03df5cd0cea38129b7419f6d844125c0ca7e29ccfaf635290',
        originalRegistryHash: 'fd66c8907b4a7969c1a87757f4d9e629d62395c55b8b74f730432cf1ce47d13e',
        windowsCudaRuntime: true,
        fullNativeSnapshot: true,
        previousExpertFamily: 'StableDiffusionXLPAGImg2ImgPipeline',
      },
    },
  ],
  [
    'StableDiffusionXLPipeline:inpaint',
    {
      modelRepo: 'stabilityai/stable-diffusion-xl-base-1.0',
      modelRevision: '462165984030d82259a11f4367a4eed129e94a7b',
      loaderClass: 'StableDiffusionXLInpaintPipeline',
      format: NATIVE_PNG_INPAINT_FORMAT,
      captureFormat: 'modiff.private.direct-image-inpaint-observation.v1',
      consumed: [...stableDiffusionEditConsumed, 'width', 'height'],
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      windowsCudaRuntime: true,
      nativePngEvidence: true,
      masked: true,
      strengthVariant: { original: 0.8, retained: 1 },
    },
  ],
  [
    'ChromaInpaintPipeline:inpaint',
    {
      modelRepo: 'lodestones/Chroma1-HD',
      modelRevision: '0e0c60ece1e82b17cb7f77342d765ba5024c40c0',
      loaderClass: 'ChromaInpaintPipeline',
      format: SAVED_PNG_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-inpaint-observation.v1',
      consumed: [...stableDiffusionEditConsumed, ...imageGeometry],
      sourceFingerprint: 'sha256:backend-source-v1:43f2ed10792fc6167b963166287cf7d5a0429afa26029e6455b0418e2123be86',
      runtimeContractDigest: '8cbe038eeeb6d4a4c079783b8d7e4915d9f78faad9495cb8e354504c66925cf5',
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      masked: true,
    },
  ],
  [
    'StableDiffusionXLInstructPix2PixPipeline:edit_image',
    {
      modelRepo: 'diffusers/sdxl-instructpix2pix-768',
      modelRevision: '06653d47f8d22f2c2205a5884d6a24c5e76d2ca7',
      loaderClass: 'StableDiffusionXLInstructPix2PixPipeline',
      format: SAVED_PNG_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-edit-observation.v1',
      consumed: [...baseConsumed, 'negative_prompt', 'guidance_scale', 'width', 'height'],
      inactiveRecorded: ['strength', 'max_sequence_length'],
      sourceFingerprint: 'sha256:backend-source-v1:55da4a68212923ee8a67e70754f46193288e210bce08ab4ae8c06834a7a76995',
      runtimeContractDigest: 'e5d045d5ecf997c0cfe8dba771fd92cfc1fef6d3e10d91791b2b5e747f384b3c',
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      windowsCudaRuntime: true,
      residentRecipe: true,
      unobservedControls: ['image_guidance_scale'],
    },
  ],
  [
    'StableDiffusionPAGPipeline:edit_image',
    {
      modelRepo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
      modelRevision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
      loaderClass: 'StableDiffusionPAGImg2ImgPipeline',
      format: SAVED_PNG_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-edit-observation.v1',
      consumed: stableDiffusionEditConsumed,
      inactiveRecorded: ['width', 'height', 'max_sequence_length'],
      sourceFingerprint: 'sha256:backend-source-v1:3b073e3f6f5e9489e06116f277ee4a9e878b8f0c6258efc93c60be9a04513cb5',
      runtimeContractDigest: 'e5d045d5ecf997c0cfe8dba771fd92cfc1fef6d3e10d91791b2b5e747f384b3c',
      windowsCudaRuntime: true,
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      unobservedControls: ['pag_scale', 'pag_adaptive_scale'],
      nativeSourceMedia: true,
    },
  ],
  [
    'StableDiffusionPAGPipeline:inpaint',
    {
      modelRepo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
      modelRevision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
      loaderClass: 'StableDiffusionPAGInpaintPipeline',
      format: SAVED_PNG_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-inpaint-observation.v1',
      consumed: [...stableDiffusionEditConsumed, 'width', 'height'],
      inactiveRecorded: ['max_sequence_length'],
      sourceFingerprint: 'sha256:backend-source-v1:1f2f7e00ce4a500ba52d5b729f43d4321af6f931125a3f266f307cf80038c12e',
      runtimeContractDigest: 'e5d045d5ecf997c0cfe8dba771fd92cfc1fef6d3e10d91791b2b5e747f384b3c',
      windowsCudaRuntime: true,
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      unobservedControls: ['pag_scale', 'pag_adaptive_scale'],
      nativeSourceMedia: true,
      masked: true,
    },
  ],
  [
    'ZImageModularPipeline:edit_image',
    {
      modelRepo: 'Tongyi-MAI/Z-Image-Turbo',
      modelRevision: 'f332072aa78be7aecdf3ee76d5c247082da564a6',
      loaderClass: 'ZImageImg2ImgPipeline',
      format: SAVED_PNG_EDIT_FORMAT,
      captureFormat: 'modiff.private.direct-image-edit-observation.v1',
      consumed: [...stableDiffusionEditConsumed, ...imageGeometry],
      sourceFingerprint: 'sha256:backend-source-v1:e3aea8f8d102572ad10fdd0700f0c42d92061e864ede89777efcd6a3269770a8',
      runtimeContractDigest: '8cbe038eeeb6d4a4c079783b8d7e4915d9f78faad9495cb8e354504c66925cf5',
      fullNativeSnapshot: true,
      inputPathPrefix: '@data/images/',
      nativeSourceMedia: true,
      outputGeometryFromSettings: true,
    },
  ],
  [
    'JoyImageEditPlusPipeline:edit_image',
    {
      ...joyPlusEdit,
      fullNativeSnapshot: true,
      sourceFingerprint: 'sha256:backend-source-v1:d275bc94517015b221a9a8b5aea7572ec68c491060855c7895526e1ba640796d',
      originalRegistryHash: '6167f8ae8f746e854b73dfcb66000a54c71d65199c1f4b0b081b7a9ce02d9d28',
    },
  ],
  [
    'JoyImageEditPlusPipeline:multi_image_reference_edit',
    {
      ...joyPlusEdit,
      task: 'multi_image_reference_edit',
      retainedFormMode: 'edit_image',
      orderedReferences: 1,
      sourceFingerprint: 'sha256:backend-source-v1:585997dc1146ec6effb20c260272babc01713ecdea4f78a0872c12ef2568ef83',
      runtimeContractDigest: '8cbe038eeeb6d4a4c079783b8d7e4915d9f78faad9495cb8e354504c66925cf5',
    },
  ],
  [
    'JoyImageEditPipeline:edit_image',
    {
      ...retainedImageEdit,
      format: SAVED_HOST_FILE_EDIT_FORMAT,
      modelRepo: 'jdopensource/JoyAI-Image-Edit-Diffusers',
      modelRevision: '4b41fb25d961f37668750178ccbb380da326201c',
      loaderClass: 'JoyImageEditPipeline',
      sourceFingerprint: 'sha256:backend-source-v1:585997dc1146ec6effb20c260272babc01713ecdea4f78a0872c12ef2568ef83',
      runtimeContractDigest: qwenPlusEdit.runtimeContractDigest,
      fullNativeSnapshot: true,
    },
  ],
  ['QwenImageEditPlusPipeline:edit_image', qwenPlusEdit],
  [
    'QwenImageEditPipeline:edit_image',
    {
      ...qwenPlusEdit,
      modelRepo: 'Qwen/Qwen-Image-Edit',
      modelRevision: 'ac7f9318f633fc4b5778c59367c8128225f1e3de',
      loaderClass: 'QwenImageEditPipeline',
    },
  ],
  [
    'QwenImageEditPlusPipeline:multi_image_reference_edit',
    {
      ...qwenPlusEdit,
      task: 'multi_image_reference_edit',
      retainedFormMode: 'edit_image',
      orderedReferences: 1,
    },
  ],
  [
    'QwenImageModularPipeline:inpaint',
    {
      ...retainedCfgInpaint,
      modelRepo: 'Qwen/Qwen-Image-2512',
      modelRevision: '25468b98e3276ca6700de15c6628e51b7de54a26',
      loaderClass: 'QwenImageInpaintPipeline',
    },
  ],
  [
    'FluxDevPipeline:inpaint',
    {
      ...retainedCfgInpaint,
      modelRepo: 'black-forest-labs/FLUX.1-dev',
      modelRevision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
      loaderClass: 'FluxInpaintPipeline',
    },
  ],
]);
const lcmRoute = editRoutes.get('LatentConsistencyModelPipeline:edit_image');

const ownerOrder = [
  ['quantization', 'modules.DiffusersRuntime', 'PipelineQuantizationConfigV2'],
  ['recipe', 'modules.DiffusersRuntime', 'DiffusersExecutionRecipe'],
  ['loader', 'modules.DiffusersImage', 'LoadPipeline'],
  ['source', 'modules.Image', 'Load'],
  ['edit', 'modules.DiffusersImage', 'Edit'],
  ['preview', 'modules.Image', 'Preview'],
];
const inpaintOwners = [
  ...ownerOrder.slice(0, 4),
  ['mask', 'modules.Image', 'Load'],
  ['edit', 'modules.DiffusersImage', 'Inpaint'],
  ownerOrder.at(-1),
];
const outpaintOwners = [
  ...ownerOrder.slice(0, 4),
  ['canvas', 'modules.DiffusersImage', 'OutpaintCanvas'],
  ...inpaintOwners.slice(-2),
];
const editableFields = [
  ...baseConsumed,
  ...imageGeometry,
  'cfg_normalize',
  'control_guidance_end',
  'control_guidance_start',
  'guidance_scale',
  'image_guidance_scale',
  'layers',
  'negative_prompt',
  'padding_mask_crop',
  'pag_adaptive_scale',
  'pag_scale',
  'reference_strength',
  'resolution',
  'strength',
  'use_en_prompt',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const literal = (value) => ({ value, source: 'literal' });
const same = (a, b, message) => assert.equal(stableStringify(a), stableStringify(b), message);
const keys = (row, expected) =>
  same(Object.keys(row ?? {}).sort(), [...expected].sort(), 'Unexpected evidence fields.');

function directOwners(api, hinted = false, masked = false, outpaint = false) {
  keys(api, ['sid', 'nodes', 'paths', ...(hinted ? ['runtimeHints'] : [])]);
  const owners = outpaint ? outpaintOwners : masked ? inpaintOwners : ownerOrder;
  assert.equal(Object.keys(api.nodes).length, owners.length);
  assert.equal(api.paths.length, 1);
  const route = api.paths[0];
  assert.equal(route.length, owners.length);
  assert.equal(new Set(route).size, owners.length);
  return Object.fromEntries(
    owners.map(([role, module, action], index) => {
      const id = route[index];
      const node = api.nodes[id];
      keys(node, ['module', 'action', 'params']);
      assert.equal(node.module, module);
      assert.equal(node.action, action);
      return [role, { id, node }];
    }),
  );
}

export function bindPrivateImageEditGraph({
  expected,
  submitted,
  input,
  maskInput,
  references = [],
  strengthVariant,
  guidanceVariant,
  canvasVariant,
  inputPathPrefix = '',
  nativePngEvidence = false,
  residentRecipe = false,
  cpuExecution = false,
}) {
  const bound = structuredClone(expected);
  const masked = maskInput !== undefined;
  const canonical = directOwners(bound, false, masked, Boolean(canvasVariant));
  const observed = directOwners(submitted, Object.hasOwn(submitted, 'runtimeHints'), masked, Boolean(canvasVariant));
  const canonicalPrompt = canonical.edit.node.params.prompt;
  assert.equal(canonicalPrompt.value, '');
  const safeBasename = nativePngEvidence ? /^[a-zA-Z0-9_-][\w.-]{0,200}\.png$/u : /^[a-zA-Z0-9_-][\w.-]{0,200}\.webp$/u;
  const bindFile = (role, selected) => {
    const field = canonical[role].node.params.file;
    assert.deepEqual(field, { value: role === 'mask' ? '' : [], display: 'filebrowser' });
    field.value = selected.map((reference) => {
      assert.equal(reference.nodeId, observed[role].id);
      assert.equal(reference.field, 'file');
      assert.ok(typeof reference.sourceValue === 'string' && reference.sourceValue.startsWith(inputPathPrefix));
      assert.match(
        reference.sourceValue.slice(inputPathPrefix.length),
        role === 'mask' ? /^[a-zA-Z0-9_-][\w.-]{0,200}\.png$/u : safeBasename,
      );
      return reference.sourceValue;
    });
  };
  bindFile('source', [input, ...references]);
  if (masked) bindFile('mask', [maskInput]);
  const prompt = observed.edit.node.params.prompt.value;
  assert.ok(typeof prompt === 'string' && prompt.length > 0 && prompt.length <= 4096 && prompt.trim() === prompt);
  assert.ok(!/[\u0000-\u001f\u007f]/u.test(prompt));
  canonicalPrompt.value = prompt;
  if (cpuExecution) bindRetainedCpuFloat32Recipe(canonical);
  if (strengthVariant) {
    assert.equal(canonical.edit.node.params.strength.value, strengthVariant.original);
    canonical.edit.node.params.strength.value = strengthVariant.retained;
  }
  if (guidanceVariant) {
    assert.equal(canonical.edit.node.params.guidance_scale.value, guidanceVariant.original);
    canonical.edit.node.params.guidance_scale.value = guidanceVariant.retained;
  }
  for (const [field, original, retained] of canvasVariant ?? []) {
    const setting = canonical.canvas.node.params[field];
    same(setting, { value: original });
    setting.value = retained;
  }
  if (residentRecipe) {
    const offload = canonical.recipe.node.params.offload_mode;
    same(offload, { value: 'model_cpu' });
    offload.value = 'none';
  }
  const identity = canonicalGraphIdentity(bound);
  same(
    canonicalGraphIdentity(submitted),
    identity,
    'Submitted edit differs outside its declared file, prompt and reviewed control variant.',
  );
  return { ...observed, prompt, identity };
}

export function validatePrivateImageEditFields(bound, output, consumed = lcmRoute.consumed) {
  const accounting = output.resolvedExecutionInputs;
  for (const field of ['unavailableFields', 'uncapturedNodeIds']) same(accounting[field], []);
  // The legacy flat summary combines the GPU loader/recipe and the inactive
  // CPU preview selector. Only its exact, independently scoped causes are safe.
  // Source and mask also each publish their own exact decoded image facts.
  same(
    accounting.ambiguousFields,
    bound.mask ? ['device', 'imageAlphaChannel', 'imageSourceHashes', 'imageSourceModes'] : ['device'],
  );
  const roles = (bound.mask ? inpaintOwners : ownerOrder).map(([role]) => bound[role]);
  same(accounting.nodes.map(({ nodeId }) => nodeId).sort(), roles.map(({ id }) => id).sort());
  for (const { id, node } of roles) {
    const observed = accounting.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(observed.module, node.module);
    assert.equal(observed.action, node.action);
    same(observed.omittedFields, {});
  }
  for (const [role, value, flags] of [
    ['recipe', 'cuda:0', { disposition: 'consumed' }],
    ['loader', 'cuda:0', { disposition: 'superseded', reason: 'connected-recipe' }],
    ['preview', 'cpu:0', { disposition: 'inactive', reason: 'already-decoded-image' }],
  ]) {
    const { id, node } = bound[role];
    const observed = accounting.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(node.params.device.value, value);
    same(observed.fields.device, { value, source: 'literal' });
    same(observed.fieldAccounting.fields.device, { ...flags, inputValue: value, value, source: 'literal' });
  }
  const { fields, complete, inputProjections, outputProjections, unaccountedFields, omittedFields } =
    accounting.nodes.find(({ nodeId }) => nodeId === bound.edit.id).fieldAccounting;
  assert.equal(complete, true);
  same(unaccountedFields, []);
  same(omittedFields, {});
  keys(inputProjections, bound.mask ? ['image', 'mask_image'] : ['image']);
  keys(outputProjections, []);
  const params = bound.edit.node.params;
  const metadata = 'image_contract';
  const known = [...editableFields, metadata];
  keys(fields, known);
  keys(params, [...known, 'image', 'pipeline', ...(bound.mask ? ['mask_image'] : [])]);
  for (const field of known) {
    const value = params[field].value;
    assert.notEqual(value, undefined);
    const expected =
      field === metadata
        ? {
            disposition: 'metadata',
            reason: 'presentation-contract',
            sha256: sha256(`image-contract-v1\n${JSON.stringify(stableJsonValue(value))}`),
          }
        : {
            ...(consumed.includes(field)
              ? { disposition: 'consumed' }
              : { disposition: 'inactive', reason: 'adapter-inactive' }),
            inputValue: value,
            value,
          };
    same(fields[field], { ...expected, source: 'literal' }, `Native Edit field differs: ${field}.`);
  }
  return fields;
}

async function verifySourceBinding(clientRoot, bound, output, input, route) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: clientRoot,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  try {
    const { verifyImageEditSourceBinding, verifyImageInpaintSourceBinding } = await server.ssrLoadModule(
      '/scripts/image-edit-source-binding.mjs',
    );
    const receipt = output.resolvedExecutionInputs;
    if (bound.mask) {
      const { source, mask } = verifyImageInpaintSourceBinding({
        submittedApi: output.apiGraphSnapshot,
        receipt,
        outputIdentity: output,
        sourceId: bound.source.id,
        maskId: bound.mask.id,
        inpaintId: bound.edit.id,
        expectedOwner: route,
      });
      assert.equal(source.sourceFile.sha256, input.file.sha256);
      assert.equal(source.sourceFile.byteSize, input.file.bytes);
      return { decodedInput: source.decodedImage, mask };
    }
    const joined = verifyImageEditSourceBinding({
      submittedApi: output.apiGraphSnapshot,
      receipt,
      outputIdentity: output,
      loadId: bound.source.id,
      editId: bound.edit.id,
    });
    assert.equal(joined.sourceFile.sha256, input.file.sha256);
    assert.equal(joined.sourceFile.byteSize, input.file.bytes);
    return { decodedInput: joined.decodedImage };
  } finally {
    await server.close();
  }
}

function reviewedEditRoute(workflowId, format) {
  const route = editRoutes.get(workflowId);
  assert.ok(route, 'Unknown private image-edit evidence route.');
  const saved = route.savedNativeRecipe;
  return saved && saved.format === format ? { ...route, ...saved } : route;
}

export function validatePrivateImageEditRuntimePlatform(workflowId, platform, backend, format) {
  const route = reviewedEditRoute(workflowId, format);
  if (route.windowsCudaRuntime && /^Windows-/iu.test(platform)) {
    assert.equal(backend, 'cuda');
  } else {
    assert.match(platform, /Linux/iu);
    assert.equal(backend, 'rocm');
  }
}

function verifySavedEditControls(bound, output, route) {
  const receipt = output.resolvedExecutionInputs;
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.source, 'backend-execution');
  assert.equal(receipt.taskId, output.taskId);
  assert.equal(receipt.nodeId, bound.preview.id);
  assert.equal(receipt.attemptIndex, 0);
  assert.equal(receipt.truncated, false);
  same(receipt.unavailableFields, []);
  same(receipt.uncapturedNodeIds, []);
  const ambiguous = bound.mask ? ['device', 'imageAlphaChannel', 'imageSourceHashes', 'imageSourceModes'] : ['device'];
  same(receipt.ambiguousFields, route.cpuExecution ? [] : route.residentRecipe ? ['offloadMode'] : ambiguous);
  const owners = (bound.canvas ? outpaintOwners : bound.mask ? inpaintOwners : ownerOrder).map(([role]) => bound[role]);
  same(receipt.nodes.map(({ nodeId }) => nodeId).sort(), owners.map(({ id }) => id).sort());
  const record = ({ id, node }) => {
    const row = receipt.nodes.find(({ nodeId }) => nodeId === id);
    assert.equal(row.module, node.module);
    assert.equal(row.action, node.action);
    same(row.omittedFields, {});
    return row;
  };
  const sampler = record(bound.edit);
  assert.equal(sampler.fieldAccounting, undefined);
  const controls = Object.fromEntries(
    route.consumed.map((name) => [name, literal(bound.edit.node.params[name].value)]),
  );
  if (route.guidanceObservedAsTrueCfg) {
    controls.true_cfg_scale = controls.guidance_scale;
    controls.guidance_scale = literal(null);
  }
  if (route.inputImagePromptPrefix) {
    assert.ok(['<img>', '</img>', '<|image_'].every((token) => !bound.prompt.includes(token)));
    controls.prompt = literal(route.inputImagePromptPrefix + bound.prompt);
  }
  for (const field of [
    'conditioning_scale',
    'control_guidance_start',
    'control_guidance_end',
    ...(route.inactiveRecorded ?? []),
  ]) {
    controls[field] = literal(null);
  }
  controls.executed_task = literal(route.task ?? (bound.mask ? 'inpaint' : 'edit_image'));
  same(sampler.fields, controls, 'Saved sampler controls differ.');
  const loader = record(bound.loader);
  for (const [field, value] of Object.entries({
    model_id: route.modelRepo,
    revision: route.modelRevision,
    pipeline_class: route.loaderClass,
    mode: controls.executed_task.value,
  }))
    same(loader.fields[field], literal(value));
  const recipe = record(bound.recipe);
  const offload = bound.recipe.node.params.offload_mode.value;
  const connected = bound.loader.node.params.execution_recipe;
  same(connected, { display: 'input', sourceId: bound.recipe.id, sourceKey: 'execution_recipe' });
  same(recipe.fields.offload_mode, literal(offload));
  assert.equal(recipe.fieldAccounting.fields.offload_mode.disposition, 'consumed');
  assert.equal(loader.fieldAccounting.fields.offload_mode.disposition, 'superseded');
  assert.equal(loader.fieldAccounting.fields.offload_mode.reason, 'connected-recipe');
  if (route.cpuExecution) {
    same(recipe.fields.device, literal('cpu:0'));
    same(loader.fields.device, literal('cpu:0'));
    same(loader.fields.dtype, literal('float32'));
    same(loader.fields.auto_offload, literal(false));
    assert.equal(offload, 'none');
  }
  return record;
}

async function verifySavedImageSource(bound, output, { input, maskInput, references }, route, read, json, evidence) {
  const record = verifySavedEditControls(bound, output, route);
  const { decodedMediaHash } = await import('./template-gallery-harness.mjs');
  const hostFileWitness = route.format === SAVED_HOST_FILE_EDIT_FORMAT;
  const verify = async (role, selected, uploads, port, mode) => {
    const owner = bound[role];
    assert.equal(uploads.length, selected.length);
    const images = await Promise.all(
      selected.map(async (entry, index) => {
        const { bytes, file } = read(entry.file);
        const { width, height } = await decodedMediaHash(file, 'image');
        const decodedImage = { width, height, mode };
        if (hostFileWitness) {
          assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'The saved host source is not PNG.');
        } else {
          verifyRetainedImageUpload(
            json(uploads[index]),
            entry,
            decodedImage,
            bytes,
            role !== 'mask' && isNativeWebpEdit(route.format) ? 'webp' : 'png',
          );
        }
        return decodedImage;
      }),
    );
    const row = record(owner);
    same(
      row.fields,
      {
        alpha_channel: literal(owner.node.params.alpha_channel.value),
        source_hashes: literal(selected.map(({ file }) => file.sha256)),
        source_widths: literal(images.map(({ width }) => width)),
        source_heights: literal(images.map(({ height }) => height)),
        source_modes: literal(images.map(({ mode }) => mode)),
      },
      `Original ${role} load differs.`,
    );
    const destination = bound.canvas ?? bound.edit;
    same(destination.node.params[port], { display: 'input', sourceId: owner.id, sourceKey: 'image' });
    if (!route.nativeSourceMedia) return images;
    const nativeImages = verifyNativeLoadedImages(
      owner.node,
      row,
      images.map(({ mode }) => mode),
    );
    return nativeImages.map(({ sourceFile, decodedImage }, index) => {
      const entry = selected[index];
      const { width, height } = images[index];
      same(sourceFile, {
        sourceValue: entry.sourceValue,
        sha256: entry.file.sha256,
        byteSize: entry.file.bytes,
      });
      same([decodedImage.width, decodedImage.height], [width, height]);
      return decodedImage;
    });
  };
  const [decodedInput, ...decodedReferences] = await verify(
    'source',
    [input, ...references],
    [evidence.inputUpload, ...(evidence.referenceUploads ?? [])],
    'image',
    'RGB',
  );
  if (bound.canvas) {
    const { params } = bound.canvas.node;
    const width = decodedInput.width + params.left.value + params.right.value;
    const height = decodedInput.height + params.top.value + params.bottom.value;
    same([width, height], [params.width.value, params.height.value]);
    same([width, height], [bound.edit.node.params.width.value, bound.edit.node.params.height.value]);
    same(record(bound.canvas).fields, { width: literal(width), height: literal(height) });
    for (const [port, sourceKey] of [
      ['image', 'canvas'],
      ['mask_image', 'mask_image'],
    ]) {
      same(bound.edit.node.params[port], { display: 'input', sourceId: bound.canvas.id, sourceKey });
    }
  }
  if (!maskInput) return { decodedInput, decodedReferences };
  assert.notEqual(input.file.sha256, maskInput.file.sha256);
  const [decodedMask] = await verify('mask', [maskInput], [evidence.maskUpload], 'mask_image', 'L');
  same([decodedInput.width, decodedInput.height], [decodedMask.width, decodedMask.height]);
  return { decodedInput, mask: { decodedImage: decodedMask } };
}

function validateRuntime(
  task,
  hints,
  completion,
  observation,
  bound,
  workflowId,
  { modelRepo, modelRevision, loaderClass, cpuExecution, format },
) {
  same(
    completion.runtimeHints,
    {
      ...hints,
      controlledArtifacts: [],
      loaderContract: ['modules.DiffusersImage.LoadPipeline'],
    },
    'Native completion runtime envelope differs.',
  );
  const runtime = selectBackendRuntimeFingerprintEvidence([task.runtimeFingerprint]);
  validatePrivateImageEditRuntimePlatform(
    workflowId,
    runtime.packages.platform,
    task.runtimeMeasurement.backend,
    format,
  );
  assert.equal(runtime.torch.cuda_available, true);
  assert.equal(task.runtimeMeasurement.device, 'cuda:0');
  const { elapsedSeconds, peakAllocatedBytes, peakReservedBytes, peakMeasurementVersion } = task.runtimeMeasurement;
  assert.equal(peakMeasurementVersion, 2);
  assert.ok(Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 && elapsedSeconds <= 7200);
  assert.ok(
    Number.isSafeInteger(peakAllocatedBytes) && (cpuExecution ? peakAllocatedBytes === 0 : peakAllocatedBytes > 0),
  );
  assert.ok(Number.isSafeInteger(peakReservedBytes) && peakReservedBytes >= peakAllocatedBytes);
  assert.equal(observation.error, false);
  assert.equal(observation.runtimeFingerprint, runtime.fingerprint);
  assert.equal(observation.models.length, 1);
  assert.equal(observation.models[0].complete, true);
  assert.equal(observation.models[0].repairRequired, false);
  const model = selectInstalledModelIdentity(observation, modelRepo);
  assert.equal(model?.selectedRevision, modelRevision);
  assert.equal(model?.modelRevision, `${modelRepo}@${modelRevision}`);
  const loader = bound.loader.node.params;
  same(loader.model_id.value, { source: 'hub', value: modelRepo });
  assert.equal(loader.revision.value, modelRevision);
  assert.equal(loader.pipeline_class.value, loaderClass);
  return { runtime, elapsedSeconds, peakAllocatedBytes };
}

export function verifyRetainedPngUpload(upload, input, decoded, bytes) {
  verifyRetainedImageUpload(upload, input, decoded, bytes, 'png');
}

function verifyRetainedImageUpload(upload, input, decoded, bytes, encoding) {
  const png = encoding === 'png';
  keys(upload, ['error', 'path', 'media']);
  assert.equal(upload.error, false);
  assert.equal(upload.path, input.sourceValue);
  assert.match(
    input.sourceValue,
    png ? /^@data\/images\/[a-zA-Z0-9_-][\w.-]{0,200}\.png$/u : /^@data\/images\/[a-zA-Z0-9_-][\w.-]{0,200}\.webp$/u,
  );
  same(
    upload.media,
    {
      filename: input.sourceValue.split('/').at(-1),
      extension: '.' + encoding,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      kind: 'image',
      mimeType: 'image/' + encoding,
      width: decoded.width,
      height: decoded.height,
      frames: 1,
    },
    `The retained source upload differs from the exact native ${encoding.toUpperCase()} input.`,
  );
  if (png) {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'The retained source is not PNG.');
  } else {
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', 'The retained source is not WebP.');
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', 'The retained source is not WebP.');
    assert.equal(bytes.readUInt32LE(4), bytes.length - 8, 'The retained WebP container size differs.');
  }
}

function isNativeWebpEdit(format) {
  return format === SAVED_WEBP_EDIT_FORMAT || format === FLUX_ENAMEL_EDIT_FORMAT;
}

export async function readPrivateImageEditEvidence({ clientRoot, manifest, graph, authoring, artifact, evidencePath }) {
  const workflowId = manifest.id;
  const { modelRepo, modelRevision, loaderClass } = reviewedEditRoute(workflowId);
  const target = canonicalWorkflowAuthoringContract(manifest, graph, authoring, artifact);
  same(target.modelSet, [{ repoId: modelRepo, revision: modelRevision }], 'Private edit model pin differs.');
  same(target.outputPlan.mediaKinds, ['image']);
  assert.equal(target.outputPlan.minimumAssetCount, 1);
  const stat = lstatSync(evidencePath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 65_536);
  const descriptorBytes = readFileSync(evidencePath);
  const evidence = JSON.parse(descriptorBytes);
  const route = reviewedEditRoute(workflowId, evidence.format);
  const masked = route.masked === true;
  const hostFileWitness = evidence.format === SAVED_HOST_FILE_EDIT_FORMAT && evidence.format === route.format;
  const savedImage =
    hostFileWitness ||
    ((isNativeWebpEdit(route.format) || [SAVED_PNG_EDIT_FORMAT, RETAINED_SERVER_EDIT_FORMAT].includes(route.format)) &&
      evidence.format === route.format);
  const replayedRegistry = savedImage && !route.originalRegistryHash;
  const referenceCount = route.orderedReferences ?? 0;
  const pngFormat = masked ? NATIVE_PNG_INPAINT_FORMAT : NATIVE_PNG_EDIT_FORMAT;
  const nativeUpload = savedImage || (route.nativePngEvidence === true && evidence.format === pngFormat);
  keys(evidence, [
    'schemaVersion',
    'format',
    'workflowId',
    'capture',
    'graphRequest',
    'graphAcknowledgment',
    'persistedOutputs',
    ...(hostFileWitness
      ? ['hostInputFiles']
      : nativeUpload
        ? ['inputUpload']
        : ['inputServerBefore', 'inputServerAfter']),
    ...(masked ? ['maskUpload'] : []),
    ...(replayedRegistry ? ['registryReplay'] : []),
    ...(referenceCount ? ['referenceUploads'] : []),
    ...(route.cpuExecution ? ['resourceSamples', 'worker'] : []),
  ]);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.format, nativeUpload && !savedImage ? pngFormat : route.format);
  assert.equal(evidence.workflowId, workflowId);
  const evidenceRoot = realpathSync(dirname(evidencePath));
  const retainedFiles = [];
  const read = (ref, maximum = 16 * 1024 * 1024) => {
    const physical = readCanonicalEvidenceFile(evidenceRoot, ref, maximum);
    retainedFiles.push({ ...ref, absolutePath: physical.file });
    return physical;
  };
  const json = (ref) => JSON.parse(read(ref).bytes);
  const capture = json(evidence.capture);
  keys(capture, [
    'schemaVersion',
    'format',
    'workflowId',
    'qualificationClaims',
    'creatorPackage',
    ...(route.serverRetainedOutput ? [] : ['outputPackage']),
    'runDetail',
    'nodes',
    'backendSourceBefore',
    'backendSourceAfter',
    'graphCompleted',
    'modelObservations',
    'inputs',
    'outputs',
  ]);
  assert.equal(capture.schemaVersion, 1);
  assert.equal(capture.format, route.captureFormat);
  assert.equal(capture.workflowId, workflowId);
  same(capture.qualificationClaims, { releaseEligible: false, technicalVariant: true });
  assert.equal(capture.inputs.length, masked ? 2 : 1 + referenceCount);
  assert.equal(capture.outputs.length, 1);
  assert.equal(capture.modelObservations.length, 1);
  const [input, ...otherInputs] = capture.inputs;
  const reviewedSourceRecipe = route.reviewedSourceRecipes?.get(input.file?.sha256);
  const maskInput = masked ? otherInputs[0] : undefined;
  const references = masked ? [] : otherInputs;
  if (referenceCount) {
    assert.equal(evidence.referenceUploads.length, referenceCount);
    assert.equal(new Set(capture.inputs.map(({ file }) => file.sha256)).size, capture.inputs.length);
  }
  const [outputRef] = capture.outputs;
  for (const source of capture.inputs) keys(source, ['nodeId', 'field', 'sourceValue', 'file']);
  keys(outputRef, ['backendPath', 'mediaType', 'file']);
  const creator = json(capture.creatorPackage);
  const outputPackage = route.serverRetainedOutput ? undefined : json(capture.outputPackage);
  const run = json(capture.runDetail);
  const graphCompleted = json(capture.graphCompleted);
  const graphRequest = json(evidence.graphRequest);
  const graphAcknowledgment = json(evidence.graphAcknowledgment);
  const store = json(evidence.persistedOutputs);
  if (hostFileWitness) {
    verifyRetainedHostImageFiles(json(evidence.hostInputFiles), {
      taskId: run.task.task_id,
      persistedOutputSha256: evidence.persistedOutputs.sha256,
      inputs: capture.inputs,
    });
  }
  const exactStoredOutputs = store.outputs.filter(({ taskId }) => taskId === run.task.task_id);
  assert.equal(exactStoredOutputs.length, 1, 'The saved output store must contain exactly one result for the task.');
  const [persistedOutput] = exactStoredOutputs;
  const retainedVisual = outputPackage?.latestOutput.graphSnapshot ?? persistedOutput.graphSnapshot;
  const [expected, ...visualExports] = await exportCanonicalWorkflowGraphs(clientRoot, [
    graph,
    creator.graph,
    retainedVisual,
    run.workflow_snapshot,
  ]);
  const bound = bindPrivateImageEditGraph({
    expected,
    submitted: graphRequest,
    input,
    maskInput,
    references,
    strengthVariant: reviewedSourceRecipe?.strengthVariant ?? route.strengthVariant,
    guidanceVariant: route.guidanceVariant,
    canvasVariant: route.canvasVariant,
    inputPathPrefix: route.inputPathPrefix,
    nativePngEvidence: nativeUpload && !isNativeWebpEdit(route.format),
    residentRecipe: route.residentRecipe,
    cpuExecution: route.cpuExecution,
  });
  for (const api of [creator.apiGraph, ...visualExports]) {
    directOwners(api, false, masked, Boolean(route.canvasVariant));
    same(canonicalGraphIdentity(api), bound.identity, 'A saved visual owner graph differs from the original Run.');
  }
  const previousExpertFamily = reviewedSourceRecipe?.previousExpertFamily ?? route.previousExpertFamily;
  const runOptions = {
    target,
    expectedFormMode: route.retainedFormMode,
    outputNodeId: bound.preview.id,
    displayType: 'image',
    creator,
    outputPackage,
    ...(route.serverRetainedOutput ? { retainedServerOutput: persistedOutput } : {}),
    run,
    graphCompleted,
    graphRequest,
    graphAcknowledgment,
    persistedOutput,
    validatePreparation: (preparation) => {
      if (reviewedSourceRecipe) {
        assert.equal(preparation.previousModelFamily, previousExpertFamily);
        assert.equal(preparation.performed, true);
        assert.ok(preparation.cleanup?.released?.models > 0, 'Expected the previous model release for the saved edit.');
      }
      return previousExpertFamily
        ? validateImagePromptPreparation(preparation, { modelType: loaderClass, previousExpertFamily })
        : validateUnmodifiedExpertPreparation(preparation, loaderClass, route.previousUnmodifiedModelFamily);
    },
  };
  const hasNativeSnapshot =
    route.fullNativeSnapshot || (route.fullOrLateNativeSnapshot && run.outputs[0]?.apiGraphSnapshot !== undefined);
  if (hasNativeSnapshot) {
    assert.equal(run.outputs.length, 1);
    same(run.outputs[0], persistedOutput, 'Saved native output differs from the at-close output store.');
  }
  const validateRun =
    hasNativeSnapshot || route.serverRetainedOutput ? validateNativeVariantRun : validateLateNativeImageVariantRun;
  const { task, output, hints } = validateRun(runOptions);
  same(hints.workflowSnapshot.studioForm, output.formSnapshot);
  const alternate =
    savedImage &&
    route.alternateSourceRegistryPair &&
    task.runtimeFingerprint.backendSource?.fingerprint === route.alternateSourceRegistryPair.sourceFingerprint
      ? route.alternateSourceRegistryPair
      : null;
  const sourceProjection = !savedImage || route.samplerSourceProjection === true;
  let sourceBinding;
  if (!sourceProjection) {
    sourceBinding = await verifySavedImageSource(
      bound,
      output,
      { input, maskInput, references },
      alternate ? { ...route, nativeSourceMedia: alternate.nativeSourceMedia } : route,
      read,
      json,
      evidence,
    );
  } else {
    validatePrivateImageEditFields(bound, output, route.consumed);
    sourceBinding = await verifySourceBinding(clientRoot, bound, output, input, route);
    const inputMedia = read(input.file);
    if (nativeUpload) {
      verifyRetainedPngUpload(json(evidence.inputUpload), input, sourceBinding.decodedInput, inputMedia.bytes);
    } else {
      for (const ref of [evidence.inputServerBefore, evidence.inputServerAfter]) {
        assert.ok(read(ref).bytes.equals(inputMedia.bytes), 'The server-bound source bytes differ.');
      }
    }
    if (masked) {
      const maskMedia = read(maskInput.file);
      assert.equal(sourceBinding.mask.sourceFile.sha256, maskInput.file.sha256);
      assert.equal(sourceBinding.mask.sourceFile.byteSize, maskInput.file.bytes);
      verifyRetainedPngUpload(json(evidence.maskUpload), maskInput, sourceBinding.mask.decodedImage, maskMedia.bytes);
    }
  }
  const { decodedInput, decodedReferences, mask } = sourceBinding;
  const media = read(outputRef.file);
  const item = validateNativeVariantOutput({
    output,
    outputRef,
    task,
    bytes: media.bytes,
    displayType: 'image',
    contentType: 'image/webp',
  });
  assert.match(output.id, /^run-output-[a-f0-9]{24}$/u);
  assert.equal(item.backendPath, `@data/studio/outputs/${output.id}_item_00.webp`);
  assert.equal(output.mediaCollectionHash, `sha256:collection:${sha256(JSON.stringify([item.mediaHash]))}`);
  const { decodedMediaHash, technicalMediaErrors } = await import('./template-gallery-harness.mjs');
  const decoded = await decodedMediaHash(media.file, 'image');
  const expectedGeometry = route.outputGeometryFromSettings
    ? { width: bound.edit.node.params.width.value, height: bound.edit.node.params.height.value }
    : { width: decodedInput.width, height: decodedInput.height };
  same(technicalMediaErrors(decoded, expectedGeometry), []);
  assert.equal(item.width, decoded.width);
  assert.equal(item.height, decoded.height);
  const nodes = read(capture.nodes);
  const backendContract = backendContractIdentity(JSON.parse(nodes.bytes), bound.identity.canonicalGraph);
  assert.ok(backendContract.fingerprint);
  const source = backendSourceEvidence({
    before: json(capture.backendSourceBefore).identity,
    after: json(capture.backendSourceAfter).identity,
    runtimeFingerprint: task.runtimeFingerprint,
  });
  same(source.blockers, []);
  if (savedImage) {
    assert.equal(source.identity.fingerprint, alternate?.sourceFingerprint ?? route.sourceFingerprint);
  }
  if (route.originalRegistryHash) {
    assert.equal(
      sha256(nodes.bytes),
      alternate?.registryHash ?? route.originalRegistryHash,
      'The node registry does not match the saved runtime source.',
    );
  }
  if (replayedRegistry) {
    const replay = json(evidence.registryReplay);
    assert.equal(replay.scope, 'Original nodes handler only, with exact source and runtime contract');
    assert.equal(replay.modelRuns, 0);
    assert.equal(replay.fileCount, source.identity.files.length);
    assert.equal(replay.sourceFingerprint, route.sourceFingerprint);
    assert.equal(replay.runtimeContract, route.runtimeContractDigest);
    assert.equal(replay.nodeBytes, nodes.bytes.length);
    assert.equal(replay.nodeHash, sha256(nodes.bytes));
  }
  const { runtime, elapsedSeconds, peakAllocatedBytes } = validateRuntime(
    task,
    hints,
    graphCompleted,
    json(capture.modelObservations[0]),
    bound,
    workflowId,
    route,
  );
  const peakMemoryBytes = route.cpuExecution
    ? validateSampledCpuWorkerMemory(
        read(evidence.resourceSamples, 1024 * 1024).bytes,
        json(evidence.worker),
        source.identity,
        task,
      )
    : peakAllocatedBytes;
  for (const ref of retainedFiles) readCanonicalEvidenceFile(evidenceRoot, ref, 16 * 1024 * 1024);
  assert.ok(readFileSync(evidencePath).equals(descriptorBytes), 'Evidence descriptor changed during validation.');
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.canonical-workflow-run-receipt.v1',
    proofKind: 'real_backend_input_bound_model_variant',
    ...target,
    taskId: task.task_id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    graphHash: bound.identity.hash,
    resourceCandidateId: null,
    outputHash: item.mediaHash,
    runtimeFingerprint: normalizeBackendRuntime(runtime).lockFingerprint,
    backendSourceFingerprint: source.identity.fingerprint,
    backendContractFingerprint: backendContract.fingerprint,
    executionDurationSeconds: elapsedSeconds,
    peakMemoryBytes,
    canonicalDefaultsExecuted: false,
    inputBinding: { nodeId: input.nodeId, field: 'file', sha256: input.file.sha256, decodedImage: decodedInput },
    ...(referenceCount
      ? {
          referenceBindings: references.map((reference, index) => ({
            nodeId: reference.nodeId,
            field: 'file',
            inputIndex: index + 1,
            sha256: reference.file.sha256,
            decodedImage: decodedReferences[index],
          })),
        }
      : {}),
    ...(masked
      ? {
          maskBinding: {
            nodeId: maskInput.nodeId,
            field: 'file',
            sha256: maskInput.file.sha256,
            decodedImage: mask.decodedImage,
          },
        }
      : {}),
    promptBinding: { nodeId: bound.edit.id, field: 'prompt', sha256: sha256(bound.prompt) },
    decodedOutput: { hash: decoded.hash, width: decoded.width, height: decoded.height },
    observationLimits: {
      fullConsumedFieldAccounting: false,
      editConsumerControlsObserved: true,
      sourceGeometryQualified: false,
      ...(nativeUpload
        ? {
            sourceByteWitness: hostFileWitness
              ? 'retained-host-file-with-native-load-and-typed-wire'
              : !sourceProjection
                ? 'native-load-and-upload-with-typed-wire'
                : 'native-load-consumer-and-upload',
          }
        : {}),
      ...(bound.canvas
        ? { canvasSizeObserved: true, canvasPixelsObserved: false, derivedMaskPixelsObserved: false }
        : {}),
      ...((alternate?.nativeSourceMedia ?? route.nativeSourceMedia) === false
        ? { fullSourceDecodeRecordObserved: false }
        : {}),
      ...(masked
        ? { maskByteWitness: savedImage ? 'native-load-and-upload-with-typed-wire' : 'native-load-consumer-and-upload' }
        : {}),
      ...(route.retainedFormMode ? { retainedStudioFormMode: route.retainedFormMode } : {}),
      ...(savedImage
        ? { independentConsumerPixels: sourceProjection, configuredUnobservedControls: route.unobservedControls ?? [] }
        : {}),
      ...(hostFileWitness ? { originalUploadResponseObserved: false } : {}),
      ...(route.cpuExecution ? { executionDevice: 'cpu:0', peakMemorySource: 'sampled-worker-rss' } : {}),
      ...(route.serverRetainedOutput ? { clientApiSnapshotObserved: false, serverOutputStoreMatched: true } : {}),
      ...(route.inputImagePromptPrefix ? { nativeInputMarkerBound: true } : {}),
      physicalPlatformQualification: false,
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
    provenance: { format: 'modiff.input-bound-model-variant-proof.v1', receipt },
    evidence,
    descriptorBytes,
    retainedFiles,
    evidenceRoot,
  };
}
