// Exact reviewed ordinary-image composite routes; not upstream Modular hierarchies.
import type { RegisteredBlockV2Route } from './registeredBlockV2Routes';

export const REGISTERED_BLOCK_V2_IMAGE_ROUTES: readonly RegisteredBlockV2Route[] = [
  {
    definitionId: 'diffusers.composite:Flux2KleinKVPipeline:edit_image',
    definitionContentHash: 'sha256:ca2fb371f260a8f3b690284ecd12f800505d618a176b582ae36cd2c915eb8ed4',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-fc52c390',
    compiledDefinitionCanonicalSha256: 'sha256:8ad85392ea447b287ac19cd67f67c065b3c5e2316ea8beaa9ea86490300f7c33',
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
    definitionContentHash: 'sha256:8cdf6fb33de7d24d695a9ce87b9b237f8de66e6fdabeccf14c11a559f005149e',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-6d5da01d',
    compiledDefinitionCanonicalSha256: 'sha256:943f327b1b6e103da60e455052cd8c75be8a03a3888250489d77249297d8acc2',
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
    definitionContentHash: 'sha256:c74a9871820add61078b8ec125200afedd3eae938a485ed3c10ee271f47d5cd0',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-ef34d7b2',
    compiledDefinitionCanonicalSha256: 'sha256:fe9f52bf3a5e4c9c5f62931c6e7eeeb5e4bfeaecd7d8398a59df49e95f7d9b64',
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
    definitionContentHash: 'sha256:6037a9442f357ca32f3dbb545556e8fa89658d3f5afe3e1628dd0fc52d7e1080',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-b29434ec',
    compiledDefinitionCanonicalSha256: 'sha256:97a5dee1ced951799be07a767a51248bb6a35cb3e2f6b6dd8a17ae31c55c4adf',
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
    definitionContentHash: 'sha256:8e560173f5110301cbfdb8d9e8db1d367ed3b98d636a22ebe0f8f4eee869791c',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-96edfc16',
    compiledDefinitionCanonicalSha256: 'sha256:d8cf5b00c1f28224e2c327dddbb18f1d3c9c58dbb5794f3f91ffbf24118e5ed4',
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
    definitionContentHash: 'sha256:bdfe72e92e2aa94c896fb2b49ef2ebdbcc59a95f11ab6ababbc6273d83bbe5dd',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-4e36b75f',
    compiledDefinitionCanonicalSha256: 'sha256:4993875deda3899e1d63a386c19e4bce829aff9ff38d2ce4293f1e4ed509f84e',
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
