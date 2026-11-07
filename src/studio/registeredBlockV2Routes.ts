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

const DIFFUSERS_REVISION = '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941';
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
    definitionContentHash: 'sha256:d865ea6a6bde320211812251352d966ff70ae120db49cd670798d4a505f6abdf',
    pipelineClass: 'AnimaModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:AnimaModularPipeline:text2image:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-853db047',
    compiledDefinitionCanonicalSha256: 'sha256:1dc91c25a078dbf03b337d2293e68d55caac47840dc398727111304312b8c0b3',
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
    definitionContentHash: 'sha256:306907f479a028df37eb3b7d9efde45e9cbe9eec6f7c67b137655752bd37c929',
    pipelineClass: 'Cosmos3DistilledModularPipeline',
    workflowId: 'image2video',
    admissionId:
      'diffusers.cluster-admission:Cosmos3DistilledModularPipeline:image2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-4798547f',
    compiledDefinitionCanonicalSha256: 'sha256:b59ae721dccc6732dc8cd45ca6f760cfe56ca7e9bf9638f45e879e3ac06aa918',
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
    definitionContentHash: 'sha256:b0ea08643ac383e36b5c300e8f68fc32104c85ed3d1a0f42defb306362df995b',
    pipelineClass: 'Cosmos3DistilledModularPipeline',
    workflowId: 'text2image',
    admissionId:
      'diffusers.cluster-admission:Cosmos3DistilledModularPipeline:text2image:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-738e7db2',
    compiledDefinitionCanonicalSha256: 'sha256:c5a320f63b1e0b269faa78b45bea375e5d966e714e13e80ea42f97e65bc8067b',
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
    definitionContentHash: 'sha256:1aaac680e19ea246998321b99e64ecd952f555b102c4f059abc55dea2f5db4c1',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2image:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-4490767c',
    compiledDefinitionCanonicalSha256: 'sha256:37ec92212a9514c9507d744c0bb4fb8329a870d1208ebb025a78db7cedd96dd7',
    studioMode: 'text_to_image',
    adapterContractId:
      'diffusers.modular-adapter:Cosmos3OmniModularPipeline:text2image:workflow:official_top_level_blocks',
    studioExecutionSpec: {
      id: 'cosmos3-nano:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-badb9cde',
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
    definitionContentHash: 'sha256:398f74d7c3a115d04a79aa028aee4a3aef3138550c556e1d3a2409e0c3f95313',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'text2video',
    admissionId: 'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-089debb4',
    compiledDefinitionCanonicalSha256: 'sha256:04abc3485fe8f1b130cf400be0ce5a32aacd8fd5f3003571d6b9f884274bf8df',
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
    definitionContentHash: 'sha256:ef991da354483e3c317f1f663d108e482d3a897b7a1b9b8bf8845fba3f19aee9',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'image2video',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:image2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-d367c0b0',
    compiledDefinitionCanonicalSha256: 'sha256:6822fe0fe340bf62bf3a9287769b05b3368479d9c63580ddeb95cafa3428be01',
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
    definitionContentHash: 'sha256:3580348426c276b0146518eec7a064b9df2f7ec325e930674951553d8b1f4446',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'image2video_with_sound',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:image2video_with_sound:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-ca72d264',
    compiledDefinitionCanonicalSha256: 'sha256:6fa9ba06fdf0fc98d055c17827798b840299b70ca806d3a4c6267abb7e558cb7',
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
    definitionContentHash: 'sha256:2cb0aa1f5b0f40517d4a3519db08cd8c1ad25632c89c8898ca57a3f17498f62a',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'text2video_with_sound',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2video_with_sound:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-a702c49c',
    compiledDefinitionCanonicalSha256: 'sha256:36cc1218c64014948654e986b459b157712aca635aee75b033b9b2221f0101ec',
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
    definitionContentHash: 'sha256:3408b06214701b978f50ab7cbe7bc6634308e212b955bcefa30b1b89e5ecc6ba',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'video2video',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:video2video:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-dbb0a9bc',
    compiledDefinitionCanonicalSha256: 'sha256:90f5721bfbd4a32b88d708ef44b0746e67cbc5a84bf3801b8087ca3c333b18f6',
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
    definitionContentHash: 'sha256:3150f66ad771c6f4cef63de8cb32731a61bff8a0af97e760917344e7cf0ac593',
    pipelineClass: 'Cosmos3OmniModularPipeline',
    workflowId: 'video2video_with_sound',
    admissionId:
      'diffusers.cluster-admission:Cosmos3OmniModularPipeline:video2video_with_sound:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-9768a27e',
    compiledDefinitionCanonicalSha256: 'sha256:6cad636177ff824bebb21201937234c204f4a2e630198096adf793a7e20af129',
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
    definitionContentHash: 'sha256:dd5a29e4b4f7ea4856475b1142aa9fdbf9213221a748f138bb4b67281c920268',
    pipelineClass: 'Flux2KleinBaseModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:Flux2KleinBaseModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-5945880c',
    compiledDefinitionCanonicalSha256: 'sha256:6f01da9ee6a1f737497acd5810c46d27fa7c96774696f40f699fe2a5394c674c',
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
    definitionContentHash: 'sha256:f94e32bd36671675997f175d0df5621773f21628671a029de6e3639315fc3a48',
    pipelineClass: 'Flux2KleinModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:Flux2KleinModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-e229bd51',
    compiledDefinitionCanonicalSha256: 'sha256:1de24c69cc2039a4b03d1b46c53159cc1674f1b406e93b741744e608ac12d761',
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
    definitionContentHash: 'sha256:f8a526814a4706282a30a977b07e44dafc7310147417409d2107d8264c37b1be',
    pipelineClass: 'FluxKontextModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:FluxKontextModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-ff110ae0',
    compiledDefinitionCanonicalSha256: 'sha256:b15f3bf3d65fdcc08580a9a02e44afc750cc1b3e84b5eb61040d6d575b8e787b',
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
    definitionContentHash: 'sha256:66248e988b06d822fcd7cad5598a7b902cd4af984f3ba96afb9d1c574544f078',
    pipelineClass: 'FluxModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:FluxModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-af240eef',
    compiledDefinitionCanonicalSha256: 'sha256:e99e79b34a54fb57c6295105562d47c1a9be7f56dd9d8303e49c8cca9ed0a645',
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
    definitionContentHash: 'sha256:aa13b727116a74d0d1cbec311ba979c79729027c57b5a46128b6b9c0eb7808f3',
    pipelineClass: 'MiniMaxMusic3ModularPipeline',
    workflowId: 'default',
    admissionId: 'diffusers.cluster-admission:MiniMaxMusic3ModularPipeline:default:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-f8e83798',
    compiledDefinitionCanonicalSha256: 'sha256:54ca590a5428d3aa546e9cd7860a63bb57585c72b2822b3b25db13522e38ecd5',
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
    definitionContentHash: 'sha256:bfca25e8659694ee49bc883a7a731b700e503949a7c1251bc9b1d486b7a98463',
    pipelineClass: 'MiniMaxH3ModularPipeline',
    workflowId: 't2va',
    admissionId: 'diffusers.cluster-admission:MiniMaxH3ModularPipeline:t2va:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-ebadb11c',
    compiledDefinitionCanonicalSha256: 'sha256:7a0d2f9627934df45a2047b68b1db17e718b52b0456bf314eb429ca9d07cc980',
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
    definitionContentHash: 'sha256:a8fce0c909d41798fd66a7eef46a13802b8d6680e5517da2d8db9b25e963e68d',
    pipelineClass: 'MiniMaxH3ModularPipeline',
    workflowId: 'fl2va',
    admissionId: 'diffusers.cluster-admission:MiniMaxH3ModularPipeline:fl2va:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-832be953',
    compiledDefinitionCanonicalSha256: 'sha256:fbeccf1abe6426846ad431b3b62f063a57713899e93155dd6412f5b0fb15c123',
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
    definitionContentHash: 'sha256:e3a5a7098e67dd13490158ed35b673e8f6ef7bfc15cd317e6dbacce7eb950f8f',
    pipelineClass: 'MiniMaxH3ModularPipeline',
    workflowId: 'ref2va',
    admissionId: 'diffusers.cluster-admission:MiniMaxH3ModularPipeline:ref2va:workflow:official_top_level_blocks',
    compiledDefinitionContentHash: 'block-definition-v2-501857b1',
    compiledDefinitionCanonicalSha256: 'sha256:0b8f3c5050db6deb5785e6c1214b4d1f88dcb2dac8411407adad3310e89d0d11',
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
    definitionContentHash: 'sha256:9425b62f99dbcdce2b152052acbe093c2a45eb9ef4b0424041de644cacf79a29',
    pipelineClass: 'QwenImageModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-c02d311d',
    compiledDefinitionCanonicalSha256: 'sha256:b762f83412fe501889a32477f2f1f66d182ce73c7969f07d67cf9781e5efe755',
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
    definitionContentHash: 'sha256:883a84f9ee24ac053fa00707daccf144fcbe6c83a5451de2e8c22524e93bc8ea',
    pipelineClass: 'StableDiffusionXLModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:StableDiffusionXLModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-e316b6e2',
    compiledDefinitionCanonicalSha256: 'sha256:055c7bd272bced1cc04da268f483dee68f1bdae1eeda9054aa384f9145fc3c46',
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
    definitionContentHash: 'sha256:d9a597cd848e21713970daf1c6d52314a2157d1e6a4359ecc2a34e5bf1f9a5eb',
    pipelineClass: 'ZImageModularPipeline',
    workflowId: 'text2image',
    admissionId: 'diffusers.cluster-admission:ZImageModularPipeline:text2image:mode:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-26ba444e',
    compiledDefinitionCanonicalSha256: 'sha256:accb1a0a62c4fae3b49d5ab112c32e6921f6cb899b06bda44274ba9647546ea6',
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
    definitionContentHash: 'sha256:3c8581dd36fb231c752f25792ab4ecc94954416170c564486c9a9f5d4e81e64c',
    libraryRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    pipelineClass: 'HuggingFaceAnyToAnyModel',
    workflowId: 'image_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceAnyToAnyModel:image_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-80746e3c',
    compiledDefinitionCanonicalSha256: 'sha256:0fcb29dac428dbbf1a47203b3525d0c80820cf8744a9e775d013e43aee9cfb4b',
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
    definitionContentHash: 'sha256:98147a08217cd1b758fe75398356c2f8b650d21ed4b8444a422ffe15fc3be9a0',
    libraryRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    pipelineClass: 'HuggingFaceAnyToAnyModel',
    workflowId: 'text_generation',
    admissionId: 'transformers.cluster-admission:HuggingFaceAnyToAnyModel:text_generation',
    compiledDefinitionContentHash: 'block-definition-v2-55b0e44e',
    compiledDefinitionCanonicalSha256: 'sha256:4fe1b1cbf6f668f63c0d70c1952dfc0f368f0419958bf011c60f0371193ca0dc',
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
    definitionContentHash: 'sha256:9a4de4fd6bd371da59eb2799deec9d1ebf0055c4de4fb65229dcd1010c83fe9c',
    libraryRevision: '1655280bb75959cc1cb85529a2a8b26e7016072e',
    pipelineClass: 'HuggingFaceAnyToAnyModel',
    workflowId: 'text_to_image',
    admissionId: 'transformers.cluster-admission:HuggingFaceAnyToAnyModel:text_to_image',
    compiledDefinitionContentHash: 'block-definition-v2-a00d3653',
    compiledDefinitionCanonicalSha256: 'sha256:bfa76087823f1e2eec178a1f419ffdfbc06131a18200e52333946f5fc0210c57',
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
    definitionContentHash: 'sha256:d57f7ecdb741ec9d41a4d6bbd0c9769c99cd69495770616f0fd2e91d60aa6bfe',
    libraryRevision: '22aad52d435eb6dbaf354bdad9b0da84ce7d6156',
    pipelineClass: 'HuggingFaceCTCSpeechRecognitionModel',
    workflowId: 'speech_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceCTCSpeechRecognitionModel:speech_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-5a91bee4',
    compiledDefinitionCanonicalSha256: 'sha256:dcc4b55efd51fba2716eb39a1cedfdf5eb8d2be3a35a197c30c2cf903bdfe16f',
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
    definitionContentHash: 'sha256:7fc169a13d9f1a905aaca7ccd2df85b70863bd3f509de1bbc27a55449f01d008',
    libraryRevision: '7e3e67edbbed1bf9888184d9df282b700a323964',
    pipelineClass: 'HuggingFaceImageTextToTextModel',
    workflowId: 'image_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceImageTextToTextModel:image_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-be24b0fc',
    compiledDefinitionCanonicalSha256: 'sha256:59c13af4fe1251f7d934ac3751fcfef8f95d7d5b7b19172dda410e84013a52d4',
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
    definitionContentHash: 'sha256:00517febc489698fb740473c841ef1945c1a83f9a9de166b2dc5316cbda5b970',
    libraryRevision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
    pipelineClass: 'HuggingFaceSpeechRecognitionModel',
    workflowId: 'speech_to_text',
    admissionId: 'transformers.cluster-admission:HuggingFaceSpeechRecognitionModel:speech_to_text',
    compiledDefinitionContentHash: 'block-definition-v2-0e1c69ce',
    compiledDefinitionCanonicalSha256: 'sha256:75427ed912ccadd3f878d4f593e360094ad1b7430677a89fa1d93c7e7f2afd25',
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
    definitionContentHash: 'sha256:9299a0d203a6b7f4cacc474a6297be661a2b8f00972900c84745cd4580878c00',
    libraryRevision: '169d4a4341b33bc18d8881c4b69c2e104e1cc0af',
    pipelineClass: 'HuggingFaceSpeechRecognitionModel',
    workflowId: 'speech_translation',
    admissionId: 'transformers.cluster-admission:HuggingFaceSpeechRecognitionModel:speech_translation',
    compiledDefinitionContentHash: 'block-definition-v2-edf1ce1f',
    compiledDefinitionCanonicalSha256: 'sha256:668b81822cf888c799580e22672f3775d5601583d1bdca51da68b08d14368ced',
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
    definitionContentHash: 'sha256:e982d1206b2cc0b6154de3e90bedcb8fb012cb9c010406f79c7fe49fd56c8e88',
    libraryRevision: '12fd25f77366fa6b3b4b768ec3050bf629380bac',
    pipelineClass: 'HuggingFaceTextGenerationModel',
    workflowId: 'text_generation',
    admissionId: 'transformers.cluster-admission:HuggingFaceTextGenerationModel:text_generation',
    compiledDefinitionContentHash: 'block-definition-v2-62f7b032',
    compiledDefinitionCanonicalSha256: 'sha256:856c1076bb80aed154b968ff7f8dac877a609f1277b771c3360218cc4a8466ad',
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
