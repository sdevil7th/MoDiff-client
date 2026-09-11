// Exact reviewed audio route pins. Shared literals only; no family-based admission inference.
import type { RegisteredBlockV2Route } from './registeredBlockV2Routes';

const COMMON = {
  provider: 'diffusers',
  surface: 'diffusers_cluster_nodes',
  definitionKind: 'studio_execution_composite',
  libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
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
    definitionContentHash: 'sha256:5f92f7e5112add3a45324fc041817b8e757049f0a19a55147458d90610733d05',
    workflowId: 'audio_continuation',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:audio_continuation:mode:audio_continuation',
    studioMode: 'audio_continuation',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:audio_continuation',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-10a664e5',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:audio-continuation:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-c4a770ed',
    compiledDefinitionCanonicalSha256: 'sha256:7fd1ec80c25270e562d15daeb468ecf8d017ca5d869dcf44c5085eda165a0b4a',
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
    definitionContentHash: 'sha256:8ed4443ec5891a44742be073481e1b3583d2255dd864342d3a6c408bb2ac5571',
    workflowId: 'audio_repaint',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:audio_repaint:mode:audio_repaint',
    studioMode: 'audio_repaint',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:audio_repaint',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-a6c78840',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:audio-repaint:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-4c7c42b8',
    compiledDefinitionCanonicalSha256: 'sha256:8e7fff1e7436abfc04779d501aa0a0e8d289123589322eeb089e2021ba4efca1',
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
    definitionContentHash: 'sha256:4b8c7305287bc624e0bbc399e1a52f5b525ae71ad02927a52ace2de260cd0c7e',
    workflowId: 'audio_variation',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:audio_variation:mode:audio_variation',
    studioMode: 'audio_variation',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:audio_variation',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-6263ce84',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:audio-variation:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-d1a6e998',
    compiledDefinitionCanonicalSha256: 'sha256:feba82d8cb795c6413a73496af8ee481d119ad6acdbbfc282288547db458227a',
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
    definitionContentHash: 'sha256:270723097c6abbf1885ab5df7a1d29ad2b43698a46d73d733416b4241417b671',
    workflowId: 'text_to_audio',
    admissionId: 'diffusers.cluster-admission:AceStepAudioPipeline:text_to_audio:mode:text_to_audio',
    studioMode: 'text_to_audio',
    adapterContractId: 'diffusers.composite-adapter:AceStepAudioPipeline:text_to_audio',
    studioExecutionSpec: {
      contentHash: 'studio-spec-v1-2a984baf',
      executionProfileId: 'ace-step-audio:direct',
      id: 'ace-step-v1.5-xl-turbo:text-to-audio:v1',
    },
    compiledDefinitionContentHash: 'block-definition-v2-1e00bd83',
    compiledDefinitionCanonicalSha256: 'sha256:9bd4af205c7f00fdb3fa6dea1514da68a20b0fc9955496a3b72b538c0707b65d',
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
    definitionContentHash: 'sha256:7fc6ba194301c190a632c36bd0c13507688dadc79069433e3452f679b3972985',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
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
    compiledDefinitionContentHash: 'block-definition-v2-831c318e',
    compiledDefinitionCanonicalSha256: 'sha256:17d719a524ad0d8868bf39646c946860ba2c4a60ff4c5c9e1a5a620cb11f0f2e',
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
    definitionContentHash: 'sha256:d896adaadbdeda8bc1bbf0754a43a7485064b4f6f9066a2ad8ef872ac457ff94',
    provider: 'diffusers',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
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
    compiledDefinitionContentHash: 'block-definition-v2-96e4c758',
    compiledDefinitionCanonicalSha256: 'sha256:3f2a75b05c9d76637745c82adbec3bb4f37fff0ee4e1ffd56864bfc103c63ee5',
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
