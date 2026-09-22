// Exact reviewed ordinary task recipes. These are not Modular Diffusers hierarchies.
import type { RegisteredBlockV2Route } from './registeredBlockV2Routes';

export const REGISTERED_BLOCK_V2_ORDINARY_FLUX_ROUTES: readonly RegisteredBlockV2Route[] = [
  {
    definitionId: 'diffusers.composite:Flux2KleinInpaintPipeline:inpaint',
    definitionContentHash: 'sha256:8ce41b556a9363e4a17409b33202d1a9eac3bf68f19e7a755c3b1ecfbef53016',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-f227815a',
    compiledDefinitionCanonicalSha256: 'sha256:97f8535b12eacd0ce539747a4c0f06d2b715893822ba0aa65ee1fbbd14586d8e',
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
    definitionContentHash: 'sha256:0774209393c8f5baa3a1f0825c66e8b5982c4f57d63661b7228a3f4e113c533d',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-118a2cfb',
    compiledDefinitionCanonicalSha256: 'sha256:14b374310d6bac8eca6c431f8ded301ec92fa380706fd5878cc349e7597f8d69',
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
    definitionContentHash: 'sha256:dd288beb54fafd8136b5644e4b6cd8eac3ce5d5e9d51fd5626488585d4ee3199',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-f2a333c8',
    compiledDefinitionCanonicalSha256: 'sha256:1aa7492fca1323d6d155f5262b123dc8c3f35d0293114f1a6ce725d62e4e3fa4',
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
    definitionContentHash: 'sha256:1a009872fb9d1f72c5cc38e1dc368d9514649e2e1cbb6dc1cf85ea6393a4f8f5',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-1561e5d5',
    compiledDefinitionCanonicalSha256: 'sha256:106061c723cea53b582b01e5713fdfb7653dccaa715e9623a1164aa1f2e6d83c',
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
    definitionContentHash: 'sha256:e8e30654d5f1a8d96bb4bae77a0d4708c6a0cdb1ad00508575844fe02d540245',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-38aece89',
    compiledDefinitionCanonicalSha256: 'sha256:7d4fce8660af9c371be2717037fcca75d505c6f5352a5127ba15727953dff5c2',
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
    definitionContentHash: 'sha256:d611f2cbf5f1964dbd8cf0d27ee87b43c00ebeffe1aa3e2d6f6c18802b479d01',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-7b909946',
    compiledDefinitionCanonicalSha256: 'sha256:ad66946ff8b50ad9587873f65360a8cfc72ac7437f6a18d69be930b71718bbb1',
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
    definitionContentHash: 'sha256:4adea08aa4c85a5dd486ef360ebd1fa72308ce5fec1ac5a6b5f64bae503cc539',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-9a670828',
    compiledDefinitionCanonicalSha256: 'sha256:f1ba05d2dbd51efe73e1fbac6331a19295c75ed2456e326508eb048016cad741',
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
    definitionContentHash: 'sha256:e043c96e307a3b770247e0c77c8264263077ccd684edce33c419a09d080c8644',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-815c8295',
    compiledDefinitionCanonicalSha256: 'sha256:c429b416c439d6af804d21ddea9a0f3e720f863ef9d206af37dadab1f97c83a6',
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
    definitionContentHash: 'sha256:9c40bc50c9e203a9a1f49b566021394b8d53da354f2e4d1340b21c3cff694011',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-9df200ff',
    compiledDefinitionCanonicalSha256: 'sha256:81e01386eeb5ac3555cb6b7637b06b5625b63c7c3a63488b5cb29094360097f6',
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
    definitionContentHash: 'sha256:dfb1abb9cb811e22176f3712f363046d9bcf3a6ac5afa11580b56b489bc12966',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-ecab355e',
    compiledDefinitionCanonicalSha256: 'sha256:a24c2f655944ace4583b8f05d5b143e59acfa598019f5ebeca8f861bb7ad3b90',
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
    definitionContentHash: 'sha256:e4eb42b4b1f294127fc4084de035b9cea1c7343d4b6db71412507b3f3591cfb2',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-940ed765',
    compiledDefinitionCanonicalSha256: 'sha256:33f239a95da15af8f2c96c044242bf3a0cbc4a1ec39e4a18ef037a575fd3f0a6',
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
    definitionContentHash: 'sha256:fbd324e267bcc5bad1238d0e858e46febad07521bc9f35b9f1709fdfd267e53f',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-80f96f0c',
    compiledDefinitionCanonicalSha256: 'sha256:622ce17696ce82b1c9cc48a207f41cf122f60f60d6075210960e39c9a6a86db4',
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
    definitionContentHash: 'sha256:0a3720727a63b42f81b98f71e199f74c492dd9cdfadb357729ea77c1be268130',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-268977ba',
    compiledDefinitionCanonicalSha256: 'sha256:66c2c27116bda5d733286fe83257e4edde0f0155438d4d0cac5aed22e2516ec3',
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
    definitionContentHash: 'sha256:ed56bb8c987fade2d02786a2189e1366246479d7a6f8de16d638f7325b0c287f',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-f7f6eab2',
    compiledDefinitionCanonicalSha256: 'sha256:64a49ed0b237c9816981b61265335c1039d10d2a69e355a1867055964cc5d6e3',
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
    definitionContentHash: 'sha256:3f101d673b87aa35da363b34b1d71fb7ab090f22f1b5fb2967ce2dc96b9dfa16',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-a231b8e3',
    compiledDefinitionCanonicalSha256: 'sha256:830364f379e47e2cb361412cc0f005af10f787fe74cac389a23e93a07897f1db',
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
    definitionContentHash: 'sha256:ca1fcd513292824c1ca8eda4a029e85f4e58a02de014800088f621c8914cd607',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-b22f5d4c',
    compiledDefinitionCanonicalSha256: 'sha256:9f81deb19476f1aed7c337969182a76891834404cdb45d8ebbe1c30df777fb55',
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
    definitionContentHash: 'sha256:048b424d5e11a0927dd3deb4916467a34a55121a89d9fd74de1c6f885839f468',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-3e6ffb06',
    compiledDefinitionCanonicalSha256: 'sha256:1de00ca864f63f415bd5a60f5b04b0131a79f2acb1e80c6f0820b4ba8611e455',
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
    definitionContentHash: 'sha256:65144e7c60ab0d412956b20bb7c32eb522a386c187bb903f3821c158cd6cff0a',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-a0ca9c31',
    compiledDefinitionCanonicalSha256: 'sha256:73e02e2186436b654b56d5ee0638811dcd953943042ce9931a6289c7a2953b07',
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
    definitionContentHash: 'sha256:df15a0918352cfea0203af283c27529fe2341bdb46f713e66c3368cd5a9e344b',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-a535fac2',
    compiledDefinitionCanonicalSha256: 'sha256:8a3e8bf6d34df5e4be7c025b6ede6af1875f24037f983bf3e0be99cb731d1ddf',
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
    definitionContentHash: 'sha256:c0aee168e821ec2ba4c5e0354c7b2c149cda4b27f1ec08cc51a2fd425cfd76d1',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-be21bb3a',
    compiledDefinitionCanonicalSha256: 'sha256:7b57e1fa1f66e11090ca755afed53512915b01bc4ec91c65699e46b49e9d5c7c',
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
