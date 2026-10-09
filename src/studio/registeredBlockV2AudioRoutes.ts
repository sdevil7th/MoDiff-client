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
    compiledDefinitionContentHash: 'block-definition-v2-28a52ba4',
    compiledDefinitionCanonicalSha256: 'sha256:c25e7ae9e0d0f732ae6073317be30b0d75f748170005b6a1061d31589ac81653',
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
    compiledDefinitionContentHash: 'block-definition-v2-26e28c26',
    compiledDefinitionCanonicalSha256: 'sha256:3a8a8501b79b93452aea3e5edb8940e19e6471bc31866db7dfa7b25242196096',
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
    compiledDefinitionContentHash: 'block-definition-v2-9434a2ed',
    compiledDefinitionCanonicalSha256: 'sha256:75150095ad1cfccdab7dc378c68653dc8601c6992f76e22416f30282d927914d',
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
    compiledDefinitionContentHash: 'block-definition-v2-0aca6594',
    compiledDefinitionCanonicalSha256: 'sha256:549872dbe554d817b288a9fdf71ba9edba4cef2da05ba1f7654381844ad482d7',
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
    compiledDefinitionContentHash: 'block-definition-v2-54a4fc37',
    compiledDefinitionCanonicalSha256: 'sha256:a710d1fc3243bf54eff644b8a63ce7cb29f62387d9c571e0da5107be7f17a956',
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
    compiledDefinitionContentHash: 'block-definition-v2-42d1ec43',
    compiledDefinitionCanonicalSha256: 'sha256:e3b4398c541550a31f692f98fb6f5fb105a700d0ac01f365a28aaa04f24882a1',
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
