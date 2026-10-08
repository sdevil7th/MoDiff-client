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
    compiledDefinitionContentHash: 'block-definition-v2-c84f698e',
    compiledDefinitionCanonicalSha256: 'sha256:b0234ebb1fdbb6055ecc3dbab488d4ed0c8bcd3c03a20b2b97e84cc65bd412df',
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
    definitionContentHash: 'sha256:2ddca728c630c291d65f385f868dc9f9fb1cbc0501e76f0d0964c28628c2a7f0',
    pipelineClass: 'Cosmos3DistilledModularPipeline',
    workflowId: 'image2video',
    admissionId:
      'diffusers.cluster-admission:Cosmos3DistilledModularPipeline:image2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-81287b36',
    compiledDefinitionCanonicalSha256: 'sha256:0e8d7b1660a8ed723190db87a490bac261f7b74a73e1332e8d9c0165d82eb605',
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
    definitionContentHash: 'sha256:07a8feafa3ec60f926eded40f3e6e58c3f07466e36fc451bb501ac36699961a1',
    pipelineClass: 'Cosmos3DistilledModularPipeline',
    workflowId: 'text2image',
    admissionId:
      'diffusers.cluster-admission:Cosmos3DistilledModularPipeline:text2image:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-018828f1',
    compiledDefinitionCanonicalSha256: 'sha256:e5e8aaeeba8dc9e4a15fb3d47613a3c0f056bc2304551ae4c617c698470e1fec',
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
    definitionContentHash: 'sha256:3a7bd74c7f53fd38fc10995f03ce6a42afd74a0c7091f2125d4cc25bdf3d255f',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2image:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-0ce25fb5',
    compiledDefinitionCanonicalSha256: 'sha256:5f302683f9276144ea57163659d81c07e59366134318054c29d1eed602a96437',
    studioMode: 'text_to_image',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3OmniModularPipeline:text2image:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-nano:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-91ed105d',
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
    definitionContentHash: 'sha256:ad06a48f8ba2426c12c12ffcdb0e3359c51202bf62ac08f65dffe2de2732035a',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'text2video',
    admissionId: 'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-c47dd522',
    compiledDefinitionCanonicalSha256: 'sha256:f88d3e110a9c32a1147fcdcdd62a7ed58eee6917c0c1a6172a547da4db7957b8',
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
    definitionContentHash: 'sha256:457912dac82bfff5cb8fd4403bad6fffed6068bef8e7279c72f2f53bbb54b296',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'image2video',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:image2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-d6210e3a',
    compiledDefinitionCanonicalSha256: 'sha256:1e23ec3ee45452cb836b3abe55f4a518cd5325cb4944be6e9a7c1e2049a18f3d',
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
    definitionContentHash: 'sha256:fc665e24a4d847d256a9f47002b5f89ad2642d324af7e80a6c69ee560eacb511',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'image2video_with_sound',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:image2video_with_sound:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-89c93c1f',
    compiledDefinitionCanonicalSha256: 'sha256:37107c1f32f3af4f81c1d9a0a2072ae210851452688b132b922a74834f83d144',
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
    definitionContentHash: 'sha256:fe2d8f5a648c2067fea5f9ea37aefea500876c14afb4ae882592a739f14b54e8',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'text2video_with_sound',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2video_with_sound:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-146cfebb',
    compiledDefinitionCanonicalSha256: 'sha256:3ab0f3eae9e9f202da682f6fe2a46c42e77e3ce65058953be7725689fb9c585b',
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
    definitionContentHash: 'sha256:2fac2f20b5407bb5a8c9637cb355890612ecc9c00eb87c3da42d4c7811152bb4',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'video2video',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:video2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-c311ea45',
    compiledDefinitionCanonicalSha256: 'sha256:6b1d3057b1498c433c7dca516514814f70cb51b3b8b45c234126aee6edf6955f',
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
    definitionContentHash: 'sha256:1cd89a799236f2835ce9c751996bc655f3c87a46b1964165ce5d95d147319779',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'video2video_with_sound',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:video2video_with_sound:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-0afff4e1',
    compiledDefinitionCanonicalSha256: 'sha256:c71373df32cedd642686c0c0ea9ce8359aa20966f63e0167d4e359fddb4a0019',
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
    compiledDefinitionContentHash: 'block-definition-v2-80434355',
    compiledDefinitionCanonicalSha256: 'sha256:181e301310ed58a5a29b5f44a93169e065e4db8af2e0f95873d634c7be2118c0',
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
    compiledDefinitionContentHash: 'block-definition-v2-6e3e66a8',
    compiledDefinitionCanonicalSha256: 'sha256:47d68c080635d8c8ee645a971d83da4f8045a26151e448fbf0e296056324b821',
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
    definitionContentHash: 'sha256:ee8f7ec37ad0edb5b9a77653f1d08faac5d9e606f4c92cf7457b15fad9d9412f',
    pipelineClass: 'FluxKontextModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:FluxKontextModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-cd492a0a',
    compiledDefinitionCanonicalSha256: 'sha256:a4412304b971bdbd21e22b53ef2fb1d948ce54eda63c2d166449d018c8bb276b',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.modular-adapter:FluxKontextModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec: {
      id: 'flux-kontext:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-923966f5',
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
    definitionContentHash: 'sha256:e675188cacb5c82f1b54304acd11f952b1a459320cda293aecc53f9a4b838503',
    pipelineClass: 'FluxModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:FluxModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-aa8e4872',
    compiledDefinitionCanonicalSha256: 'sha256:42b7d587e57d57dc4b64f33aff2499702606c138535ea46d1eef5968e6185cc6',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.modular-adapter:FluxModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec: {
      id: 'flux-dev:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-f595d0f7',
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
    compiledDefinitionContentHash: 'block-definition-v2-3c88b72c',
    compiledDefinitionCanonicalSha256: 'sha256:38023aaf03efe36f3e12c19197b93a263fe1cc5335625f365c2f3db3072b1148',
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
    compiledDefinitionContentHash: 'block-definition-v2-01c724e8',
    compiledDefinitionCanonicalSha256: 'sha256:d5ef563b039d44d505393c1007b721f600eebac77a703d5e961371dde78bbfb0',
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
    compiledDefinitionContentHash: 'block-definition-v2-c40b4ca0',
    compiledDefinitionCanonicalSha256: 'sha256:090367942f8455637c9fd78155f14838d88a4917621d183b21d27a48913afaf5',
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
    compiledDefinitionContentHash: 'block-definition-v2-869a9ab6',
    compiledDefinitionCanonicalSha256: 'sha256:f9c8926e94718c87016b813e1225a8f84f3c8831a8ff747733062379328d584b',
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
    compiledDefinitionContentHash: 'block-definition-v2-14029f56',
    compiledDefinitionCanonicalSha256: 'sha256:ec3a009adf709adb5a681fe1d0982eb747132793946c1666c2a168cddba5a22a',
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
    compiledDefinitionContentHash: 'block-definition-v2-b1f55fde',
    compiledDefinitionCanonicalSha256: 'sha256:e75243c9e6314fbd1d0e4a01e0c84a44e5760e60aa3af2c3066538177b8f67c7',
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
    definitionContentHash: 'sha256:d510dc9c19615055df7dc04cc26bcf1e02d5bd65573d23091e791d95acea596c',
    pipelineClass: 'ZImageModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:ZImageModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-76f3693f',
    compiledDefinitionCanonicalSha256: 'sha256:d6a1c705d11c32135c17e6dac80b60c207ccaff42cdeb4b9f43a36f7e55a6ca0',
    studioMode: 'modular_text_to_image',
    adapterContractId: 'diffusers.modular-adapter:ZImageModularPipeline:text2image:mode:text_to_image',
    studioExecutionSpec: {
      id: 'z-image:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-fe4320cf',
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
    definitionContentHash: 'sha256:d89605fa08b83901218a0e71e1c6960b9ae218a555d2954bc7f2e0d3243aceaa',
    libraryRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    pipelineClass: 'HuggingFaceAnyToAnyModel',
    workflowId: 'image_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceAnyToAnyModel:image_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-a60ca3d1',
    compiledDefinitionCanonicalSha256: 'sha256:2190f7d585de304a8fe9caffbaf39f7883bb2db96246cf80b7de2ddd64fec6be',
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
    definitionContentHash: 'sha256:615587459ff7cebc84ea36e7d05734ee8804215658ce1b4f25bb2c4a97f27664',
    libraryRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    pipelineClass: 'HuggingFaceAnyToAnyModel',
    workflowId: 'text_generation',
    admissionId: 'transformers.cluster-admission:HuggingFaceAnyToAnyModel:text_generation',
    compiledDefinitionContentHash: 'block-definition-v2-98d35ccc',
    compiledDefinitionCanonicalSha256: 'sha256:33d284ed5e8249e00ac3c8bde5d8352b7fdac81ed3a0f4ba33e1ca35ff9d3e43',
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
    definitionContentHash: 'sha256:df4432a0400f508f556a85b26908545806439d0d194655eb4f7ba3118217e273',
    libraryRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    pipelineClass: 'HuggingFaceAnyToAnyModel',
    workflowId: 'text_to_image',
    admissionId: 'transformers.cluster-admission:HuggingFaceAnyToAnyModel:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-4b41d421',
    compiledDefinitionCanonicalSha256: 'sha256:bf3b046b6256f215afbe9ad91230ac1ac29b12b14e92cf43ecd70591755e92ad',
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
    definitionContentHash: 'sha256:954f72a11f3a58fa754d7ce48d99f24542249763a44ad38aa22353155ea9705e',
    libraryRevision: '22aad52d435eb6dbaf354bdad9b0da84ce7d6156',
    pipelineClass: 'HuggingFaceCTCSpeechRecognitionModel',
    workflowId: 'speech_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceCTCSpeechRecognitionModel:speech_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-0c01cce0',
    compiledDefinitionCanonicalSha256: 'sha256:0895926d45d8e4a3ee091b07f83d49f752b3db94c56cc532c632ca97be71291d',
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
    definitionContentHash: 'sha256:c7d227bfc8326cb6226d743567b227522d13f19a3d3c2bd470543a6a001e2b7e',
    libraryRevision: '7e3e67edbbed1bf9888184d9df282b700a323964',
    pipelineClass: 'HuggingFaceImageTextToTextModel',
    workflowId: 'image_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceImageTextToTextModel:image_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-e9893ba9',
    compiledDefinitionCanonicalSha256: 'sha256:1906d818c547cacb60ffec873a74f8ea15b3d84f4338ec0f7851adb94529dc6a',
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
    definitionContentHash: 'sha256:a21e7830c191772b5ab010ec49323040a2eea14e1c605db597b02818529aa4b4',
    libraryRevision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
    pipelineClass: 'HuggingFaceSpeechRecognitionModel',
    workflowId: 'speech_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceSpeechRecognitionModel:speech_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-2c4721c8',
    compiledDefinitionCanonicalSha256: 'sha256:7e8f62c07fba28a95ba7696e4a1e3d9fa792ed2f7b53530471bb7fa1130db599',
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
    definitionContentHash: 'sha256:0a1f5c8087a342a6c40058aeb066263809f0858d8882d7d4335e64e39cd8f00e',
    libraryRevision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
    pipelineClass: 'HuggingFaceSpeechRecognitionModel',
    workflowId: 'speech_translation',
    admissionId: 'transformers.cluster-admission:HuggingFaceSpeechRecognitionModel:speech_translation',
    compiledDefinitionContentHash: 'block-definition-v2-8b117080',
    compiledDefinitionCanonicalSha256: 'sha256:c2de7d568c29ebdfe6aab418151bd4490878ed3269ebc4eed2732c5fcf7383c7',
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
    definitionContentHash: 'sha256:af0665a30de76d2a10de99d3fc64ede348efcde4620eb7972e6696673722ed33',
    libraryRevision: '12fd25f77366fa6b3b4b768ec3050bf629380bac',
    pipelineClass: 'HuggingFaceTextGenerationModel',
    workflowId: 'text_generation',
    admissionId: 'transformers.cluster-admission:HuggingFaceTextGenerationModel:text_generation',
    compiledDefinitionContentHash: 'block-definition-v2-df16f12e',
    compiledDefinitionCanonicalSha256: 'sha256:f7e2508df6e110e8cec7b355d1f8087c19048c700dfdd1e912c87741c2961c53',
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
