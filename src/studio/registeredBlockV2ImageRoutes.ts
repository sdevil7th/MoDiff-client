// Exact reviewed ordinary-image composite routes; not upstream Modular hierarchies.
import type { RegisteredBlockV2Route } from './registeredBlockV2Routes';

export const REGISTERED_BLOCK_V2_IMAGE_ROUTES: readonly RegisteredBlockV2Route[] = [
  {
    definitionId: 'diffusers.composite:Flux2KleinKVPipeline:edit_image',
    definitionContentHash: 'sha256:1fda4a421dfec461143cb30d37b671e46db8bd1792e392503053a37a45d11f8f',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
    pipelineClass: 'Flux2KleinKVPipeline',
    workflowId: 'edit_image',
    admissionId: 'diffusers.cluster-admission:Flux2KleinKVPipeline:edit_image:mode:edit_image',
    studioMode: 'edit_image',
    adapterContractId: 'diffusers.composite-adapter:Flux2KleinKVPipeline:edit_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-f41b4ff1',
      executionProfileId: 'flux2-klein-kv:direct',
      id: 'flux2-klein-kv:edit-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.2-klein-9b-kv',
      revision: 'a6dfb36eca3a3906eb2fd460795adfb844e5fcce',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-128b7e27',
    compiledDefinitionCanonicalSha256: 'sha256:4c97573e9f09e33dd3f4ca5fa92caa6a71332e227e0f2575edb59e8a24f6ec7b',
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
    definitionId: 'diffusers.composite:Flux2KleinKVPipeline:multi_image_reference_edit',
    definitionContentHash: 'sha256:5946ff18a5dde271dfd1870b7597b73cf391d8a322f379f71e6a8599e4adcd93',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
    pipelineClass: 'Flux2KleinKVPipeline',
    workflowId: 'multi_image_reference_edit',
    admissionId:
      'diffusers.cluster-admission:Flux2KleinKVPipeline:multi_image_reference_edit:mode:multi_image_reference_edit',
    studioMode: 'multi_image_reference_edit',
    adapterContractId: 'diffusers.composite-adapter:Flux2KleinKVPipeline:multi_image_reference_edit',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-e68f9261',
      executionProfileId: 'flux2-klein-kv:direct',
      id: 'flux2-klein-kv:multi-image-reference-edit:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.2-klein-9b-kv',
      revision: 'a6dfb36eca3a3906eb2fd460795adfb844e5fcce',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-4ea6fac1',
    compiledDefinitionCanonicalSha256: 'sha256:29c86eb53eb9bc383017c78f93a6f83323b8fe9c190690d2c9468089b155f66a',
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
    definitionId: 'diffusers.composite:Flux2KleinKVPipeline:text_to_image',
    definitionContentHash: 'sha256:d6d33b4746508cc5645a9625b42d3773c1b89ccd510118cd31bfa4f780e01baa',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
    pipelineClass: 'Flux2KleinKVPipeline',
    workflowId: 'text_to_image',
    admissionId: 'diffusers.cluster-admission:Flux2KleinKVPipeline:text_to_image:mode:text_to_image',
    studioMode: 'text_to_image',
    adapterContractId: 'diffusers.composite-adapter:Flux2KleinKVPipeline:text_to_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-181611de',
      executionProfileId: 'flux2-klein-kv:direct',
      id: 'flux2-klein-kv:text-to-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.2-klein-9b-kv',
      revision: 'a6dfb36eca3a3906eb2fd460795adfb844e5fcce',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-7b195a35',
    compiledDefinitionCanonicalSha256: 'sha256:db3a4e598d825a308d89c3120027941609914d8584d2ddcb3289591778f73c55',
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
    definitionId: 'diffusers.composite:FluxControlNetImg2ImgPipeline:control_edit_image',
    definitionContentHash: 'sha256:9987ec6b7ffc97a8a4b928332d7e58167fd6efc92f5548a18d2a0d14208e9e71',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
    pipelineClass: 'FluxControlNetImg2ImgPipeline',
    workflowId: 'control_edit_image',
    admissionId: 'diffusers.cluster-admission:FluxControlNetImg2ImgPipeline:control_edit_image:mode:control_edit_image',
    studioMode: 'control_edit_image',
    adapterContractId: 'diffusers.composite-adapter:FluxControlNetImg2ImgPipeline:control_edit_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-af00fead',
      executionProfileId: 'flux-controlnet:control_edit_image:direct',
      id: 'flux-controlnet:control-edit-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-dev',
      revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-5c79ef1a',
    compiledDefinitionCanonicalSha256: 'sha256:456d106b05b927edca75ecc053c7ccd44c2343e676da02e463eb948a7e64e25f',
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
          portId: 'conditioning_scale',
          role: 'diffusersImageControlEdit',
          fieldId: 'conditioning_scale',
        },
        {
          portId: 'control_guidance_start',
          role: 'diffusersImageControlEdit',
          fieldId: 'control_guidance_start',
        },
        {
          portId: 'control_guidance_end',
          role: 'diffusersImageControlEdit',
          fieldId: 'control_guidance_end',
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
    definitionId: 'diffusers.composite:FluxControlNetInpaintPipeline:control_inpaint',
    definitionContentHash: 'sha256:7084dd7161c97b95221e6669e77bfcbf2abe3921a08c705651ccaed9c6b6b6f8',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
    pipelineClass: 'FluxControlNetInpaintPipeline',
    workflowId: 'control_inpaint',
    admissionId: 'diffusers.cluster-admission:FluxControlNetInpaintPipeline:control_inpaint:mode:control_inpaint',
    studioMode: 'control_inpaint',
    adapterContractId: 'diffusers.composite-adapter:FluxControlNetInpaintPipeline:control_inpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-6046b516',
      executionProfileId: 'flux-controlnet:control_inpaint:direct',
      id: 'flux-controlnet:control-inpaint:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-dev',
      revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-56a63dd8',
    compiledDefinitionCanonicalSha256: 'sha256:53b16cb361adae1d5c2d7c8d91a614cefc86d39d00dcd2c410595c27babb31f4',
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
          portId: 'conditioning_scale',
          role: 'diffusersImageControlInpaint',
          fieldId: 'conditioning_scale',
        },
        {
          portId: 'control_guidance_start',
          role: 'diffusersImageControlInpaint',
          fieldId: 'control_guidance_start',
        },
        {
          portId: 'control_guidance_end',
          role: 'diffusersImageControlInpaint',
          fieldId: 'control_guidance_end',
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
    definitionId: 'diffusers.composite:FluxControlNetPipeline:control_image',
    definitionContentHash: 'sha256:d4039ab110b37eaab96f82b10902341cf2e533108d0368bea791d0061e242acb',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
    pipelineClass: 'FluxControlNetPipeline',
    workflowId: 'control_image',
    admissionId: 'diffusers.cluster-admission:FluxControlNetPipeline:control_image:mode:control_image',
    studioMode: 'control_image',
    adapterContractId: 'diffusers.composite-adapter:FluxControlNetPipeline:control_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-2ea8d206',
      executionProfileId: 'flux-controlnet:control_image:direct',
      id: 'flux-controlnet:control-image:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-dev',
      revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-0ab14aa7',
    compiledDefinitionCanonicalSha256: 'sha256:d3b2944e1c7db016cecc7fa39ca8af39ee876c0bc7fdcab4baf7500e7b8ad54c',
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
          portId: 'negative_prompt',
          role: 'diffusersImageControl',
          fieldId: 'negative_prompt',
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
          portId: 'conditioning_scale',
          role: 'diffusersImageControl',
          fieldId: 'conditioning_scale',
        },
        {
          portId: 'control_guidance_start',
          role: 'diffusersImageControl',
          fieldId: 'control_guidance_start',
        },
        {
          portId: 'control_guidance_end',
          role: 'diffusersImageControl',
          fieldId: 'control_guidance_end',
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
];
