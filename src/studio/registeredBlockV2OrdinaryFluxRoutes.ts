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
    compiledDefinitionContentHash: 'block-definition-v2-74b490f1',
    compiledDefinitionCanonicalSha256: 'sha256:370d9402d7ea43a81168d9667b8d690bd2b845a1bc46d80c74c850341d2bd169',
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
    compiledDefinitionContentHash: 'block-definition-v2-02a5d275',
    compiledDefinitionCanonicalSha256: 'sha256:66cfe61937e59272f26f91128efb2d25ad4699cfe03a74006efc2ddf9b3e531a',
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
    compiledDefinitionContentHash: 'block-definition-v2-ec33dfa2',
    compiledDefinitionCanonicalSha256: 'sha256:b3bf10a4de4a0ca8b85ae6bff2e751691047635adb352fc8ac8accd3aaef7e1f',
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
    compiledDefinitionContentHash: 'block-definition-v2-e18b5181',
    compiledDefinitionCanonicalSha256: 'sha256:8e3107fcae58954fe2db2625e817f05f84a98463869381ef97ba2491d8ea02cb',
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
    compiledDefinitionContentHash: 'block-definition-v2-4d664fda',
    compiledDefinitionCanonicalSha256: 'sha256:c3b11f0968b00aa840f227c7921f2e0c386320ccbbb5c3b43d06fb1a0291ca45',
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
    compiledDefinitionContentHash: 'block-definition-v2-92cb2f18',
    compiledDefinitionCanonicalSha256: 'sha256:6ca5be9c57b3664ded53b5eba6997d8be7a72512ff7f797309d0541f7a3b24c4',
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
    compiledDefinitionContentHash: 'block-definition-v2-02d0d936',
    compiledDefinitionCanonicalSha256: 'sha256:26b1de3ed37de949303d4fe077361cc7b33868d9071137258a1b0ce66b993fa4',
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
    compiledDefinitionContentHash: 'block-definition-v2-34a2e8de',
    compiledDefinitionCanonicalSha256: 'sha256:97a2c24e429d852fb6664db6040aa6c1026c62675739c52461c7204351ceb52d',
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
    compiledDefinitionContentHash: 'block-definition-v2-e2098085',
    compiledDefinitionCanonicalSha256: 'sha256:347456b53695f0fd0650cd25af90e8afd1aa6ee3c6af23d9d3997193ff893e6d',
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
    compiledDefinitionContentHash: 'block-definition-v2-057db648',
    compiledDefinitionCanonicalSha256: 'sha256:792cc7be1c45c993dfbf7aeaba80facc9e6fec03f9fcf6258b596be6bdcc00a7',
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
    compiledDefinitionContentHash: 'block-definition-v2-b4c27ece',
    compiledDefinitionCanonicalSha256: 'sha256:08baf4a638c718da844ec2a7b2cd9ddc83dd1546b3f71b8dbdd4020dd62eb364',
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
    compiledDefinitionContentHash: 'block-definition-v2-30bd9ae7',
    compiledDefinitionCanonicalSha256: 'sha256:abcedb26d926afa06a78ffc61a81805d4d4a10108949ac68f641ce9fdb196c9d',
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
    compiledDefinitionContentHash: 'block-definition-v2-92c5d708',
    compiledDefinitionCanonicalSha256: 'sha256:68a0f8c415c8710e2d844a1b9b0a5f1a05fe3329c7f34eacc4a7e7fa3c80ce62',
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
    compiledDefinitionContentHash: 'block-definition-v2-dfffaab9',
    compiledDefinitionCanonicalSha256: 'sha256:caa5d40742fea08dd5e6dd3bbb25477cfd5acbd3c48a101cfb39e72d84df4f21',
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
    compiledDefinitionContentHash: 'block-definition-v2-87dc8891',
    compiledDefinitionCanonicalSha256: 'sha256:2d78f2dc7f18f7b21882657bbb86e957fc27cf2d5d415e70687a10f4c5a5ad6e',
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
    compiledDefinitionContentHash: 'block-definition-v2-30cb9120',
    compiledDefinitionCanonicalSha256: 'sha256:979edcbdb2b83f1d2eed972c024f25ddb9b0bce7b619e1a09f9a2fa2524ee874',
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
    compiledDefinitionContentHash: 'block-definition-v2-4dff174b',
    compiledDefinitionCanonicalSha256: 'sha256:a3deed2f40c626f998eeb1ea3acdaa11701351738f54e03d34df9845571d6da2',
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
    compiledDefinitionContentHash: 'block-definition-v2-306484a9',
    compiledDefinitionCanonicalSha256: 'sha256:c16aac54e8e76064fd76ef4b1ecee002785d0c8d92e5d89e88510d978040f401',
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
