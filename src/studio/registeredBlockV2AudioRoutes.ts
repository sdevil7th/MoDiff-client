// Exact reviewed audio route pins. Shared literals only; no family-based admission inference.
import type { RegisteredBlockV2Route } from './registeredBlockV2Routes';

const COMMON = {
  provider: 'diffusers',
  surface: 'diffusers_cluster_nodes',
  definitionKind: 'studio_execution_composite',
  libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    definitionContentHash: 'sha256:80ab3a1bc90954766a09a7ec28f5505b920734caa140077e0e2a1f936b08b81e',
    workflowId: 'audio_continuation',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:audio_continuation:mode:audio_continuation',
    studioMode: 'audio_continuation',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:audio_continuation',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-10a664e5',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:audio-continuation:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-a122f3ae',
    compiledDefinitionCanonicalSha256: 'sha256:518e7bd06f19fa048bc80259489a6f297dfb75752626a750f617b42213f202a3',
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
    definitionContentHash: 'sha256:e6d4727615e851313d8b74489322fd200c5017df9facbe20b1ac963e6be837c8',
    workflowId: 'audio_repaint',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:audio_repaint:mode:audio_repaint',
    studioMode: 'audio_repaint',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:audio_repaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-a6c78840',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:audio-repaint:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-4aa91148',
    compiledDefinitionCanonicalSha256: 'sha256:20cc7c0bfa6c2615425c88e764dc8bfd0ab8fb4206e9bad2f27cd7b37ac8590e',
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
    definitionContentHash: 'sha256:42b7b64e240ed549787cd28948d15ec35c6534ff484800bb7630dc25e7d5fd78',
    workflowId: 'audio_variation',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:audio_variation:mode:audio_variation',
    studioMode: 'audio_variation',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:audio_variation',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-6263ce84',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:audio-variation:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-605c81eb',
    compiledDefinitionCanonicalSha256: 'sha256:b82bfab972e24e5e081efc39c141e48da7ceaf47193dfa3cdab2a01ec8748321',
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
    definitionContentHash: 'sha256:a1a4c1cf4f0ff47fde86b7824b9cb4db7c36b651c8a0026085e9142da7a00cfa',
    workflowId: 'text_to_audio',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:text_to_audio:mode:text_to_audio',
    studioMode: 'text_to_audio',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:text_to_audio',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-2a984baf',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:text-to-audio:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-12928a8a',
    compiledDefinitionCanonicalSha256: 'sha256:e4648f5fb334813a41b2a736ff2ab37d9bbc5efd9517d675a5d542f4434f1760',
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
    definitionContentHash: 'sha256:314617cbd715517a489a6ff3530dcb1f6f9bb3e257af913e12b5994a611020e2',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-ccbbada5',
    compiledDefinitionCanonicalSha256: 'sha256:58b7b3f4300b7b598cbe2d8f289095ca7415ef0b6ab3da080f2d33d8447d3602',
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
    definitionContentHash: 'sha256:17ec5906b4991f2eb620c6eeb535f789109538a2b84a6f9374bfcdfbe99a231f',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: 'fbf49e7f35857f76bc57b177e26f12b03687c668',
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
    compiledDefinitionContentHash: 'block-definition-v2-d01a4269',
    compiledDefinitionCanonicalSha256: 'sha256:7f790866397ef4fe361e88d19c9b30240a28755b6c65249bc3ed53ac7948e991',
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
