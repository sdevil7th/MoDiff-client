// Exact reviewed ordinary task recipes. These are not Modular Diffusers hierarchies.
import type { RegisteredBlockV2Route } from './registeredBlockV2Routes';

export const REGISTERED_BLOCK_V2_ORDINARY_FLUX_ROUTES: readonly RegisteredBlockV2Route[] = [
  {
    definitionId: 'diffusers.composite:Flux2KleinInpaintPipeline:inpaint',
    definitionContentHash: 'sha256:dd3813435a3ca8889cc314a4e9aaaf528420e2e40ef179bc9f3ebe897a43d2cb',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'Flux2KleinInpaintPipeline',
    workflowId: 'inpaint',
    admissionId: 'diffusers.cluster-admission:Flux2KleinInpaintPipeline:inpaint:mode:inpaint',
    studioMode: 'inpaint',
    adapterContractId: 'diffusers.composite-adapter:Flux2KleinInpaintPipeline:inpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-1cdb8201',
      executionProfileId: 'flux2-klein-inpaint:direct',
      id: 'flux2-klein-inpaint-direct:inpaint:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.2-klein-4B',
      revision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-ff4e01db',
    compiledDefinitionCanonicalSha256: 'sha256:42b1f6ac28549170db18bf84d4809c36a980cd3845739be51d1125ac9deeee51',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageInpaint',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageInpaint',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageInpaint',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageInpaint',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageInpaint',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageInpaint',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageInpaint',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageInpaint',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'mask_image',
          role: 'loadMask',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageInpaint',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageInpaint',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:Flux2KleinInpaintPipeline:outpaint',
    definitionContentHash: 'sha256:279821e7b5582a9089453148b85824a41d58593160b07ebcb824016afd6b9722',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'Flux2KleinInpaintPipeline',
    workflowId: 'outpaint',
    admissionId: 'diffusers.cluster-admission:Flux2KleinInpaintPipeline:outpaint:mode:outpaint',
    studioMode: 'outpaint',
    adapterContractId: 'diffusers.composite-adapter:Flux2KleinInpaintPipeline:outpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-1ec36902',
      executionProfileId: 'flux2-klein-inpaint:direct',
      id: 'flux2-klein-inpaint-direct:outpaint:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.2-klein-4B',
      revision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-fb339ac9',
    compiledDefinitionCanonicalSha256: 'sha256:dad6b4c0b9223aeaecd578e884be25f643f0bdaafd540fec9359a0a28877db4d',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
      {
        source: 'width',
        persistence: 'instance_input',
        primary: {
          role: 'diffusersImageInpaint',
          fieldId: 'width',
        },
        mirrors: [
          {
            role: 'outpaintCanvas',
            fieldId: 'width',
          },
        ],
      },
      {
        source: 'height',
        persistence: 'instance_input',
        primary: {
          role: 'diffusersImageInpaint',
          fieldId: 'height',
        },
        mirrors: [
          {
            role: 'outpaintCanvas',
            fieldId: 'height',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageInpaint',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageInpaint',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageInpaint',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageInpaint',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageInpaint',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageInpaint',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageInpaint',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageInpaint',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageInpaint',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageInpaint',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:Flux2KleinPipeline:multi_image_reference_edit',
    definitionContentHash: 'sha256:e17a5fec7e05aa2006c1e5db3d57f5663502a08e6f1dc339399bc87fc7c2a028',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'Flux2KleinPipeline',
    workflowId: 'multi_image_reference_edit',
    admissionId:
      'diffusers.cluster-admission:Flux2KleinPipeline:multi_image_reference_edit:mode:multi_image_reference_edit',
    studioMode: 'multi_image_reference_edit',
    adapterContractId: 'diffusers.composite-adapter:Flux2KleinPipeline:multi_image_reference_edit',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-756c2d69',
      executionProfileId: 'flux2-klein:direct',
      id: 'flux2-klein:multi-image-reference-edit:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.2-klein-4B',
      revision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-83fafc79',
    compiledDefinitionCanonicalSha256: 'sha256:7356eb3d0cd7be09a0822da5116af02404c7801ebd1fa9a10eec2fa3d293fbe9',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageEdit',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageEdit',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageEdit',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageEdit',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageEdit',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageEdit',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageEdit',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageEdit',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageEdit',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:Flux2Pipeline:multi_image_reference_edit',
    definitionContentHash: 'sha256:d61c5681f33417ac073624ed40dfaaa554ad6cdb85f3acea41a25a362e52b4fe',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'Flux2Pipeline',
    workflowId: 'multi_image_reference_edit',
    admissionId: 'diffusers.cluster-admission:Flux2Pipeline:multi_image_reference_edit:mode:multi_image_reference_edit',
    studioMode: 'multi_image_reference_edit',
    adapterContractId: 'diffusers.composite-adapter:Flux2Pipeline:multi_image_reference_edit',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-7396a19a',
      executionProfileId: 'flux2-dev:direct',
      id: 'flux2-dev:multi-image-reference-edit:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.2-dev',
      revision: '26afe3a78bb242c0a8bb181dcc8937bb16e5c66c',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-8259f574',
    compiledDefinitionCanonicalSha256: 'sha256:3609bc24c31a66e6e59acfcef28b1fed9ebcc0f130de93d442732c7a463ac4f9',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageEdit',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageEdit',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageEdit',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageEdit',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageEdit',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageEdit',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageEdit',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageEdit',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageEdit',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxCannyPipeline:control_edit_image',
    definitionContentHash: 'sha256:e90480ded66ca65e791ca61418e727f102a832deedec60c8ff9cb346b6ff97e8',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxCannyPipeline',
    workflowId: 'control_edit_image',
    admissionId: 'diffusers.cluster-admission:FluxCannyPipeline:control_edit_image:mode:control_edit_image',
    studioMode: 'control_edit_image',
    adapterContractId: 'diffusers.composite-adapter:FluxCannyPipeline:control_edit_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-3416fd5a',
      executionProfileId: 'flux-canny:img2img-direct',
      id: 'flux-canny:control-edit-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Canny-dev',
      revision: '27c3d8bdc17509b47cf4fd9ba25ab1c7508a69a2',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-676a73c0',
    compiledDefinitionCanonicalSha256: 'sha256:df46d35ec49a426ecee26da0d373d014f514bc4686d80a57aa9907781731d13f',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
      {
        source: 'alphaMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'loadControlImage',
          fieldId: 'alpha_channel',
        },
        mirrors: [
          {
            role: 'loadImage',
            fieldId: 'alpha_channel',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageControlEdit',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageControlEdit',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageControlEdit',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageControlEdit',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageControlEdit',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageControlEdit',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageControlEdit',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageControlEdit',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'control_image',
          role: 'loadControlImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageControlEdit',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageControlEdit',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxCannyPipeline:control_image',
    definitionContentHash: 'sha256:90c26565fe210c8f79ed79c1d5cb645bc7b1c26f2ecca80b65255f9aeb3a90d4',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxCannyPipeline',
    workflowId: 'control_image',
    admissionId: 'diffusers.cluster-admission:FluxCannyPipeline:control_image:mode:control_image',
    studioMode: 'control_image',
    adapterContractId: 'diffusers.composite-adapter:FluxCannyPipeline:control_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-82045f56',
      executionProfileId: 'flux-canny:direct',
      id: 'flux-canny:control-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Canny-dev',
      revision: '27c3d8bdc17509b47cf4fd9ba25ab1c7508a69a2',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-59a6bd9e',
    compiledDefinitionCanonicalSha256: 'sha256:e9da1af7bdad85a6c1f028a1b22fa4ade527563d7e0869bc4560616c1b60fa91',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageControl',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageControl',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageControl',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageControl',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageControl',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageControl',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageControl',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageControl',
          fieldId: 'strength',
        },
        {
          portId: 'control_image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageControl',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageControl',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxCannyPipeline:control_inpaint',
    definitionContentHash: 'sha256:1f881aa2f6ce3adc0fd17276c87061e1cd1cc24cf08f3ebc155eea159bf48cea',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxCannyPipeline',
    workflowId: 'control_inpaint',
    admissionId: 'diffusers.cluster-admission:FluxCannyPipeline:control_inpaint:mode:control_inpaint',
    studioMode: 'control_inpaint',
    adapterContractId: 'diffusers.composite-adapter:FluxCannyPipeline:control_inpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-63751d1d',
      executionProfileId: 'flux-canny:inpaint-direct',
      id: 'flux-canny:control-inpaint:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Canny-dev',
      revision: '27c3d8bdc17509b47cf4fd9ba25ab1c7508a69a2',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-1cf8b8c5',
    compiledDefinitionCanonicalSha256: 'sha256:4122f162e39cf843cd5fe82bdeba060d4d8114ec62722c0f684710b066eab883',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
      {
        source: 'alphaMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'loadControlImage',
          fieldId: 'alpha_channel',
        },
        mirrors: [
          {
            role: 'loadImage',
            fieldId: 'alpha_channel',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageControlInpaint',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageControlInpaint',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageControlInpaint',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageControlInpaint',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageControlInpaint',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageControlInpaint',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageControlInpaint',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageControlInpaint',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'mask_image',
          role: 'loadMask',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'control_image',
          role: 'loadControlImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageControlInpaint',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageControlInpaint',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxDepthPipeline:control_edit_image',
    definitionContentHash: 'sha256:853a6f55d409785e6bfa11a743e2d653af62fa115082d2a11f90ebd6e7be3b59',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxDepthPipeline',
    workflowId: 'control_edit_image',
    admissionId: 'diffusers.cluster-admission:FluxDepthPipeline:control_edit_image:mode:control_edit_image',
    studioMode: 'control_edit_image',
    adapterContractId: 'diffusers.composite-adapter:FluxDepthPipeline:control_edit_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-c2458182',
      executionProfileId: 'flux-depth:img2img-direct',
      id: 'flux-depth:control-edit-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Depth-dev',
      revision: 'fb5e9b1bae41b8c8adcea4ea2a87b74dd298f07a',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-6e24551c',
    compiledDefinitionCanonicalSha256: 'sha256:1bcbf021bf21dce8c267a0a1cf998ef49f715ea98462f84ce829fbfc3595ac9e',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
      {
        source: 'alphaMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'loadControlImage',
          fieldId: 'alpha_channel',
        },
        mirrors: [
          {
            role: 'loadImage',
            fieldId: 'alpha_channel',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageControlEdit',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageControlEdit',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageControlEdit',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageControlEdit',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageControlEdit',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageControlEdit',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageControlEdit',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageControlEdit',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'control_image',
          role: 'loadControlImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageControlEdit',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageControlEdit',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxDepthPipeline:control_image',
    definitionContentHash: 'sha256:a15e334654d612cc47e6684b756e9a971a97324cedda26a5800f4582ec754b72',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxDepthPipeline',
    workflowId: 'control_image',
    admissionId: 'diffusers.cluster-admission:FluxDepthPipeline:control_image:mode:control_image',
    studioMode: 'control_image',
    adapterContractId: 'diffusers.composite-adapter:FluxDepthPipeline:control_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-2d8b881e',
      executionProfileId: 'flux-depth:direct',
      id: 'flux-depth:control-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Depth-dev',
      revision: 'fb5e9b1bae41b8c8adcea4ea2a87b74dd298f07a',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-f9c53806',
    compiledDefinitionCanonicalSha256: 'sha256:1e33f86add517386c4fd074b8959c23d7c6d21cbc6bacbdb9fc4f2956eeec967',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageControl',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageControl',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageControl',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageControl',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageControl',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageControl',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageControl',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageControl',
          fieldId: 'strength',
        },
        {
          portId: 'control_image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageControl',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageControl',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxDepthPipeline:control_inpaint',
    definitionContentHash: 'sha256:2b2079898164153a3f1a5c406a890498bb6e27cd4c81b08f6e2fceb524291b5e',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxDepthPipeline',
    workflowId: 'control_inpaint',
    admissionId: 'diffusers.cluster-admission:FluxDepthPipeline:control_inpaint:mode:control_inpaint',
    studioMode: 'control_inpaint',
    adapterContractId: 'diffusers.composite-adapter:FluxDepthPipeline:control_inpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-83bdeae9',
      executionProfileId: 'flux-depth:inpaint-direct',
      id: 'flux-depth:control-inpaint:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Depth-dev',
      revision: 'fb5e9b1bae41b8c8adcea4ea2a87b74dd298f07a',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-6cfdb7d0',
    compiledDefinitionCanonicalSha256: 'sha256:1983d8d34d4438ab2e0a8c70d3333b065eff7a01cb80e02b2c06963e3a0fa5ce',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
      {
        source: 'alphaMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'loadControlImage',
          fieldId: 'alpha_channel',
        },
        mirrors: [
          {
            role: 'loadImage',
            fieldId: 'alpha_channel',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageControlInpaint',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageControlInpaint',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageControlInpaint',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageControlInpaint',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageControlInpaint',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageControlInpaint',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageControlInpaint',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageControlInpaint',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'mask_image',
          role: 'loadMask',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'control_image',
          role: 'loadControlImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageControlInpaint',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageControlInpaint',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxDevPipeline:inpaint',
    definitionContentHash: 'sha256:b4abc6b33a452836d940ddfe27081bb79271c89503ffde4a14eceef9badfcea8',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxDevPipeline',
    workflowId: 'inpaint',
    admissionId: 'diffusers.cluster-admission:FluxDevPipeline:inpaint:mode:inpaint',
    studioMode: 'inpaint',
    adapterContractId: 'diffusers.composite-adapter:FluxDevPipeline:inpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-7b10a864',
      executionProfileId: 'flux-dev:inpaint-direct',
      id: 'flux-dev:inpaint:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-dev',
      revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-a5c838e6',
    compiledDefinitionCanonicalSha256: 'sha256:594e9af95e6ccc95c07de5d6a1697f7591769e53bf9384c8ca82160a48e387b6',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageInpaint',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageInpaint',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageInpaint',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageInpaint',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageInpaint',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageInpaint',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageInpaint',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageInpaint',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'mask_image',
          role: 'loadMask',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageInpaint',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageInpaint',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxFillPipeline:inpaint',
    definitionContentHash: 'sha256:2e96262480e3212697f613b7598e298ca20148a3aceb4a09e4049090943f84b3',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxFillPipeline',
    workflowId: 'inpaint',
    admissionId: 'diffusers.cluster-admission:FluxFillPipeline:inpaint:mode:inpaint',
    studioMode: 'inpaint',
    adapterContractId: 'diffusers.composite-adapter:FluxFillPipeline:inpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-ba8c8dd1',
      executionProfileId: 'flux-fill:direct',
      id: 'flux-fill:inpaint:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Fill-dev',
      revision: '358293da0354175698b67ec8299acf928313a78a',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-9149e19b',
    compiledDefinitionCanonicalSha256: 'sha256:098bda647da6e81d26e5e1ee5944bdd4f71c8a9365b33f6702a082d40f74b6db',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageInpaint',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageInpaint',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageInpaint',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageInpaint',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageInpaint',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageInpaint',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageInpaint',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageInpaint',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'mask_image',
          role: 'loadMask',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageInpaint',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageInpaint',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxFillPipeline:outpaint',
    definitionContentHash: 'sha256:46fb798e3493877969853f4b435839451f5a726c273689ea05f8e412974c1c34',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxFillPipeline',
    workflowId: 'outpaint',
    admissionId: 'diffusers.cluster-admission:FluxFillPipeline:outpaint:mode:outpaint',
    studioMode: 'outpaint',
    adapterContractId: 'diffusers.composite-adapter:FluxFillPipeline:outpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-5c0d7413',
      executionProfileId: 'flux-fill:direct',
      id: 'flux-fill:outpaint:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Fill-dev',
      revision: '358293da0354175698b67ec8299acf928313a78a',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-67da74df',
    compiledDefinitionCanonicalSha256: 'sha256:7c20ce4ba385736764b3ca316482af513937acc3dcf0bd831d71fddd1c262db4',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageInpaint',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageInpaint',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageInpaint',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageInpaint',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageInpaint',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageInpaint',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageInpaint',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageInpaint',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'mask_image',
          role: 'loadMask',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageInpaint',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageInpaint',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxKontextInpaintPipeline:inpaint',
    definitionContentHash: 'sha256:a40d5b1b6c628bd7a5c9e609f71e5e4cce66345b8b689185fbef16417f3132de',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxKontextInpaintPipeline',
    workflowId: 'inpaint',
    admissionId: 'diffusers.cluster-admission:FluxKontextInpaintPipeline:inpaint:mode:inpaint',
    studioMode: 'inpaint',
    adapterContractId: 'diffusers.composite-adapter:FluxKontextInpaintPipeline:inpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-934bf941',
      executionProfileId: 'flux-kontext-inpaint:direct',
      id: 'flux-kontext-inpaint-direct:inpaint:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Kontext-dev',
      revision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-e0b1bb44',
    compiledDefinitionCanonicalSha256: 'sha256:2283b3caf074609af77bc391b045ec1dcab5384b65c24ba9c0854790be5881cd',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageInpaint',
          fieldId: 'prompt',
        },
        {
          portId: 'negative_prompt',
          role: 'diffusersImageInpaint',
          fieldId: 'negative_prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageInpaint',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageInpaint',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageInpaint',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageInpaint',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageInpaint',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageInpaint',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageInpaint',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'mask_image',
          role: 'loadMask',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageInpaint',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageInpaint',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxKontextInpaintPipeline:outpaint',
    definitionContentHash: 'sha256:14695ea95dc5f4eac7aa7d6d9adf6fade7c2107e011c0f7204ba52b343070eb8',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxKontextInpaintPipeline',
    workflowId: 'outpaint',
    admissionId: 'diffusers.cluster-admission:FluxKontextInpaintPipeline:outpaint:mode:outpaint',
    studioMode: 'outpaint',
    adapterContractId: 'diffusers.composite-adapter:FluxKontextInpaintPipeline:outpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-c334b4d4',
      executionProfileId: 'flux-kontext-inpaint:direct',
      id: 'flux-kontext-inpaint-direct:outpaint:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Kontext-dev',
      revision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-4a6d957d',
    compiledDefinitionCanonicalSha256: 'sha256:f8004b1d8cf8e6f0235732b999e7bb01e6268612633f8681bcec5f32d4929afc',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
      {
        source: 'width',
        persistence: 'instance_input',
        primary: {
          role: 'diffusersImageInpaint',
          fieldId: 'width',
        },
        mirrors: [
          {
            role: 'outpaintCanvas',
            fieldId: 'width',
          },
        ],
      },
      {
        source: 'height',
        persistence: 'instance_input',
        primary: {
          role: 'diffusersImageInpaint',
          fieldId: 'height',
        },
        mirrors: [
          {
            role: 'outpaintCanvas',
            fieldId: 'height',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageInpaint',
          fieldId: 'prompt',
        },
        {
          portId: 'negative_prompt',
          role: 'diffusersImageInpaint',
          fieldId: 'negative_prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageInpaint',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageInpaint',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageInpaint',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageInpaint',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageInpaint',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageInpaint',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'strength',
          role: 'diffusersImageInpaint',
          fieldId: 'strength',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageInpaint',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageInpaint',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxKontextPipeline:multi_image_reference_edit',
    definitionContentHash: 'sha256:fdbdb56d5f8b2b1ce2dae0e4a2e4c5b7a61c6c1acea3b86dca19809b0c21ec66',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxKontextPipeline',
    workflowId: 'multi_image_reference_edit',
    admissionId:
      'diffusers.cluster-admission:FluxKontextPipeline:multi_image_reference_edit:mode:multi_image_reference_edit',
    studioMode: 'multi_image_reference_edit',
    adapterContractId: 'diffusers.composite-adapter:FluxKontextPipeline:multi_image_reference_edit',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-aa060039',
      executionProfileId: 'flux-kontext:direct',
      id: 'flux-kontext:multi-image-reference-edit:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Kontext-dev',
      revision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-5b641bcf',
    compiledDefinitionCanonicalSha256: 'sha256:755025563ed410e5d771d3a7073bcbd98eca079a6335bfc215cec1d357515d88',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageEdit',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageEdit',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageEdit',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageEdit',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageEdit',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageEdit',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageEdit',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageEdit',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageEdit',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxKreaPipeline:text_to_image',
    definitionContentHash: 'sha256:154664787fcde978425bfe5eacc44c8be1598a9e167e29b25ff4d0918204d5cb',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxKreaPipeline',
    workflowId: 'text_to_image',
    admissionId: 'diffusers.cluster-admission:FluxKreaPipeline:text_to_image:mode:text_to_image',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.composite-adapter:FluxKreaPipeline:text_to_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-34a1abeb',
      executionProfileId: 'flux-krea:direct',
      id: 'flux-krea:text-to-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Krea-dev',
      revision: '8162a9c7b05a641be098422bf2fcf335615c2f28',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-a3e17bbb',
    compiledDefinitionCanonicalSha256: 'sha256:5729986f06a106e3f05e1a9442e364e9ca56ef1acecaf4636a9560be97cacc17',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageGenerate',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageGenerate',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageGenerate',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageGenerate',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageGenerate',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageGenerate',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageGenerate',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageGenerate',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageGenerate',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxReduxPipeline:edit_image',
    definitionContentHash: 'sha256:d8447b36122b769079b30e3eed6447b6bcc2d85de3f8ed715f102638ca95229c',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxReduxPipeline',
    workflowId: 'edit_image',
    admissionId: 'diffusers.cluster-admission:FluxReduxPipeline:edit_image:mode:edit_image',
    studioMode: 'edit_image',
    adapterContractId: 'diffusers.composite-adapter:FluxReduxPipeline:edit_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-18e2c4ac',
      executionProfileId: 'flux-redux:direct',
      id: 'flux-redux:edit-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Redux-dev',
      revision: 'c95859fbf7703ca4d6824b4da4407d7cd0434f81',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-afbbccfe',
    compiledDefinitionCanonicalSha256: 'sha256:8e718443c284fd7e053cf3e61909fd73e1251d7e6ffc662fb816f36dddd19214',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageEdit',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageEdit',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageEdit',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageEdit',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageEdit',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageEdit',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageEdit',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageEdit',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageEdit',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxReduxPipeline:multi_image_reference_edit',
    definitionContentHash: 'sha256:edc7fb9cf3ffa7ee33e23fe5c8e0381602ba07465a52390d9e75f22f0a4c7723',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxReduxPipeline',
    workflowId: 'multi_image_reference_edit',
    admissionId:
      'diffusers.cluster-admission:FluxReduxPipeline:multi_image_reference_edit:mode:multi_image_reference_edit',
    studioMode: 'multi_image_reference_edit',
    adapterContractId: 'diffusers.composite-adapter:FluxReduxPipeline:multi_image_reference_edit',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-a798155c',
      executionProfileId: 'flux-redux:direct',
      id: 'flux-redux:multi-image-reference-edit:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Redux-dev',
      revision: 'c95859fbf7703ca4d6824b4da4407d7cd0434f81',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-0aa2430d',
    compiledDefinitionCanonicalSha256: 'sha256:211abd8d67d61e235ad50b9032d00639ecb6aa22b8e1939fffc453e3958dbf64',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageEdit',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageEdit',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageEdit',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageEdit',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageEdit',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageEdit',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageEdit',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageEdit',
          fieldId: 'output_type',
        },
        {
          portId: 'reference_strength',
          role: 'diffusersImageEdit',
          fieldId: 'reference_strength',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageEdit',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:FluxSchnellPipeline:text_to_image',
    definitionContentHash: 'sha256:31829bdf6703a057fa71d79265bb976ba02324ac6880572a7f19b949cdf2e705',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'FluxSchnellPipeline',
    workflowId: 'text_to_image',
    admissionId: 'diffusers.cluster-admission:FluxSchnellPipeline:text_to_image:mode:text_to_image',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.composite-adapter:FluxSchnellPipeline:text_to_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-9cd1abb5',
      executionProfileId: 'flux-schnell:direct',
      id: 'flux-schnell:text-to-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-schnell',
      revision: '741f7c3ce8b383c54771c7003378a50191e9efe9',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-c034a389',
    compiledDefinitionCanonicalSha256: 'sha256:d99e092d1635dfa72e28f2aa63003e339b8ef2eb69a25f128db85e6509680f92',
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'quantization_mode',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'backend',
          },
        ],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'dtype',
        },
        mirrors: [
          {
            role: 'diffusersQuantization',
            fieldId: 'dtype',
          },
        ],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'offload_mode',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'offload_mode',
          },
        ],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: {
          role: 'diffusersImagePipeline',
          fieldId: 'device',
        },
        mirrors: [
          {
            role: 'diffusersRecipe',
            fieldId: 'device',
          },
        ],
      },
    ],
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'diffusersImageGenerate',
          fieldId: 'prompt',
        },
        {
          portId: 'width',
          role: 'diffusersImageGenerate',
          fieldId: 'width',
        },
        {
          portId: 'height',
          role: 'diffusersImageGenerate',
          fieldId: 'height',
        },
        {
          portId: 'num_inference_steps',
          role: 'diffusersImageGenerate',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'diffusersImageGenerate',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'seed',
          role: 'diffusersImageGenerate',
          fieldId: 'seed',
        },
        {
          portId: 'max_sequence_length',
          role: 'diffusersImageGenerate',
          fieldId: 'max_sequence_length',
        },
        {
          portId: 'output_type',
          role: 'diffusersImageGenerate',
          fieldId: 'output_type',
        },
      ],
      outputs: [
        {
          portId: 'images',
          role: 'diffusersImageGenerate',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  },
];
