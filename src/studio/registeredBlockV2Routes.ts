import type {
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryExecutionAdmission,
} from './huggingFaceNodeLibrary';
import { REGISTERED_BLOCK_V2_FANOUT_ROUTES } from './registeredBlockV2FanOutRoutes';
import { REGISTERED_BLOCK_V2_AUDIO_ROUTES } from './registeredBlockV2AudioRoutes';
import { REGISTERED_BLOCK_V2_IMAGE_ROUTES } from './registeredBlockV2ImageRoutes';
import { REGISTERED_BLOCK_V2_ORDINARY_FLUX_ROUTES } from './registeredBlockV2OrdinaryFluxRoutes';

export type RegisteredBlockV2BoundaryInputBinding = Readonly<{
  portId: string;
  /** Catalog input name when the public ID is aliased to avoid a boundary collision. */
  inputName?: string;
  role: string;
  fieldId: string;
  adaptation?: 'media_file_path';
  mediaType?: 'image' | 'video' | 'audio';
}>;

export type RegisteredBlockV2BoundaryOutputBinding = Readonly<{
  portId: string;
  /** Catalog output name when the public ID is aliased to avoid a boundary collision. */
  outputName?: string;
  role: string;
  fieldId: string;
  /**
   * Explicit reviewed projection used only when the catalog and graph media
   * declarations are not directly type-compatible. `direct_media` keeps an
   * upstream decoder-owned media output on the public boundary;
   * `media_file_export` crosses a reviewed export node.
   */
  adaptation?: 'direct_media' | 'media_file_export';
  /** Required only when an upstream tensor/array union becomes a concrete media socket. */
  mediaType?: 'image' | 'video' | 'audio' | 'text' | 'file';
}>;

export type RegisteredBlockV2ControlFanOutBinding = Readonly<{
  role: string;
  fieldId: string;
}>;

export type RegisteredBlockV2ControlFanOut = Readonly<{
  source: string;
  persistence: 'instance_input' | 'execution_parameter';
  primary: RegisteredBlockV2ControlFanOutBinding;
  /** Canonically ordered additional targets for the same logical value. */
  mirrors: readonly RegisteredBlockV2ControlFanOutBinding[];
}>;

export type RegisteredBlockV2Route = Readonly<{
  definitionId: string;
  definitionContentHash: string;
  provider: 'diffusers' | 'transformers';
  surface: 'diffusers_cluster_nodes' | 'transformers_cluster_nodes';
  definitionKind: 'modular_pipeline_workflow' | 'studio_execution_composite';
  libraryRevision: string;
  pipelineClass: string;
  workflowId: string;
  admissionId: string;
  /** Deterministic V2 display/content identity of the exact compiled definition. */
  compiledDefinitionContentHash: string;
  /** Collision-resistant SHA-256 of the canonical compiled definition material. */
  compiledDefinitionCanonicalSha256: string;
  studioMode: string;
  adapterContractId: string;
  studioExecutionSpec: Readonly<{
    id: string;
    contentHash: string;
    executionProfileId: string;
  }>;
  artifact: Readonly<{ repo: string; revision: string }>;
  /**
   * Immutable same-pipeline/same-workflow checkpoints selectable by an
   * ordinary instance control. The registered definition and graph remain
   * unchanged; only the effective artifact changes.
   */
  reviewedArtifacts?: readonly Readonly<{ repo: string; revision: string }>[];
  dynamicFieldActions: readonly Readonly<{
    role: string;
    field: string;
    event: 'onChange' | 'onSignal';
    valueSource: string;
  }>[];
  controlFanOuts?: readonly RegisteredBlockV2ControlFanOut[];
  boundary: Readonly<{
    inputs?: readonly RegisteredBlockV2BoundaryInputBinding[];
    outputs: readonly RegisteredBlockV2BoundaryOutputBinding[];
  }>;
  /**
   * Opt-in contract for projecting the reviewed upstream Modular Diffusers
   * placements as the executable V2 graph. This is declarative route data,
   * never a client-side model-class switch.
   */
  exactModularGraph?: Readonly<{
    semanticRoleByPlacementPath: Readonly<Record<string, string>>;
    controlPlacementPathBySource?: Readonly<Record<string, string>>;
    /**
     * Additional exact upstream leaves that consume the same top-level
     * ModularPipeline argument. The compiler derives canonical V2
     * mirrorBindings from these reviewed placement paths.
     */
    controlMirrorPlacementPathsBySource?: Readonly<Record<string, readonly string[]>>;
  }>;
}>;

