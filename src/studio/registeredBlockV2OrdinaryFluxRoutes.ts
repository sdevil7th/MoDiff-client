// Exact reviewed ordinary task recipes. These are not Modular Diffusers hierarchies.
import type { RegisteredBlockV2Route } from './registeredBlockV2Routes';

export const REGISTERED_BLOCK_V2_ORDINARY_FLUX_ROUTES: readonly RegisteredBlockV2Route[] = [
  {
    definitionId: 'diffusers.composite:Flux2KleinInpaintPipeline:inpaint',
    definitionContentHash: 'sha256:974f7e18bfe6a6b09d0b7a5c4ac53a52bac87c406b28d494bf5ce960f67a80b2',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-714c664e',
    compiledDefinitionCanonicalSha256: 'sha256:138fedbe8d0ffea87922d532e80e027accf7ea183c924c830724cc20a6221258',
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
    definitionContentHash: 'sha256:0bc5747671ed6282554c5641b5901dcc3ec9f8b4f60660dbc6098dbfc6ec4b51',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-2d9bba9b',
    compiledDefinitionCanonicalSha256: 'sha256:726ec7983d11969948227615cead149a6e3c5ab3f0b2b5fb48929e5e51645028',
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
    definitionContentHash: 'sha256:ea2dae4f45633836a13b1f179894b283fdec6731c773e8a1c61f180976db0cd7',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
    pipelineClass: 'Flux2KleinPipeline',
    workflowId: 'multi_image_reference_edit',
    admissionId:
      'diffusers.cluster-admission:Flux2KleinPipeline:multi_image_reference_edit:mode:multi_image_reference_edit',
    studioMode: 'multi_image_reference_edit',
    adapterContractId: 'diffusers.composite-adapter:Flux2KleinPipeline:multi_image_reference_edit',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-e7cd0b3f',
      executionProfileId: 'flux2-klein:direct',
      id: 'flux2-klein:multi-image-reference-edit:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.2-klein-4B',
      revision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-67080998',
    compiledDefinitionCanonicalSha256: 'sha256:b49f492d1f6924b439ba9042ea71c89bcefb7b9ca5dfb449a02d18d972ef2cd1',
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
    definitionContentHash: 'sha256:01c1638ece748db5fb1a4457a985ee30c73bb1875f8a8e953bfcba54502983b2',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-4d3854f2',
    compiledDefinitionCanonicalSha256: 'sha256:d7637dc642a304026a96c011de3df1e457cff1741f3c4d60d64d680690114ea9',
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
    definitionContentHash: 'sha256:710e351acb4338c0bdcc3412f2f3fd3efc9ab2916b07b61f62c37c16732b11f2',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-f1e2b9ee',
    compiledDefinitionCanonicalSha256: 'sha256:69e7bb74250e3f985a8994791c21036e963ecc1a63d16ec11bb47ddbba1f139b',
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
    definitionContentHash: 'sha256:34af4cebd5c19f37ceafbe37c140a23d46a03df404414f18171fe4c028336af5',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
    pipelineClass: 'FluxCannyPipeline',
    workflowId: 'control_image',
    admissionId: 'diffusers.cluster-admission:FluxCannyPipeline:control_image:mode:control_image',
    studioMode: 'control_image',
    adapterContractId: 'diffusers.composite-adapter:FluxCannyPipeline:control_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-3771b29f',
      executionProfileId: 'flux-canny:direct',
      id: 'flux-canny:control-image:v1',
    },
    artifact: { repo: 'black-forest-labs/FLUX.1-Canny-dev', revision: '27c3d8bdc17509b47cf4fd9ba25ab1c7508a69a2' },
    dynamicFieldActions: [],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'imageEncode', fieldId: 'prompt' },
        { portId: 'width', role: 'denoise', fieldId: 'width' },
        { portId: 'height', role: 'denoise', fieldId: 'height' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
        { portId: 'guidance_scale', role: 'denoise', fieldId: 'guidance_scale' },
        { portId: 'seed', role: 'denoise', fieldId: 'seed' },
        { portId: 'max_sequence_length', role: 'denoise', fieldId: 'max_sequence_length' },
        { portId: 'strength', role: 'denoise', fieldId: 'strength' },
        {
          portId: 'control_image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        { portId: 'output_type', role: 'decode', fieldId: 'output_type' },
      ],
      outputs: [
        { portId: 'images', role: 'decode', fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' },
      ],
    },
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'quantization_mode' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'backend' }],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'dtype' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'dtype' }],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'offload_mode' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'offload_mode' }],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'device' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'device' }],
      },
      {
        source: 'width',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'width' },
        mirrors: [{ role: 'imageEncode', fieldId: 'width' }],
      },
      {
        source: 'height',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'height' },
        mirrors: [{ role: 'imageEncode', fieldId: 'height' }],
      },
      {
        source: 'seed',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'seed' },
        mirrors: [{ role: 'imageEncode', fieldId: 'seed' }],
      },
      {
        source: 'maxSequenceLength',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'max_sequence_length' },
        mirrors: [{ role: 'imageEncode', fieldId: 'max_sequence_length' }],
      },
    ],
    compiledDefinitionContentHash: 'block-definition-v2-0bffa507',
    compiledDefinitionCanonicalSha256: 'sha256:5e83ddcac83464d438bfaa969c003ac3f8d42aa5c9b633d97f019d04cf3d95a5',
  },
  {
    definitionId: 'diffusers.composite:FluxCannyPipeline:control_inpaint',
    definitionContentHash: 'sha256:e6be9efb2d2b4e02beec674bb16b0991971f78822c4f1509204cd5cd4e40a344',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-0c46a3db',
    compiledDefinitionCanonicalSha256: 'sha256:7a5070974aa8bbcbdb64f896db669154436101da801495cd1a7dd999bf537aed',
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
    definitionContentHash: 'sha256:4b8037b717fb94b5f5bdc3bd50c687be180010aa888548f9cfd11fcf3761ee25',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-ec261dff',
    compiledDefinitionCanonicalSha256: 'sha256:8d44b429a67a128ff3af1ba5391033bd7820ffb4a089ad5a6ae077365007a195',
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
    definitionContentHash: 'sha256:101c1fcdd5ce375df43f8c3aa4a37a278568d649c2e206b215ba52c1ed5ad47a',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
    pipelineClass: 'FluxDepthPipeline',
    workflowId: 'control_image',
    admissionId: 'diffusers.cluster-admission:FluxDepthPipeline:control_image:mode:control_image',
    studioMode: 'control_image',
    adapterContractId: 'diffusers.composite-adapter:FluxDepthPipeline:control_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-220321e3',
      executionProfileId: 'flux-depth:direct',
      id: 'flux-depth:control-image:v1',
    },
    artifact: { repo: 'black-forest-labs/FLUX.1-Depth-dev', revision: 'fb5e9b1bae41b8c8adcea4ea2a87b74dd298f07a' },
    dynamicFieldActions: [],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'imageEncode', fieldId: 'prompt' },
        { portId: 'width', role: 'denoise', fieldId: 'width' },
        { portId: 'height', role: 'denoise', fieldId: 'height' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
        { portId: 'guidance_scale', role: 'denoise', fieldId: 'guidance_scale' },
        { portId: 'seed', role: 'denoise', fieldId: 'seed' },
        { portId: 'max_sequence_length', role: 'denoise', fieldId: 'max_sequence_length' },
        { portId: 'strength', role: 'denoise', fieldId: 'strength' },
        {
          portId: 'control_image',
          role: 'loadImage',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'image',
        },
        { portId: 'output_type', role: 'decode', fieldId: 'output_type' },
      ],
      outputs: [
        { portId: 'images', role: 'decode', fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' },
      ],
    },
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'quantization_mode' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'backend' }],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'dtype' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'dtype' }],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'offload_mode' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'offload_mode' }],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'device' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'device' }],
      },
      {
        source: 'width',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'width' },
        mirrors: [{ role: 'imageEncode', fieldId: 'width' }],
      },
      {
        source: 'height',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'height' },
        mirrors: [{ role: 'imageEncode', fieldId: 'height' }],
      },
      {
        source: 'seed',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'seed' },
        mirrors: [{ role: 'imageEncode', fieldId: 'seed' }],
      },
      {
        source: 'maxSequenceLength',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'max_sequence_length' },
        mirrors: [{ role: 'imageEncode', fieldId: 'max_sequence_length' }],
      },
    ],
    compiledDefinitionContentHash: 'block-definition-v2-f8f5c0e3',
    compiledDefinitionCanonicalSha256: 'sha256:12fbd2e80db216030bf2c0b06ef9a1be22c6465dd645abb9e1a02484b0f25be5',
  },
  {
    definitionId: 'diffusers.composite:FluxDepthPipeline:control_inpaint',
    definitionContentHash: 'sha256:8428454df1f0920e1c73c7f383bc63e183d39764af73fb2d027966b17fa137c2',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-26780ecb',
    compiledDefinitionCanonicalSha256: 'sha256:abd5358558c4e6e69361ab9f1b13b8809ae25466d2318beb98417a5cdb2fbc0c',
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
    definitionContentHash: 'sha256:acb22997e8f4062b3ae1241998d20da041bde7807a3a77ad79cf4de2bcaafd3f',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-d552db2a',
    compiledDefinitionCanonicalSha256: 'sha256:590ead78ad1014e80f7f05f19b5b62efbb40144de408cbbe8d1b43a8b229a834',
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
    definitionContentHash: 'sha256:2954a0a59522cac2f2b7a8e173439a2ad1146b3650d446e17c71fe5ad7480b20',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
    pipelineClass: 'FluxFillPipeline',
    workflowId: 'inpaint',
    admissionId: 'diffusers.cluster-admission:FluxFillPipeline:inpaint:mode:inpaint',
    studioMode: 'inpaint',
    adapterContractId: 'diffusers.composite-adapter:FluxFillPipeline:inpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-56386076',
      executionProfileId: 'flux-fill:direct',
      id: 'flux-fill:inpaint:v1',
    },
    artifact: { repo: 'black-forest-labs/FLUX.1-Fill-dev', revision: '358293da0354175698b67ec8299acf928313a78a' },
    dynamicFieldActions: [],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'imageEncode', fieldId: 'prompt' },
        { portId: 'width', role: 'denoise', fieldId: 'width' },
        { portId: 'height', role: 'denoise', fieldId: 'height' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
        { portId: 'guidance_scale', role: 'denoise', fieldId: 'guidance_scale' },
        { portId: 'seed', role: 'denoise', fieldId: 'seed' },
        { portId: 'max_sequence_length', role: 'denoise', fieldId: 'max_sequence_length' },
        { portId: 'strength', role: 'denoise', fieldId: 'strength' },
        { portId: 'image', role: 'loadImage', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'image' },
        { portId: 'mask_image', role: 'loadMask', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'image' },
        { portId: 'output_type', role: 'decode', fieldId: 'output_type' },
      ],
      outputs: [
        { portId: 'images', role: 'decode', fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' },
      ],
    },
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'quantization_mode' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'backend' }],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'dtype' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'dtype' }],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'offload_mode' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'offload_mode' }],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'device' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'device' }],
      },
      {
        source: 'width',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'width' },
        mirrors: [{ role: 'imageEncode', fieldId: 'width' }],
      },
      {
        source: 'height',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'height' },
        mirrors: [{ role: 'imageEncode', fieldId: 'height' }],
      },
      {
        source: 'maxSequenceLength',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'max_sequence_length' },
        mirrors: [{ role: 'imageEncode', fieldId: 'max_sequence_length' }],
      },
    ],
    compiledDefinitionContentHash: 'block-definition-v2-265cc136',
    compiledDefinitionCanonicalSha256: 'sha256:6f8b4fb32a9b47edfc6cde7777c64d08b3e382ef2b0d980a532b47f7f57ebb4a',
  },
  {
    definitionId: 'diffusers.composite:FluxFillPipeline:outpaint',
    definitionContentHash: 'sha256:aed711d16562a193998f2f71079956dca01627f4c2a3c6c490bba7bed8283247',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
    pipelineClass: 'FluxFillPipeline',
    workflowId: 'outpaint',
    admissionId: 'diffusers.cluster-admission:FluxFillPipeline:outpaint:mode:outpaint',
    studioMode: 'outpaint',
    adapterContractId: 'diffusers.composite-adapter:FluxFillPipeline:outpaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-43b42868',
      executionProfileId: 'flux-fill:direct',
      id: 'flux-fill:outpaint:v1',
    },
    artifact: { repo: 'black-forest-labs/FLUX.1-Fill-dev', revision: '358293da0354175698b67ec8299acf928313a78a' },
    dynamicFieldActions: [],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'imageEncode', fieldId: 'prompt' },
        { portId: 'width', role: 'denoise', fieldId: 'width' },
        { portId: 'height', role: 'denoise', fieldId: 'height' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
        { portId: 'guidance_scale', role: 'denoise', fieldId: 'guidance_scale' },
        { portId: 'seed', role: 'denoise', fieldId: 'seed' },
        { portId: 'max_sequence_length', role: 'denoise', fieldId: 'max_sequence_length' },
        { portId: 'strength', role: 'denoise', fieldId: 'strength' },
        { portId: 'image', role: 'loadImage', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'image' },
        { portId: 'mask_image', role: 'loadMask', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'image' },
        { portId: 'output_type', role: 'decode', fieldId: 'output_type' },
      ],
      outputs: [
        { portId: 'images', role: 'decode', fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' },
      ],
    },
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'quantization_mode' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'backend' }],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'dtype' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'dtype' }],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'offload_mode' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'offload_mode' }],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'device' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'device' }],
      },
      {
        source: 'width',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'width' },
        mirrors: [{ role: 'imageEncode', fieldId: 'width' }],
      },
      {
        source: 'height',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'height' },
        mirrors: [{ role: 'imageEncode', fieldId: 'height' }],
      },
      {
        source: 'maxSequenceLength',
        persistence: 'instance_input',
        primary: { role: 'denoise', fieldId: 'max_sequence_length' },
        mirrors: [{ role: 'imageEncode', fieldId: 'max_sequence_length' }],
      },
    ],
    compiledDefinitionContentHash: 'block-definition-v2-c9036f1d',
    compiledDefinitionCanonicalSha256: 'sha256:27d27afb3e37f0cf807a58e5da4dee9bf273415503d59631921052fb5d6e8639',
  },
  {
    definitionId: 'diffusers.composite:FluxKontextInpaintPipeline:inpaint',
    definitionContentHash: 'sha256:0846d0eb2328823a4e5ffe36944de6690e956e2af09d8b4e2216e1454accc1da',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-b2b5acab',
    compiledDefinitionCanonicalSha256: 'sha256:1e7eeb03460765faee45c62f932e1b26b4c6bbf43342abb2df3e6c85ac99c3dc',
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
    definitionContentHash: 'sha256:432ebaf2a041c5325e16255cff4e45f9d3b1ec73cab83fda3d2a2eb21349dc7b',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-0c086193',
    compiledDefinitionCanonicalSha256: 'sha256:f3f1610a987dc0bec8826f3b37e07a4147554d08ab3d9e0259aa4d8e6ff807d1',
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
    definitionContentHash: 'sha256:99365bd5d71c6e5d0f54505b9e25e3ec12dafd16293405feb5d4fac14f06b812',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
    pipelineClass: 'FluxKontextPipeline',
    workflowId: 'multi_image_reference_edit',
    admissionId:
      'diffusers.cluster-admission:FluxKontextPipeline:multi_image_reference_edit:mode:multi_image_reference_edit',
    studioMode: 'multi_image_reference_edit',
    adapterContractId: 'diffusers.composite-adapter:FluxKontextPipeline:multi_image_reference_edit',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-0b8e1bfb',
      executionProfileId: 'flux-kontext:direct',
      id: 'flux-kontext:multi-image-reference-edit:v1',
    },
    artifact: {
      repo: 'black-forest-labs/FLUX.1-Kontext-dev',
      revision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
    },
    dynamicFieldActions: [],
    compiledDefinitionContentHash: 'block-definition-v2-ea52a652',
    compiledDefinitionCanonicalSha256: 'sha256:cba7df1a79f050c6313bf6248333e579b4d595fdc19dbe5ad6719b3a8f1600d3',
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
    definitionContentHash: 'sha256:515ef0eff55577ed82f5ee817a8ef27f41315837a4518bda178292ddfee854dc',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-0f6705a8',
    compiledDefinitionCanonicalSha256: 'sha256:13255a5ad294784002a4cff91243dfa93b2aca8a9a09736742ef0d7643d11a0c',
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
    definitionContentHash: 'sha256:ec2d07ce06f305a9c814d7c47bf3ad191c1b2c8a2743de468115371100d8beab',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
    pipelineClass: 'FluxReduxPipeline',
    workflowId: 'edit_image',
    admissionId: 'diffusers.cluster-admission:FluxReduxPipeline:edit_image:mode:edit_image',
    studioMode: 'edit_image',
    adapterContractId: 'diffusers.composite-adapter:FluxReduxPipeline:edit_image',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-c0ff5ecd',
      executionProfileId: 'flux-redux:direct',
      id: 'flux-redux:edit-image:v1',
    },
    artifact: { repo: 'black-forest-labs/FLUX.1-Redux-dev', revision: 'c95859fbf7703ca4d6824b4da4407d7cd0434f81' },
    dynamicFieldActions: [],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'imageEncode', fieldId: 'prompt' },
        { portId: 'width', role: 'denoise', fieldId: 'width' },
        { portId: 'height', role: 'denoise', fieldId: 'height' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
        { portId: 'guidance_scale', role: 'denoise', fieldId: 'guidance_scale' },
        { portId: 'seed', role: 'denoise', fieldId: 'seed' },
        { portId: 'max_sequence_length', role: 'denoise', fieldId: 'max_sequence_length' },
        { portId: 'image', role: 'loadImage', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'image' },
        { portId: 'output_type', role: 'decode', fieldId: 'output_type' },
      ],
      outputs: [
        { portId: 'images', role: 'decode', fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' },
      ],
    },
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'quantization_mode' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'backend' }],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'dtype' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'dtype' }],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'offload_mode' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'offload_mode' }],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'device' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'device' }],
      },
    ],
    compiledDefinitionContentHash: 'block-definition-v2-1550f232',
    compiledDefinitionCanonicalSha256: 'sha256:17b5f64eeda8809ce2e651946165e897ae8462097d86b0bd5216a3382b0d4c96',
  },
  {
    definitionId: 'diffusers.composite:FluxReduxPipeline:multi_image_reference_edit',
    definitionContentHash: 'sha256:ebab66ab748ed7853b800bf017839fd41877f988113e8e10b0592463d499a9d2',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
    pipelineClass: 'FluxReduxPipeline',
    workflowId: 'multi_image_reference_edit',
    admissionId:
      'diffusers.cluster-admission:FluxReduxPipeline:multi_image_reference_edit:mode:multi_image_reference_edit',
    studioMode: 'multi_image_reference_edit',
    adapterContractId: 'diffusers.composite-adapter:FluxReduxPipeline:multi_image_reference_edit',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-47985f5d',
      executionProfileId: 'flux-redux:direct',
      id: 'flux-redux:multi-image-reference-edit:v1',
    },
    artifact: { repo: 'black-forest-labs/FLUX.1-Redux-dev', revision: 'c95859fbf7703ca4d6824b4da4407d7cd0434f81' },
    dynamicFieldActions: [],
    boundary: {
      inputs: [
        { portId: 'prompt', role: 'imageEncode', fieldId: 'prompt' },
        { portId: 'width', role: 'denoise', fieldId: 'width' },
        { portId: 'height', role: 'denoise', fieldId: 'height' },
        { portId: 'num_inference_steps', role: 'denoise', fieldId: 'num_inference_steps' },
        { portId: 'guidance_scale', role: 'denoise', fieldId: 'guidance_scale' },
        { portId: 'seed', role: 'denoise', fieldId: 'seed' },
        { portId: 'max_sequence_length', role: 'denoise', fieldId: 'max_sequence_length' },
        { portId: 'image', role: 'loadImage', fieldId: 'file', adaptation: 'media_file_path', mediaType: 'image' },
        { portId: 'output_type', role: 'decode', fieldId: 'output_type' },
        { portId: 'reference_strength', role: 'imageEncode', fieldId: 'reference_strength' },
      ],
      outputs: [
        { portId: 'images', role: 'decode', fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' },
      ],
    },
    controlFanOuts: [
      {
        source: 'quantizationMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'quantization_mode' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'backend' }],
      },
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'dtype' },
        mirrors: [{ role: 'diffusersQuantization', fieldId: 'dtype' }],
      },
      {
        source: 'offloadMode',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'offload_mode' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'offload_mode' }],
      },
      {
        source: 'device',
        persistence: 'execution_parameter',
        primary: { role: 'diffusersImagePipeline', fieldId: 'device' },
        mirrors: [{ role: 'diffusersRecipe', fieldId: 'device' }],
      },
    ],
    compiledDefinitionContentHash: 'block-definition-v2-f68e71bb',
    compiledDefinitionCanonicalSha256: 'sha256:62bf2ae4cd14f20e9cf41d9b67f502334761badf757b7a1de15e2ff88d4c5ea3',
  },
  {
    definitionId: 'diffusers.composite:FluxSchnellPipeline:text_to_image',
    definitionContentHash: 'sha256:9709e61d1cc1e1653146d90345d514655ff678b242f96cd3aaf2375d02f2c085',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
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
    compiledDefinitionContentHash: 'block-definition-v2-cf4a8e0c',
    compiledDefinitionCanonicalSha256: 'sha256:c1ae8c16799d160709ef83a94bc935c5e7fd06ee85f3ccc06bfd7b3b06446f66',
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
