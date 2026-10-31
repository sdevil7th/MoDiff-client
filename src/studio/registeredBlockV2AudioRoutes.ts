// Exact reviewed audio route pins. Shared literals only; no family-based admission inference.
import type { RegisteredBlockV2Route } from './registeredBlockV2Routes';

const COMMON = {
  provider: 'diffusers',
  surface: 'diffusers_cluster_nodes',
  definitionKind: 'studio_execution_composite',
  libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
  pipelineClass: 'AceStepAudioPipeline',
  artifact: {
    repo: 'ACE-Step/acestep-v15-xl-turbo-diffusers',
    revision: '200ba991ae448051e14b0183157e35c2d27c9fb0',
  },
  dynamicFieldActions: [],
  controlFanOuts: [
    {
      source: 'dtype',
      persistence: 'execution_parameter',
      primary: {
        role: 'audioPipeline',
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
        role: 'audioPipeline',
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
        role: 'audioPipeline',
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
} as const;

const ROUTES = [
  {
    definitionId: 'diffusers.composite:AceStepAudioPipeline:audio_continuation',
    definitionContentHash: 'sha256:c7c3ae8cb498e0145b689b84a68f89f16df921975e54c052ac113a1593d52400',
    workflowId: 'audio_continuation',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:audio_continuation:mode:audio_continuation',
    studioMode: 'audio_continuation',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:audio_continuation',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-10a664e5',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:audio-continuation:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-81d8a906',
    compiledDefinitionCanonicalSha256: 'sha256:fe72289e6ee0ec100212a9abb2ac6362ab4893e111237584fd0f41bfcf0dd03c',
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'audioGenerate',
          fieldId: 'prompt',
        },
        {
          portId: 'negative_prompt',
          role: 'audioGenerate',
          fieldId: 'negative_prompt',
        },
        {
          portId: 'lyrics',
          role: 'audioGenerate',
          fieldId: 'lyrics',
        },
        {
          portId: 'num_inference_steps',
          role: 'audioGenerate',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'audioGenerate',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'source_audio',
          role: 'loadAudio',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'audio',
        },
        {
          portId: 'extension_duration',
          role: 'audioGenerate',
          fieldId: 'extension_duration',
        },
      ],
      outputs: [
        {
          portId: 'audio',
          role: 'audioExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'audio',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:AceStepAudioPipeline:audio_repaint',
    definitionContentHash: 'sha256:ede7a99838c13cca360c494d745b25879c8de3ae192f2521a4e88284309c191a',
    workflowId: 'audio_repaint',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:audio_repaint:mode:audio_repaint',
    studioMode: 'audio_repaint',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:audio_repaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-a6c78840',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:audio-repaint:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-87109ee5',
    compiledDefinitionCanonicalSha256: 'sha256:96bc85285e50d9118d010ce381ada5aa1efea4100efb874011da14d6cbde884d',
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'audioGenerate',
          fieldId: 'prompt',
        },
        {
          portId: 'negative_prompt',
          role: 'audioGenerate',
          fieldId: 'negative_prompt',
        },
        {
          portId: 'lyrics',
          role: 'audioGenerate',
          fieldId: 'lyrics',
        },
        {
          portId: 'num_inference_steps',
          role: 'audioGenerate',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'audioGenerate',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'source_audio',
          role: 'loadAudio',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'audio',
        },
        {
          portId: 'repainting_start',
          role: 'audioGenerate',
          fieldId: 'repainting_start',
        },
        {
          portId: 'repainting_end',
          role: 'audioGenerate',
          fieldId: 'repainting_end',
        },
      ],
      outputs: [
        {
          portId: 'audio',
          role: 'audioExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'audio',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:AceStepAudioPipeline:audio_variation',
    definitionContentHash: 'sha256:008a737a69c67c49748d20c877f37246f05205e0fd91c70da2a2ff9a15676644',
    workflowId: 'audio_variation',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:audio_variation:mode:audio_variation',
    studioMode: 'audio_variation',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:audio_variation',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-6263ce84',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:audio-variation:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-f72faee5',
    compiledDefinitionCanonicalSha256: 'sha256:e7f9bb7a106b86047fdc3094a857d338e6ae62cb0e7844f99dd222a74404e455',
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'audioGenerate',
          fieldId: 'prompt',
        },
        {
          portId: 'negative_prompt',
          role: 'audioGenerate',
          fieldId: 'negative_prompt',
        },
        {
          portId: 'lyrics',
          role: 'audioGenerate',
          fieldId: 'lyrics',
        },
        {
          portId: 'num_inference_steps',
          role: 'audioGenerate',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'audioGenerate',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'source_audio',
          role: 'loadAudio',
          fieldId: 'file',
          adaptation: 'media_file_path',
          mediaType: 'audio',
        },
        {
          portId: 'audio_duration',
          role: 'audioGenerate',
          fieldId: 'audio_duration',
        },
        {
          portId: 'audio_cover_strength',
          role: 'audioGenerate',
          fieldId: 'audio_cover_strength',
        },
      ],
      outputs: [
        {
          portId: 'audio',
          role: 'audioExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'audio',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:AceStepAudioPipeline:text_to_audio',
    definitionContentHash: 'sha256:a66eb7fa9b9061def9d412dc3d0bbc8f6ea8c31720fcc387d39dd71529acde2b',
    workflowId: 'text_to_audio',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:text_to_audio:mode:text_to_audio',
    studioMode: 'text_to_audio',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:text_to_audio',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-2a984baf',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:text-to-audio:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-e7fe5daf',
    compiledDefinitionCanonicalSha256: 'sha256:b8faec94d1ac7a1a571637b07fa2f7224b13d156ce7c09de7742d27bd45737af',
    boundary: {
      inputs: [
        {
          portId: 'prompt',
          role: 'audioGenerate',
          fieldId: 'prompt',
        },
        {
          portId: 'negative_prompt',
          role: 'audioGenerate',
          fieldId: 'negative_prompt',
        },
        {
          portId: 'lyrics',
          role: 'audioGenerate',
          fieldId: 'lyrics',
        },
        {
          portId: 'num_inference_steps',
          role: 'audioGenerate',
          fieldId: 'num_inference_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'audioGenerate',
          fieldId: 'guidance_scale',
        },
        {
          portId: 'audio_duration',
          role: 'audioGenerate',
          fieldId: 'audio_duration',
        },
      ],
      outputs: [
        {
          portId: 'audio',
          role: 'audioExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'audio',
        },
      ],
    },
  },
] as const satisfies readonly Omit<RegisteredBlockV2Route, keyof typeof COMMON>[];

const SOUND_ROUTES = [
  {
    definitionId: 'diffusers.composite:AudioLDM2Pipeline:text_to_audio',
    definitionContentHash: 'sha256:2c28ef37b207d8f00f2a27b7c4c6fce7ed7a67a850799a4bbbc6ef195e763fa8',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
    pipelineClass: 'AudioLDM2Pipeline',
    workflowId: 'text_to_audio',
    admissionId: 'diffusers.cluster-admission:AudioLDM2Pipeline:text_to_audio:mode:text_to_audio',
    studioMode: 'text_to_audio',
    adapterContractId: 'diffusers.composite-adapter:AudioLDM2Pipeline:text_to_audio',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-0ca57a9f',
      executionProfileId: 'audioldm2-base:direct',
      id: 'audioldm2-base:text-to-audio:v1',
    },
    artifact: {
      repo: 'cvssp/audioldm2',
      revision: 'c8e7e189d324425c05c4c2f81214041ef4107983',
    },
    dynamicFieldActions: [
      {
        event: 'onSignal',
        field: 'pipeline',
        role: 'audioGenerate',
        valueSource: 'pipelineClass',
      },
    ],
    compiledDefinitionContentHash: 'block-definition-v2-58b65680',
    compiledDefinitionCanonicalSha256: 'sha256:20bc5ef803d0785d726f615c82961f75643421acbb915166fce884cd59c70c20',
    controlFanOuts: [
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'audioPipeline',
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
          role: 'audioPipeline',
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
          role: 'audioPipeline',
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
          role: 'audioGenerate',
          fieldId: 'prompt',
        },
        {
          portId: 'negative_prompt',
          role: 'audioGenerate',
          fieldId: 'negative_prompt',
        },
        {
          portId: 'num_inference_steps',
          role: 'audioGenerate',
          fieldId: 'stable_audio_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'audioGenerate',
          fieldId: 'stable_audio_guidance',
        },
        {
          portId: 'audio_duration',
          role: 'audioGenerate',
          fieldId: 'audio_duration',
        },
      ],
      outputs: [
        {
          portId: 'audio',
          role: 'audioExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'audio',
        },
      ],
    },
  },
  {
    definitionId: 'diffusers.composite:LongCatAudioDiTPipeline:text_to_audio',
    definitionContentHash: 'sha256:cc2f38fb2860e16dc7f81d72a31a7e033d3625606337fc3b1eae33f0da1be77e',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '7ecb1e1b4fe500be7fb7381a7bb79a24d7fa3941',
    pipelineClass: 'LongCatAudioDiTPipeline',
    workflowId: 'text_to_audio',
    admissionId: 'diffusers.cluster-admission:LongCatAudioDiTPipeline:text_to_audio:mode:text_to_audio',
    studioMode: 'text_to_audio',
    adapterContractId: 'diffusers.composite-adapter:LongCatAudioDiTPipeline:text_to_audio',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-65b8293e',
      executionProfileId: 'longcat-audio-dit-1b:direct',
      id: 'longcat-audio-dit-1b:text-to-audio:v1',
    },
    artifact: {
      repo: 'ruixiangma/LongCat-AudioDiT-1B-Diffusers',
      revision: 'f4c063ea37f262ba5e6129ebd80095a6d6a9de4d',
    },
    dynamicFieldActions: [
      {
        event: 'onSignal',
        field: 'pipeline',
        role: 'audioGenerate',
        valueSource: 'pipelineClass',
      },
    ],
    compiledDefinitionContentHash: 'block-definition-v2-ebebb14f',
    compiledDefinitionCanonicalSha256: 'sha256:cf3b256c722fc2885ddbbea652d2c8f661ad6dbe106555b0b6e0753660f9d172',
    controlFanOuts: [
      {
        source: 'dtype',
        persistence: 'execution_parameter',
        primary: {
          role: 'audioPipeline',
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
          role: 'audioPipeline',
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
          role: 'audioPipeline',
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
          role: 'audioGenerate',
          fieldId: 'prompt',
        },
        {
          portId: 'negative_prompt',
          role: 'audioGenerate',
          fieldId: 'negative_prompt',
        },
        {
          portId: 'num_inference_steps',
          role: 'audioGenerate',
          fieldId: 'stable_audio_steps',
        },
        {
          portId: 'guidance_scale',
          role: 'audioGenerate',
          fieldId: 'stable_audio_guidance',
        },
        {
          portId: 'audio_duration',
          role: 'audioGenerate',
          fieldId: 'audio_duration',
        },
      ],
      outputs: [
        {
          portId: 'audio',
          role: 'audioExport',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'audio',
        },
      ],
    },
  },
] as const satisfies readonly RegisteredBlockV2Route[];

export const REGISTERED_BLOCK_V2_AUDIO_ROUTES: readonly RegisteredBlockV2Route[] = [
  ...ROUTES.map((route) => ({ ...COMMON, ...route })),
  ...SOUND_ROUTES,
];