const DIFFUSERS_REVISION = 'fbf49e7f35857f76bc57b177e26f12b03687c668';
const MODEL_TYPE_DYNAMIC_FIELD_ACTIONS = [
  { role: 'models', field: 'model_type', event: 'onChange', valueSource: 'pipelineClass' },
] as const;
const STANDARD_MODULAR_DYNAMIC_FIELD_ACTIONS = [
  ...MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
  { role: 'prompt', field: 'text_encoders', event: 'onSignal', valueSource: 'pipelineClass' },
  { role: 'denoise', field: 'unet', event: 'onSignal', valueSource: 'pipelineClass' },
  { role: 'decode', field: 'vae', event: 'onSignal', valueSource: 'pipelineClass' },
] as const;
const NO_DYNAMIC_FIELD_ACTIONS = [] as const;
const IMAGE_OUTPUT = [
  { portId: 'images', role: 'decode', fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' },
] as const;

type DiffusersRouteFields = Omit<
  RegisteredBlockV2Route,
  'provider' | 'surface' | 'definitionKind' | 'libraryRevision' | 'boundary'
> & {
  boundary?: RegisteredBlockV2Route['boundary'];
};

function diffusersRoute(fields: DiffusersRouteFields): RegisteredBlockV2Route {
  const exactModularGraph =
    fields.definitionId.startsWith('diffusers.modular:') &&
    !fields.adapterContractId.includes('equivalent_standard_route')
      ? { semanticRoleByPlacementPath: {} }
      : undefined;
  return {
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'modular_pipeline_workflow',
    libraryRevision: DIFFUSERS_REVISION,
    boundary: { outputs: IMAGE_OUTPUT },
    ...(exactModularGraph ? { exactModularGraph } : {}),
    ...fields,
  };
}

type TransformersRouteFields = Omit<
  RegisteredBlockV2Route,
  'provider' | 'surface' | 'definitionKind' | 'dynamicFieldActions'
>;

function transformersRoute(fields: TransformersRouteFields): RegisteredBlockV2Route {
  return {
    provider: 'transformers',
    surface: 'transformers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    dynamicFieldActions: NO_DYNAMIC_FIELD_ACTIONS,
    ...fields,
  };
}

/**
 * Exact registered admissions that have passed the live atomic compiler.
 *
 * Every entry pins the schema-v6 definition hash, immutable library/model
 * revisions, exact Studio receipt, dynamic-field contract, and explicit
 * public boundary. Helpers above only remove repeated literals; selection is
 * always by definition ID + content hash + admission ID, never model-family or
 * pipeline-class inference.
 */
export const REGISTERED_BLOCK_V2_ROUTES: readonly RegisteredBlockV2Route[] = Object.freeze([
  ...REGISTERED_BLOCK_V2_IMAGE_ROUTES,
  ...REGISTERED_BLOCK_V2_ORDINARY_FLUX_ROUTES,
  ...REGISTERED_BLOCK_V2_AUDIO_ROUTES,
  ...REGISTERED_BLOCK_V2_FANOUT_ROUTES.map((route) => diffusersRoute(route)),
  diffusersRoute({
    definitionId: 'diffusers.modular:AnimaModularPipeline:text2image',
    definitionContentHash: 'sha256:8b912ade28892fd040c0813514eb431efba732b23816204038daa346df5ebc16',
    pipelineClass: 'AnimaModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:AnimaModularPipeline:text2image:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-284b1f93',
    compiledDefinitionCanonicalSha256: 'sha256:5ab9d0f6ea8b1c857d737be86fccb5c742d326c285f8895470d1768c5012f95f',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.modular-adapter:AnimaModularPipeline:text2image:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'anima:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-89e264ee',
      executionProfileId: 'anima:official-modular-workflow',
    },
    artifact: {
      repo: 'circlestone-labs/Anima-Base-v1.0-Diffusers',
      revision: '073c3a9db359c31ad0e8aa268d15775473c2176c',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Cosmos3DistilledModularPipeline:image2video',
    definitionContentHash: 'sha256:7857742482c24d43b2d77323df353fa1b12278f5b837b49d545484ffdbb95658',
    pipelineClass: 'Cosmos3DistilledModularPipeline',
    workflowId: 'image2video',
    admissionId:
      'diffusers.cluster-admission:Cosmos3DistilledModularPipeline:image2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-6f35cb17',
    compiledDefinitionCanonicalSha256: 'sha256:46cd6f89bab6b5835fcfd5a0a03d4c04bce7b8d6ff2b983ee7b7d5f1925db03f',
    studioMode: 'image_to_video',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3DistilledModularPipeline:image2video:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-distilled:modular-image-to-video:v1',
      contentHash: 'studio-spec-v1-1789279a',
      executionProfileId: 'cosmos3-distilled-image-to-video:official-modular-workflow',
    },
    artifact: {
      repo: 'nvidia/Cosmos3-Super-Image2Video-4Step',
      revision: 'cd55ce81bc5cea51a09c37cd7652144e7278f049',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    controlFanOuts: [
      {
        source: 'fps',
        persistence: 'execution_parameter',
        primary: { role: 'prompt', fieldId: 'fps' },
        mirrors: [{ role: 'videoExport', fieldId: 'fps' }],
      },
    ],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'num_frames_input', inputName: 'num_frames', role: 'prompt', fieldId: 'num_frames' },
        { portId: 'height_input', inputName: 'height', role: 'prompt', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'prompt', fieldId: 'width' },
        { portId: 'image', role: 'loadImage', fieldId: 'file' },
      ],
      outputs: [
        {
          portId: 'videos',
          role: 'videoExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'video',
        },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Cosmos3DistilledModularPipeline:text2image',
    definitionContentHash: 'sha256:4409aa4211d08f3ef9b077e625c7a4d7a1b9c5db9613280ec052b843df65f86e',
    pipelineClass: 'Cosmos3DistilledModularPipeline',
    workflowId: 'text2image',
    admissionId:
      'diffusers.cluster-admission:Cosmos3DistilledModularPipeline:text2image:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-1606ba66',
    compiledDefinitionCanonicalSha256: 'sha256:de23166153b883e72424fb202e8db9d84880ee50a279b41cdde0f1e1ce756d96',
    studioMode: 'text_to_image',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3DistilledModularPipeline:text2image:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-distilled:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-c43f824b',
      executionProfileId: 'cosmos3-distilled-text-to-image:official-modular-workflow',
    },
    artifact: {
      repo: 'nvidia/Cosmos3-Super-Text2Image-4Step',
      revision: 'aa0d5a57b7b045d68daa60fbacd84ec723c7cb7b',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    controlFanOuts: [],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'height_input', inputName: 'height', role: 'prompt', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'prompt', fieldId: 'width' },
      ],
      outputs: [
        {
          portId: 'images',
          outputName: 'videos',
          role: 'decode',
          fieldId: 'image',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Cosmos3OmniModularPipeline:text2image',
    definitionContentHash: 'sha256:a02f4ed18fb79aa0ddb0638271da60da6f30e3349d1a456a962fc669497f6896',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2image:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-e876e626',
    compiledDefinitionCanonicalSha256: 'sha256:215003e7562f3034968b18646a813e983e635230e775ae5bf58ecb55cbe0fa7f',
    studioMode: 'text_to_image',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3OmniModularPipeline:text2image:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-nano:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-590066ce',
      executionProfileId: 'cosmos3-nano:official-modular-workflow',
    },
    artifact: {
      repo: 'nvidia/Cosmos3-Nano',
      revision: '7a312c868bcce8e40b3eb40861300a9d0ba3fde1',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'negative_prompt', role: 'prompt', fieldId: 'negative_prompt' },
        { portId: 'height_input', inputName: 'height', role: 'prompt', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'prompt', fieldId: 'width' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
      ],
      outputs: [
        {
          portId: 'images',
          outputName: 'videos',
          role: 'decode',
          fieldId: 'image',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Cosmos3OmniModularPipeline:text2video',
    definitionContentHash: 'sha256:96567aeb09464cf1954dc9a7bb27cbb85dcb86c66c786edcf3704de87936d395',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'text2video',
    admissionId: 'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-0427e22d',
    compiledDefinitionCanonicalSha256: 'sha256:7fa7f8ad979c893eaed72e40da0aa2d6ec4ae4810c057346a52aafd594dca795',
    studioMode: 'text_to_video',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3OmniModularPipeline:text2video:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-nano:modular-text-to-video:v1',
      contentHash: 'studio-spec-v1-50ecbac9',
      executionProfileId: 'cosmos3-nano:official-modular-workflow',
    },
    artifact: {
      repo: 'nvidia/Cosmos3-Nano',
      revision: '7a312c868bcce8e40b3eb40861300a9d0ba3fde1',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    controlFanOuts: [
      {
        source: 'fps',
        persistence: 'execution_parameter',
        primary: { role: 'prompt', fieldId: 'fps' },
        mirrors: [{ role: 'videoExport', fieldId: 'fps' }],
      },
    ],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'negative_prompt', role: 'prompt', fieldId: 'negative_prompt' },
        { portId: 'num_frames_input', inputName: 'num_frames', role: 'prompt', fieldId: 'num_frames' },
        { portId: 'height_input', inputName: 'height', role: 'prompt', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'prompt', fieldId: 'width' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
      ],
      outputs: [
        { portId: 'videos', role: 'decode', fieldId: 'videos', adaptation: 'direct_media', mediaType: 'video' },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Cosmos3OmniModularPipeline:image2video',
    definitionContentHash: 'sha256:f78db372dd865b906fdb0a7066de65347d1a24d8cff131e59a31bfe7aa205c6e',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'image2video',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:image2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-82c4f911',
    compiledDefinitionCanonicalSha256: 'sha256:73fafe169792cf6d4622c3209921dae27c9d3ea15e735e9b8986d8179a1b42dc',
    studioMode: 'image_to_video',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3OmniModularPipeline:image2video:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-nano:modular-image-to-video:v1',
      contentHash: 'studio-spec-v1-1d30d463',
      executionProfileId: 'cosmos3-nano:official-modular-workflow',
    },
    artifact: {
      repo: 'nvidia/Cosmos3-Nano',
      revision: '7a312c868bcce8e40b3eb40861300a9d0ba3fde1',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    controlFanOuts: [
      {
        source: 'fps',
        persistence: 'execution_parameter',
        primary: { role: 'prompt', fieldId: 'fps' },
        mirrors: [{ role: 'videoExport', fieldId: 'fps' }],
      },
    ],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'negative_prompt', role: 'prompt', fieldId: 'negative_prompt' },
        { portId: 'num_frames_input', inputName: 'num_frames', role: 'prompt', fieldId: 'num_frames' },
        { portId: 'height_input', inputName: 'height', role: 'prompt', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'prompt', fieldId: 'width' },
        { portId: 'image', role: 'loadImage', fieldId: 'file' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
      ],
      outputs: [
        {
          portId: 'videos',
          role: 'videoExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'video',
        },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Cosmos3OmniModularPipeline:image2video_with_sound',
    definitionContentHash: 'sha256:a84afddaea8d2b500578d3631da63da13a5a66d4e5d56b031d064a129dade59c',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'image2video_with_sound',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:image2video_with_sound:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-9ec99676',
    compiledDefinitionCanonicalSha256: 'sha256:32b7c1981c97a0980b2f76d796c5e207505d1f09270816e3a3cdd0bbde335e18',
    studioMode: 'image_to_video_with_audio',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3OmniModularPipeline:image2video_with_sound:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-nano:modular-image-to-video-with-audio:v1',
      contentHash: 'studio-spec-v1-65819510',
      executionProfileId: 'cosmos3-nano:official-modular-workflow',
    },
    artifact: {
      repo: 'nvidia/Cosmos3-Nano',
      revision: '7a312c868bcce8e40b3eb40861300a9d0ba3fde1',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    controlFanOuts: [
      {
        source: 'fps',
        persistence: 'execution_parameter',
        primary: { role: 'prompt', fieldId: 'fps' },
        mirrors: [{ role: 'videoExport', fieldId: 'fps' }],
      },
    ],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'negative_prompt', role: 'prompt', fieldId: 'negative_prompt' },
        { portId: 'num_frames_input', inputName: 'num_frames', role: 'prompt', fieldId: 'num_frames' },
        { portId: 'height_input', inputName: 'height', role: 'prompt', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'prompt', fieldId: 'width' },
        { portId: 'image', role: 'loadImage', fieldId: 'file' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
      ],
      outputs: [
        {
          portId: 'videos',
          role: 'videoExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'video',
        },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Cosmos3OmniModularPipeline:text2video_with_sound',
    definitionContentHash: 'sha256:4db805bbc53fee04ec30dcdcb4c5071c3382b8e8f74ef70633f2ba207c10d791',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'text2video_with_sound',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2video_with_sound:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-122d1f28',
    compiledDefinitionCanonicalSha256: 'sha256:03639f23d27be0c1bd3b68e55da2468fd9b99b7d3f10e92b9860dbaabfaf5736',
    studioMode: 'text_to_video_with_audio',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3OmniModularPipeline:text2video_with_sound:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-nano:modular-text-to-video-with-audio:v1',
      contentHash: 'studio-spec-v1-eadd0b6a',
      executionProfileId: 'cosmos3-nano:official-modular-workflow',
    },
    artifact: {
      repo: 'nvidia/Cosmos3-Nano',
      revision: '7a312c868bcce8e40b3eb40861300a9d0ba3fde1',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    controlFanOuts: [
      {
        source: 'fps',
        persistence: 'execution_parameter',
        primary: { role: 'prompt', fieldId: 'fps' },
        mirrors: [{ role: 'videoExport', fieldId: 'fps' }],
      },
    ],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'negative_prompt', role: 'prompt', fieldId: 'negative_prompt' },
        { portId: 'num_frames_input', inputName: 'num_frames', role: 'prompt', fieldId: 'num_frames' },
        { portId: 'height_input', inputName: 'height', role: 'prompt', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'prompt', fieldId: 'width' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
      ],
      outputs: [
        {
          portId: 'videos',
          role: 'videoExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'video',
        },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Cosmos3OmniModularPipeline:video2video',
    definitionContentHash: 'sha256:c9c1f6f35c193e0ddbe5ffa157d2c6eee1e524a9bf0db84f3c86f09d38380237',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'video2video',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:video2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-a538d013',
    compiledDefinitionCanonicalSha256: 'sha256:247c30b3c8cf8b9bcb670bebc1be69f90d4982d12ac2205ac35d16beefdaa70a',
    studioMode: 'video_to_video',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3OmniModularPipeline:video2video:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-nano:modular-video-to-video:v1',
      contentHash: 'studio-spec-v1-41e53ca8',
      executionProfileId: 'cosmos3-nano:official-modular-workflow',
    },
    artifact: {
      repo: 'nvidia/Cosmos3-Nano',
      revision: '7a312c868bcce8e40b3eb40861300a9d0ba3fde1',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    controlFanOuts: [
      {
        source: 'fps',
        persistence: 'execution_parameter',
        primary: { role: 'prompt', fieldId: 'fps' },
        mirrors: [{ role: 'videoExport', fieldId: 'fps' }],
      },
    ],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'negative_prompt', role: 'prompt', fieldId: 'negative_prompt' },
        { portId: 'num_frames_input', inputName: 'num_frames', role: 'prompt', fieldId: 'num_frames' },
        { portId: 'height_input', inputName: 'height', role: 'prompt', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'prompt', fieldId: 'width' },
        { portId: 'video', role: 'loadVideo', fieldId: 'file' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
      ],
      outputs: [
        {
          portId: 'videos',
          role: 'videoExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'video',
        },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Cosmos3OmniModularPipeline:video2video_with_sound',
    definitionContentHash: 'sha256:1a8968646a4dd01095139376314c5ec63fd52947291de8446bc45ce55dbc9be7',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'video2video_with_sound',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:video2video_with_sound:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-941e9cd6',
    compiledDefinitionCanonicalSha256: 'sha256:9f6ebf2c7bc9e14d0dc5593ec51c2dc576da4b5bdf042e8d0c465f258a6f4a77',
    studioMode: 'video_to_video_with_audio',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3OmniModularPipeline:video2video_with_sound:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-nano:modular-video-to-video-with-audio:v1',
      contentHash: 'studio-spec-v1-8c1fb46f',
      executionProfileId: 'cosmos3-nano:official-modular-workflow',
    },
    artifact: {
      repo: 'nvidia/Cosmos3-Nano',
      revision: '7a312c868bcce8e40b3eb40861300a9d0ba3fde1',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    controlFanOuts: [
      {
        source: 'fps',
        persistence: 'execution_parameter',
        primary: { role: 'prompt', fieldId: 'fps' },
        mirrors: [{ role: 'videoExport', fieldId: 'fps' }],
      },
    ],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'negative_prompt', role: 'prompt', fieldId: 'negative_prompt' },
        { portId: 'num_frames_input', inputName: 'num_frames', role: 'prompt', fieldId: 'num_frames' },
        { portId: 'height_input', inputName: 'height', role: 'prompt', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'prompt', fieldId: 'width' },
        { portId: 'video', role: 'loadVideo', fieldId: 'file' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
      ],
      outputs: [
        {
          portId: 'videos',
          role: 'videoExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'video',
        },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Flux2KleinBaseModularPipeline:text2image',
    definitionContentHash: 'sha256:44b5e43fb6ad03cb93ebee5eb47551fea96dd5a65872ed54ade95cac944f5ab3',
    pipelineClass: 'Flux2KleinBaseModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:Flux2KleinBaseModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-0b0487a2',
    compiledDefinitionCanonicalSha256: 'sha256:d9e408fb234d60a8166a94faae48c2a8b3e88df5523f0bf10e900946a984a6c6',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.modular-adapter:Flux2KleinBaseModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec: {
      id: 'flux2-klein-base:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-6213479a',
      executionProfileId: 'flux2-klein-base:modular',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.2-klein-base-4B',
      revision: 'a3b4f4849157f664bdbc776fd7453c2783562f4d',
    },
    dynamicFieldActions: STANDARD_MODULAR_DYNAMIC_FIELD_ACTIONS,
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:Flux2KleinModularPipeline:text2image',
    definitionContentHash: 'sha256:dab62f686d9686599abb001c56bc54cd9fe6d4c9f0a7f1324f97c0ebaefd4f32',
    pipelineClass: 'Flux2KleinModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:Flux2KleinModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-c886d3bd',
    compiledDefinitionCanonicalSha256: 'sha256:e9baf8403e04eb348c128ab09c704ba922b6050945a6d9e020ec2b47f939bd5f',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.modular-adapter:Flux2KleinModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec: {
      id: 'flux2-klein:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-07602614',
      executionProfileId: 'flux2-klein:modular',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.2-klein-4B',
      revision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
    },
    dynamicFieldActions: STANDARD_MODULAR_DYNAMIC_FIELD_ACTIONS,
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:FluxKontextModularPipeline:text2image',
    definitionContentHash: 'sha256:62849ec066216880296fb58948653a716f0a4a83849e54858378eb0e74cd4b88',
    pipelineClass: 'FluxKontextModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:FluxKontextModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-a35f7fd5',
    compiledDefinitionCanonicalSha256: 'sha256:db65a154f942d0038e4ffe69de770abcfa2a3461beea753f180fe58216fee975',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.modular-adapter:FluxKontextModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec: {
      id: 'flux-kontext:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-f66959c0',
      executionProfileId: 'flux-kontext:modular',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Kontext-dev',
      revision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
    },
    dynamicFieldActions: STANDARD_MODULAR_DYNAMIC_FIELD_ACTIONS,
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:FluxModularPipeline:text2image',
    definitionContentHash: 'sha256:cfec41815a507f63620e7b80cb6a18700485ac2520a7472826b1389418bbd7ed',
    pipelineClass: 'FluxModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:FluxModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-394bf2b4',
    compiledDefinitionCanonicalSha256: 'sha256:e6b63c81cc52b11dd51061fd4b476ffe468434c9fe32b185328b459c1295581c',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.modular-adapter:FluxModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec: {
      id: 'flux-dev:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-9dd14796',
      executionProfileId: 'flux-dev:modular',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-dev',
      revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
    },
    dynamicFieldActions: STANDARD_MODULAR_DYNAMIC_FIELD_ACTIONS,
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:MiniMaxMusic3ModularPipeline:default',
    definitionContentHash: 'sha256:cb700ac7faacb63708965d7a4d40c4d6467fde678ec702aea7c30467059cd3ad',
    pipelineClass: 'MiniMaxMusic3ModularPipeline',
    workflowId: 'default',
    admissionId: 'diffusers.cluster-admission:MiniMaxMusic3ModularPipeline:default:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-f1af8629',
    compiledDefinitionCanonicalSha256: 'sha256:adfcd515b6ef10ded0a08c9ddb9192ff1d1ed62726ce9799afdfaa586ed6da30',
    studioMode: 'text_to_audio',
    adapterContractId:
      'diffusers.modular-adapter:MiniMaxMusic3ModularPipeline:default:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'minimax-music3:modular-text-to-audio:v1',
      contentHash: 'studio-spec-v1-8a75ab6f',
      executionProfileId: 'minimax-music3:official-modular-workflow',
    },
    artifact: {
      repo: 'MiniMaxAI/MiniMax-Music3',
      revision: 'fbdf52fbaaca799592917417eb05f1899f1255ec',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    boundary: {
      outputs: [{ portId: 'audios', role: 'decode', fieldId: 'audio', adaptation: 'direct_media', mediaType: 'audio' }],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:MiniMaxH3ModularPipeline:t2va',
    definitionContentHash: 'sha256:cdc0e8114d54ebde4efe880d1a72ca068f1b23ab07a668dd00ef54bf2d350cda',
    pipelineClass: 'MiniMaxH3ModularPipeline',
    workflowId: 't2va',
    admissionId: 'diffusers.cluster-admission:MiniMaxH3ModularPipeline:t2va:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-45a9136f',
    compiledDefinitionCanonicalSha256: 'sha256:092cfe42a28a983f5284b427ba4510c5d0b6d89781c63ccfbe3df8bbcbb85bb5',
    studioMode: 'text_to_video_with_audio',
    adapterContractId: 'diffusers.modular-adapter:MiniMaxH3ModularPipeline:t2va:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'minimax-h3:modular-text-to-video-with-audio:v1',
      contentHash: 'studio-spec-v1-1b6aa7f7',
      executionProfileId: 'minimax-h3:official-modular-workflow',
    },
    artifact: {
      repo: 'MiniMaxAI/MiniMax-H3',
      revision: '42ed227ee7df40d41602854ae760620d6eb651fe',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'height_input', inputName: 'height', role: 'denoise', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'denoise', fieldId: 'width' },
        { portId: 'num_frames_input', inputName: 'num_frames', role: 'denoise', fieldId: 'num_frames' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
      ],
      outputs: [
        { portId: 'videos', role: 'decode', fieldId: 'video', adaptation: 'direct_media', mediaType: 'video' },
        { portId: 'audio', role: 'decode', fieldId: 'audio', adaptation: 'direct_media', mediaType: 'audio' },
        { portId: 'sampling_rate', role: 'decode', fieldId: 'sample_rate' },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:MiniMaxH3ModularPipeline:fl2va',
    definitionContentHash: 'sha256:5ca22c53b6c705356415b4273981ea6151bd844f61930340391fd8b85c39e8cc',
    pipelineClass: 'MiniMaxH3ModularPipeline',
    workflowId: 'fl2va',
    admissionId: 'diffusers.cluster-admission:MiniMaxH3ModularPipeline:fl2va:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-c1ae6fb5',
    compiledDefinitionCanonicalSha256: 'sha256:a00c9f0c5afd8b196e43723880a8d7d61ef911291fca4bc24b32fcb467dc2e42',
    studioMode: 'first_last_frame_to_video_with_audio',
    adapterContractId: 'diffusers.modular-adapter:MiniMaxH3ModularPipeline:fl2va:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'minimax-h3:modular-first-last-frame-to-video-with-audio:v1',
      contentHash: 'studio-spec-v1-b81dc131',
      executionProfileId: 'minimax-h3:official-modular-workflow',
    },
    artifact: {
      repo: 'MiniMaxAI/MiniMax-H3',
      revision: '42ed227ee7df40d41602854ae760620d6eb651fe',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    boundary: {
      inputs: [
        { portId: 'image', role: 'beforeEncode', fieldId: 'image' },
        { portId: 'last_image', role: 'beforeEncode', fieldId: 'last_image' },
        { portId: 'height_input', inputName: 'height', role: 'beforeEncode', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'beforeEncode', fieldId: 'width' },
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'num_frames_input', inputName: 'num_frames', role: 'beforeEncode', fieldId: 'num_frames' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
      ],
      outputs: [
        { portId: 'videos', role: 'decode', fieldId: 'video', adaptation: 'direct_media', mediaType: 'video' },
        { portId: 'audio', role: 'decode', fieldId: 'audio', adaptation: 'direct_media', mediaType: 'audio' },
        { portId: 'sampling_rate', role: 'decode', fieldId: 'sample_rate' },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:MiniMaxH3ModularPipeline:ref2va',
    definitionContentHash: 'sha256:a1d7ba1a9d62de394742f34ea0f8ad5bb47b3dce958d905e0c46a61a2c053d4b',
    pipelineClass: 'MiniMaxH3ModularPipeline',
    workflowId: 'ref2va',
    admissionId: 'diffusers.cluster-admission:MiniMaxH3ModularPipeline:ref2va:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-b5357247',
    compiledDefinitionCanonicalSha256: 'sha256:a1d07b12f000d65c78ded811cffea8592189a287e8cf578098e0535e6d6a433d',
    studioMode: 'reference_to_video_with_audio',
    adapterContractId: 'diffusers.modular-adapter:MiniMaxH3ModularPipeline:ref2va:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'minimax-h3:modular-reference-to-video-with-audio:v1',
      contentHash: 'studio-spec-v1-e53dff0e',
      executionProfileId: 'minimax-h3:official-modular-workflow',
    },
    artifact: {
      repo: 'MiniMaxAI/MiniMax-H3',
      revision: '42ed227ee7df40d41602854ae760620d6eb651fe',
    },
    dynamicFieldActions: MODEL_TYPE_DYNAMIC_FIELD_ACTIONS,
    boundary: {
      inputs: [
        { portId: 'references', role: 'beforeEncode', fieldId: 'references' },
        { portId: 'height_input', inputName: 'height', role: 'beforeEncode', fieldId: 'height' },
        { portId: 'width_input', inputName: 'width', role: 'beforeEncode', fieldId: 'width' },
        { portId: 'num_frames_input', inputName: 'num_frames', role: 'beforeEncode', fieldId: 'num_frames' },
        { portId: 'prompt', role: 'prompt', fieldId: 'prompt' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
      ],
      outputs: [
        { portId: 'videos', role: 'decode', fieldId: 'video', adaptation: 'direct_media', mediaType: 'video' },
        { portId: 'audio', role: 'decode', fieldId: 'audio', adaptation: 'direct_media', mediaType: 'audio' },
        { portId: 'sampling_rate', role: 'decode', fieldId: 'sample_rate' },
      ],
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:QwenImageModularPipeline:text2image',
    definitionContentHash: 'sha256:49cb50671b41cf2c03b22387cfe2cf1b37f16b2996961791505aef830817c393',
    pipelineClass: 'QwenImageModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-6b8aec11',
    compiledDefinitionCanonicalSha256: 'sha256:69f834ff7e2ecfe1dc908b4b00422eb70addd38d4542e688ec08616ceb9f9fc8',
    studioMode: 'modular_text_to_image',
    adapterContractId: 'diffusers.modular-adapter:QwenImageModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec: {
      id: 'qwen-image-2512:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-f4c15e0d',
      executionProfileId: 'qwen-image:modular',
    },
    artifact: {
      repo: 'Qwen/Qwen-Image-2512',
      revision: '25468b98e3276ca6700de15c6628e51b7de54a26',
    },
    reviewedArtifacts: [
      {
        repo: 'Qwen/Qwen-Image',
        revision: '75e0b4be04f60ec59a75f475837eced720f823b6',
      },
      {
        repo: 'Qwen/Qwen-Image-2512',
        revision: '25468b98e3276ca6700de15c6628e51b7de54a26',
      },
      {
        repo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
        revision: 'f50b8c24fe21e9265509b15113b7cca82d0a4443',
      },
    ],
    dynamicFieldActions: STANDARD_MODULAR_DYNAMIC_FIELD_ACTIONS,
    exactModularGraph: {
      semanticRoleByPlacementPath: {
        text_encoder: 'prompt',
        'denoise.denoise': 'denoise',
        'decode.postprocess': 'decode',
      },
      controlPlacementPathBySource: {
        guidanceScale: 'denoise.denoise',
        seed: 'denoise.prepare_latents',
      },
      controlMirrorPlacementPathsBySource: {
        height: ['denoise.prepare_latents'],
        steps: ['denoise.set_timesteps'],
        width: ['denoise.prepare_latents'],
      },
    },
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:StableDiffusionXLModularPipeline:text2image',
    definitionContentHash: 'sha256:6d8397fbb72b31e250e5107dea826505e4202cb1747895ed5ef628d8822e8390',
    pipelineClass: 'StableDiffusionXLModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:StableDiffusionXLModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-b3e1fd2f',
    compiledDefinitionCanonicalSha256: 'sha256:ca34a09936fb146c958509d450521f23b81d8340c658af65b20d9077a9773a17',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.modular-adapter:StableDiffusionXLModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec: {
      id: 'sdxl-base:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-e4afc686',
      executionProfileId: 'sdxl-base:modular',
    },
    artifact: {
      repo: 'stabilityai/stable-diffusion-xl-base-1.0',
      revision: '462165984030d82259a11f4367a4eed129e94a7b',
    },
    dynamicFieldActions: STANDARD_MODULAR_DYNAMIC_FIELD_ACTIONS,
  }),
  diffusersRoute({
    definitionId: 'diffusers.modular:ZImageModularPipeline:text2image',
    definitionContentHash: 'sha256:999c63312a43b65b5b58d3db3bffc1be6219bf85d52bb367cd850aa3df6ef711',
    pipelineClass: 'ZImageModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:ZImageModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-313615c7',
    compiledDefinitionCanonicalSha256: 'sha256:ed8e8167d52e42d7225529b54d967f217332b9a479881613acb516c44f756736',
    studioMode: 'modular_text_to_image',
    adapterContractId: 'diffusers.modular-adapter:ZImageModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec: {
      id: 'z-image:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-59451306',
      executionProfileId: 'z-image:modular',
    },
    artifact: {
      repo: 'Tongyi-MAI/Z-Image-Turbo',
      revision: 'f332072aa78be7aecdf3ee76d5c247082da564a6',
    },
    dynamicFieldActions: STANDARD_MODULAR_DYNAMIC_FIELD_ACTIONS,
  }),
  transformersRoute({
    definitionId: 'transformers.composite:HuggingFaceAnyToAnyModel:image_to_text',
    definitionContentHash: 'sha256:0ebbe9e39e10f4a9cc8a73516e30a12525f4583ac86e6a8c608f6e7dcbe8eb49',
    libraryRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    pipelineClass: 'HuggingFaceAnyToAnyModel',
    workflowId: 'image_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceAnyToAnyModel:image_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-0afedc2e',
    compiledDefinitionCanonicalSha256: 'sha256:ad4632f5f78ba0c1daf9c7f7135ffdb8d37ee6b8b1b7147f84ee395f468b3b51',
    studioMode: 'image_to_text',
    adapterContractId: 'transformers.composite-adapter:HuggingFaceAnyToAnyModel:image_to_text',
    studioExecutionSpec: {
      id: 'janus-pro-1b:image-to-text:v1',
      contentHash: 'studio-spec-v1-234664aa',
      executionProfileId: 'janus-pro-1b:direct',
    },
    artifact: {
      repo: 'deepseek-community/Janus-Pro-1B',
      revision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    },
    boundary: {
      inputs: [
        { portId: 'image', role: 'loadImage', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'image' },
      ],
      outputs: [{ portId: 'result', role: 'transformersAnyToAnyGenerate', fieldId: 'result' }],
    },
  }),
  transformersRoute({
    definitionId: 'transformers.composite:HuggingFaceAnyToAnyModel:text_generation',
    definitionContentHash: 'sha256:6451d8b0daacc5353b0b294d8d51d1f2d1c9e4215c047d0d28bc87f1591ced0c',
    libraryRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    pipelineClass: 'HuggingFaceAnyToAnyModel',
    workflowId: 'text_generation',
    admissionId: 'transformers.cluster-admission:HuggingFaceAnyToAnyModel:text_generation',
    compiledDefinitionContentHash: 'block-definition-v2-e1b6efdd',
    compiledDefinitionCanonicalSha256: 'sha256:7c1f79f4ddf0999d91740bb2fc3eec814ac71be39817aaf2a2bd235239290591',
    studioMode: 'text_generation',
    adapterContractId: 'transformers.composite-adapter:HuggingFaceAnyToAnyModel:text_generation',
    studioExecutionSpec: {
      id: 'janus-pro-1b:text-generation:v1',
      contentHash: 'studio-spec-v1-e769a28b',
      executionProfileId: 'janus-pro-1b:direct',
    },
    artifact: {
      repo: 'deepseek-community/Janus-Pro-1B',
      revision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    },
    boundary: { outputs: [{ portId: 'result', role: 'transformersAnyToAnyGenerate', fieldId: 'result' }] },
  }),
  transformersRoute({
    definitionId: 'transformers.composite:HuggingFaceAnyToAnyModel:text_to_image',
    definitionContentHash: 'sha256:0bb39f76a9d6c6b489d907dc670ea3099c314b3c36988c10e93c3f0de644d253',
    libraryRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    pipelineClass: 'HuggingFaceAnyToAnyModel',
    workflowId: 'text_to_image',
    admissionId: 'transformers.cluster-admission:HuggingFaceAnyToAnyModel:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-ff70bec5',
    compiledDefinitionCanonicalSha256: 'sha256:62f98ac93547e764029737f5eb2d6079d08d118db99a9ee7f4ad6fddf0579f29',
    studioMode: 'text_to_image',
    adapterContractId: 'transformers.composite-adapter:HuggingFaceAnyToAnyModel:text_to_image',
    studioExecutionSpec: {
      id: 'janus-pro-1b:text-to-image:v1',
      contentHash: 'studio-spec-v1-b484288e',
      executionProfileId: 'janus-pro-1b:direct',
    },
    artifact: {
      repo: 'deepseek-community/Janus-Pro-1B',
      revision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    },
    boundary: {
      outputs: [
        {
          portId: 'image',
          role: 'transformersAnyToAnyGenerate',
          fieldId: 'image',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  }),
  transformersRoute({
    definitionId: 'transformers.composite:HuggingFaceCTCSpeechRecognitionModel:speech_to_text',
    definitionContentHash: 'sha256:dccbc1cfef44ccc331d3db8983a2c93fc2d59469017808ba7ccf03df3e8de8ce',
    libraryRevision: '22aad52d435eb6dbaf354bdad9b0da84ce7d6156',
    pipelineClass: 'HuggingFaceCTCSpeechRecognitionModel',
    workflowId: 'speech_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceCTCSpeechRecognitionModel:speech_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-0538acfd',
    compiledDefinitionCanonicalSha256: 'sha256:93e0da40072e8dc625e17572072eb85ac10dbf2b4a658357e351098b1ce3220a',
    studioMode: 'speech_to_text',
    adapterContractId: 'transformers.composite-adapter:HuggingFaceCTCSpeechRecognitionModel:speech_to_text',
    studioExecutionSpec: {
      id: 'wav2vec2-base-960h:speech-to-text:v1',
      contentHash: 'studio-spec-v1-32eb7d06',
      executionProfileId: 'wav2vec2-base-960h:ctc-direct',
    },
    artifact: {
      repo: 'facebook/wav2vec2-base-960h',
      revision: '22aad52d435eb6dbaf354bdad9b0da84ce7d6156',
    },
    boundary: {
      inputs: [
        { portId: 'audio', role: 'loadAudio', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'audio' },
      ],
      outputs: [{ portId: 'result', role: 'transcribeAudio', fieldId: 'transcript' }],
    },
  }),
  transformersRoute({
    definitionId: 'transformers.composite:HuggingFaceImageTextToTextModel:image_to_text',
    definitionContentHash: 'sha256:f74e416634ea113f92450a83fcd523da128a05ed4e7e410ca10b3366a8e29e5f',
    libraryRevision: '7e3e67edbbed1bf9888184d9df282b700a323964',
    pipelineClass: 'HuggingFaceImageTextToTextModel',
    workflowId: 'image_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceImageTextToTextModel:image_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-911b1c05',
    compiledDefinitionCanonicalSha256: 'sha256:1d2d81a9f5de42cba994a09593c4f7c6530bdc6910a470162d1dc28054b46edd',
    studioMode: 'image_to_text',
    adapterContractId: 'transformers.composite-adapter:HuggingFaceImageTextToTextModel:image_to_text',
    studioExecutionSpec: {
      id: 'smolvlm-256m-instruct:image-to-text:v1',
      contentHash: 'studio-spec-v1-92e4c167',
      executionProfileId: 'smolvlm-256m-instruct:direct',
    },
    artifact: {
      repo: 'HuggingFaceTB/SmolVLM-256M-Instruct',
      revision: '7e3e67edbbed1bf9888184d9df282b700a323964',
    },
    boundary: {
      inputs: [
        { portId: 'image', role: 'loadImage', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'image' },
      ],
      outputs: [{ portId: 'result', role: 'transformersImageTextGenerate', fieldId: 'result' }],
    },
  }),
  transformersRoute({
    definitionId: 'transformers.composite:HuggingFaceSpeechRecognitionModel:speech_to_text',
    definitionContentHash: 'sha256:f79474c9e3aad63a287de2bf4b9cfe7297675fa578ebdcca7799a5fba31e594e',
    libraryRevision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
    pipelineClass: 'HuggingFaceSpeechRecognitionModel',
    workflowId: 'speech_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceSpeechRecognitionModel:speech_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-9572427b',
    compiledDefinitionCanonicalSha256: 'sha256:afc2e974a19b5082ce0dc1529d734a32439f61cc8795a56ad59db39285ac379f',
    studioMode: 'speech_to_text',
    adapterContractId: 'transformers.composite-adapter:HuggingFaceSpeechRecognitionModel:speech_to_text',
    studioExecutionSpec: {
      id: 'whisper-tiny:speech-to-text:v1',
      contentHash: 'studio-spec-v1-d9e22ded',
      executionProfileId: 'whisper-tiny:direct',
    },
    artifact: {
      repo: 'openai/whisper-tiny',
      revision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
    },
    boundary: {
      inputs: [
        { portId: 'audio', role: 'loadAudio', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'audio' },
      ],
      outputs: [{ portId: 'result', role: 'transcribeAudio', fieldId: 'transcript' }],
    },
  }),
  transformersRoute({
    definitionId: 'transformers.composite:HuggingFaceSpeechRecognitionModel:speech_translation',
    definitionContentHash: 'sha256:75d167281041d1167dbf58218baf996551fd76553b123f21269f7fee0b9c2908',
    libraryRevision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
    pipelineClass: 'HuggingFaceSpeechRecognitionModel',
    workflowId: 'speech_translation',
    admissionId: 'transformers.cluster-admission:HuggingFaceSpeechRecognitionModel:speech_translation',
    compiledDefinitionContentHash: 'block-definition-v2-d24f88d0',
    compiledDefinitionCanonicalSha256: 'sha256:a29af182025a23d62f6bb7f619783d771d52775870dfcdd8eeb2176ab778bfd4',
    studioMode: 'speech_translation',
    adapterContractId: 'transformers.composite-adapter:HuggingFaceSpeechRecognitionModel:speech_translation',
    studioExecutionSpec: {
      id: 'whisper-tiny:speech-translation:v1',
      contentHash: 'studio-spec-v1-1fe7022c',
      executionProfileId: 'whisper-tiny:direct',
    },
    artifact: {
      repo: 'openai/whisper-tiny',
      revision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
    },
    boundary: {
      inputs: [
        { portId: 'audio', role: 'loadAudio', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'audio' },
      ],
      outputs: [{ portId: 'result', role: 'transcribeAudio', fieldId: 'transcript' }],
    },
  }),
  transformersRoute({
    definitionId: 'transformers.composite:HuggingFaceTextGenerationModel:text_generation',
    definitionContentHash: 'sha256:32f78d82f1912997b1eaaf43a749627d7ccd07b8805bd66e8abaf21b27c6385a',
    libraryRevision: '12fd25f77366fa6b3b4b768ec3050bf629380bac',
    pipelineClass: 'HuggingFaceTextGenerationModel',
    workflowId: 'text_generation',
    admissionId: 'transformers.cluster-admission:HuggingFaceTextGenerationModel:text_generation',
    compiledDefinitionContentHash: 'block-definition-v2-d433f9be',
    compiledDefinitionCanonicalSha256: 'sha256:898427024ec85e94bcc6c0dc89e43a6c11285a8f2d975ca25f35b49982f74888',
    studioMode: 'text_generation',
    adapterContractId: 'transformers.composite-adapter:HuggingFaceTextGenerationModel:text_generation',
    studioExecutionSpec: {
      id: 'smollm2-135m-instruct:text-generation:v1',
      contentHash: 'studio-spec-v1-d9902470',
      executionProfileId: 'smollm2-135m-instruct:direct',
    },
    artifact: {
      repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
      revision: '12fd25f77366fa6b3b4b768ec3050bf629380bac',
    },
    boundary: { outputs: [{ portId: 'result', role: 'transformersTextGenerate', fieldId: 'result' }] },
  }),
]);

function sameJson(left: unknown, right: unknown) {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0))
        .map(([key, entry]) => [key, ordered(entry)]),
    );
  };
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

const COMMIT = /^[a-f0-9]{40}$/u;

export function selectedRegisteredBlockArtifactV2(route: RegisteredBlockV2Route, selectedRepository: unknown) {
  const repository =
    typeof selectedRepository === 'string' && selectedRepository.trim()
      ? selectedRepository.trim()
      : route.artifact.repo;
  const reviewed = route.reviewedArtifacts ?? [route.artifact];
  const artifact = reviewed.find(({ repo }) => repo === repository);
  if (!artifact || !COMMIT.test(artifact.revision)) return null;
  return artifact;
}

export function registeredBlockV2Route(
  definition: HuggingFaceNodeLibraryDefinition,
  admission: HuggingFaceNodeLibraryExecutionAdmission | undefined,
) {
  if (!admission) return null;
  const route = REGISTERED_BLOCK_V2_ROUTES.find(
    (candidate) => candidate.definitionId === definition.id && candidate.admissionId === admission.id,
  );
  if (
    !route ||
    definition.schemaVersion !== 6 ||
    definition.provider !== route.provider ||
    definition.surface !== route.surface ||
    definition.definitionKind !== route.definitionKind ||
    definition.ownership !== 'library' ||
    definition.mutable !== false ||
    definition.contentHash !== route.definitionContentHash ||
    definition.libraryRevision !== route.libraryRevision ||
    !COMMIT.test(definition.libraryRevision) ||
    definition.pipelineClass !== route.pipelineClass ||
    definition.workflowId !== route.workflowId ||
    admission.definitionId !== route.definitionId ||
    admission.studioMode !== route.studioMode ||
    admission.adapterContractId !== route.adapterContractId ||
    !definition.graphAdapterContracts.some(({ id }) => id === route.adapterContractId) ||
    admission.status !== 'admitted' ||
    admission.claim !== 'static_graph_contract_compatible' ||
    admission.executable !== false ||
    admission.publication.readiness !== 'graph_qualified' ||
    admission.publication.insertable !== true ||
    admission.publication.executable !== false ||
    admission.reasons.length !== 0 ||
    !sameJson(admission.studioExecutionSpec, route.studioExecutionSpec) ||
    !sameJson(admission.artifact, route.artifact) ||
    !COMMIT.test(route.artifact.revision) ||
    !sameJson(admission.dynamicFieldActions, route.dynamicFieldActions)
  )
    return null;
  return route;
}
