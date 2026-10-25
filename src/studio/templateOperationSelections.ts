import type { StudioMode, StudioTemplateExecutionSelection, StudioTemplateId } from './types';

const STANDARD_Z_TEMPLATE_IDS: StudioTemplateId[] = [
  'z_image_quick_concept',
  'z_image_product_mockup',
  'z_image_poster',
  'z_image_lora_style',
  'z_image_cinematic_contact_sheet',
  'low_vram',
  'fast_lora',
];

const STANDARD_FLUX_TEMPLATE_IDS: StudioTemplateId[] = [
  'flux_schnell_text_to_image',
  'flux_dev_expert_text_to_image',
  'flux_lora_cinematic_octane_3d',
  'flux_lora_ghibli_story',
  'flux_lora_oil_painting',
  'flux_lora_film_noir',
  'flux_lora_retro_comic',
  'flux_lora_watercolor',
  'flux_lora_paper_cutout',
  'flux_lora_photoreal_documentary',
  'flux_krea_text_to_image',
  'flux_kontext_edit',
  'flux_kontext_multi_reference',
];

// Curated IDs select a backend-owned recipe; frontend code applies its data
// without interpreting model families, compatibility switches or wiring.
const AUTHORING_RECIPES_BY_TEMPLATE_ID: Partial<Record<StudioTemplateId, string>> = Object.fromEntries([
  ...STANDARD_Z_TEMPLATE_IDS.map((id) => [id, 'retained-z-image-text-to-image:v1']),
  ...[
    'qwen_text_rendering',
    'qwen_poster_logo_text',
    'qwen_product_mockup',
    'qwen_low_vram_text_rendering',
    'qwen_low_vram_product_concept',
    'qwen_low_vram_poster_layout',
    'qwen_upscale_finish',
    'high_quality',
  ].map((id) => [id, 'retained-qwen-image-text-to-image:v1']),
  ['flux_schnell_text_to_image', 'retained-flux-schnell-text-to-image:v1'],
  ...STANDARD_FLUX_TEMPLATE_IDS.filter(
    (id) =>
      ![
        'flux_schnell_text_to_image',
        'flux_krea_text_to_image',
        'flux_kontext_edit',
        'flux_kontext_multi_reference',
      ].includes(id),
  ).map((id) => [id, 'retained-flux-dev-text-to-image:v1']),
  ['flux_krea_text_to_image', 'retained-flux-krea-text-to-image:v1'],
  ['flux_kontext_edit', 'retained-flux-kontext-edit:v1'],
  ['flux_kontext_multi_reference', 'retained-flux-kontext-multi-reference:v1'],
  ['flux2_klein_text_to_image', 'retained-flux2-klein-text-to-image:v1'],
  ['flux2_klein_edit', 'retained-flux2-klein-edit:v1'],
  ['flux2_klein_multi_reference', 'retained-flux2-klein-multi-reference:v1'],
  ['qwen_inpaint_object_replace', 'retained-qwen-edit-inpaint:v1'],
  ['qwen_inpaint_mask_draft', 'retained-qwen-edit-inpaint:v1'],
  ['qwen_outpaint_aspect_template', 'retained-qwen-edit-outpaint:v1'],
  ['qwen_outpaint_draft', 'retained-qwen-edit-outpaint:v1'],
]);
function recipes(ids: StudioTemplateId[], selection: StudioTemplateExecutionSelection) {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        ...selection,
        ...(AUTHORING_RECIPES_BY_TEMPLATE_ID[id] ? { authoringRecipeId: AUTHORING_RECIPES_BY_TEMPLATE_ID[id] } : {}),
        ...(['z_image_lora_style', 'fast_lora'].includes(id) ? { loraPolicy: { defaultAdapterName: 'default' } } : {}),
      },
    ]),
  );
}
function native(
  pipelineClass: string,
  executionProfileId: string,
  modelType: StudioTemplateExecutionSelection['bindingSpec']['modelType'],
  mode: StudioTemplateExecutionSelection['bindingSpec']['mode'],
  task: string = mode,
): StudioTemplateExecutionSelection {
  return {
    schemaVersion: 1,
    pipelineClass,
    executionProfileId,
    task,
    bindingSpec: { modelType, mode },
    implementation: 'native_stages',
    authoringRecipeId: 'generic-native-image:v1',
  };
}
function pipeline(
  pipelineClass: string,
  executionProfileId: string,
  modelType: StudioTemplateExecutionSelection['bindingSpec']['modelType'],
  mode: StudioTemplateExecutionSelection['bindingSpec']['mode'],
  note: string,
): StudioTemplateExecutionSelection {
  return {
    schemaVersion: 1,
    pipelineClass,
    executionProfileId,
    task: mode,
    bindingSpec: { modelType, mode },
    implementation: 'pipeline_stages',
    note,
  };
}

/** Exact masked-template selection shared by fresh creation and parity tooling.
 * Generic developer starters keep their upstream native defaults. */
export function qwenInpaintNativeCandidateSelection(id: StudioTemplateId): StudioTemplateExecutionSelection {
  if (
    ![
      'qwen_inpaint_object_replace',
      'qwen_inpaint_mask_draft',
      'qwen_outpaint_aspect_template',
      'qwen_outpaint_draft',
    ].includes(id)
  )
    throw new Error('This template has no reviewed Qwen native inpaint candidate.');
  return {
    ...native(
      'QwenImageEditModularPipeline',
      'qwen-edit:modular',
      'QwenImageEditModularPipeline',
      'modular_inpainting',
      'inpaint',
    ),
    authoringRecipeId: AUTHORING_RECIPES_BY_TEMPLATE_ID[id],
    note: 'Native masked stages preserve the reviewed whole-template preprocessing and composite through an owned compatibility adapter.',
  };
}

/** Curated fresh recipes, not global model defaults or execution authority. */
export const IMAGE_TEMPLATE_EXECUTION_SELECTIONS: Partial<Record<StudioTemplateId, StudioTemplateExecutionSelection>> =
  {
    // Public-intent planning descriptors; no runtime or Gallery qualification.
    flux3_klein_fp8r512_text_to_image: {
      schemaVersion: 1,
      pipelineClass: 'Flux3DistilledModularPipeline',
      task: 'text_to_image',
      executionProfileId: 'flux3-klein:official-provider:v1',
      bindingSpec: {
        modelType: 'Flux3DistilledModularPipeline',
        mode: 'text_to_image',
      },
      implementation: 'native_stages',
      memoryPolicy: 'custom_experimental',
      authoringRecipeId: 'flux3-klein:official:text-to-image:prompt-preview-append-fp32:v1',
    },
    flux3_klein_fp8r512_single_reference_edit: {
      schemaVersion: 1,
      pipelineClass: 'Flux3DistilledModularPipeline',
      task: 'edit_image',
      executionProfileId: 'flux3-klein:official-provider:v1',
      bindingSpec: {
        modelType: 'Flux3DistilledModularPipeline',
        mode: 'edit_image',
      },
      implementation: 'native_stages',
      memoryPolicy: 'custom_experimental',
      authoringRecipeId: 'flux3-klein:official:edit-image:prompt-preview-append-fp32:v1',
    },
    flux3_klein_fp8r512_multi_reference_edit: {
      schemaVersion: 1,
      pipelineClass: 'Flux3DistilledModularPipeline',
      task: 'edit_image',
      executionProfileId: 'flux3-klein:official-provider:v1',
      bindingSpec: {
        modelType: 'Flux3DistilledModularPipeline',
        mode: 'edit_image',
      },
      implementation: 'native_stages',
      memoryPolicy: 'custom_experimental',
      authoringRecipeId: 'flux3-klein:official:edit-image:prompt-preview-append-fp32:v1',
    },
    flux3_klein_fp8r512_raw_coordinate_prompt: {
      schemaVersion: 1,
      pipelineClass: 'Flux3DistilledModularPipeline',
      task: 'text_to_image',
      executionProfileId: 'flux3-klein:official-provider:v1',
      bindingSpec: {
        modelType: 'Flux3DistilledModularPipeline',
        mode: 'text_to_image',
      },
      implementation: 'native_stages',
      memoryPolicy: 'custom_experimental',
      authoringRecipeId: 'flux3-klein:official:text-to-image:prompt-preview-append-fp32:v1',
    },
    flux3_klein_fp8r512_lora_style: {
      schemaVersion: 1,
      pipelineClass: 'Flux3DistilledModularPipeline',
      task: 'text_to_image',
      executionProfileId: 'flux3-klein:official-provider:v1',
      bindingSpec: {
        modelType: 'Flux3DistilledModularPipeline',
        mode: 'text_to_image',
      },
      implementation: 'native_stages',
      memoryPolicy: 'custom_experimental',
      authoringRecipeId: 'flux3-klein:official:text-to-image:prompt-preview-append-fp32:v1',
      loraPolicy: {
        defaultAdapterName: 'style',
      },
    },
    flux3_klein_base_fp8r512_text_to_image: {
      schemaVersion: 1,
      pipelineClass: 'Flux3ModularPipeline',
      task: 'text_to_image',
      executionProfileId: 'flux3-klein-base:official-provider:v1',
      bindingSpec: {
        modelType: 'Flux3ModularPipeline',
        mode: 'text_to_image',
      },
      implementation: 'native_stages',
      memoryPolicy: 'custom_experimental',
      authoringRecipeId: 'flux3-klein-base:official:text-to-image:prompt-preview-append-fp32:v1',
    },
    flux3_klein_base_fp8r512_single_reference_edit: {
      schemaVersion: 1,
      pipelineClass: 'Flux3ModularPipeline',
      task: 'edit_image',
      executionProfileId: 'flux3-klein-base:official-provider:v1',
      bindingSpec: {
        modelType: 'Flux3ModularPipeline',
        mode: 'edit_image',
      },
      implementation: 'native_stages',
      memoryPolicy: 'custom_experimental',
      authoringRecipeId: 'flux3-klein-base:official:edit-image:prompt-preview-append-fp32:v1',
    },
    flux3_klein_base_fp8r512_multi_reference_edit: {
      schemaVersion: 1,
      pipelineClass: 'Flux3ModularPipeline',
      task: 'edit_image',
      executionProfileId: 'flux3-klein-base:official-provider:v1',
      bindingSpec: {
        modelType: 'Flux3ModularPipeline',
        mode: 'edit_image',
      },
      implementation: 'native_stages',
      memoryPolicy: 'custom_experimental',
      authoringRecipeId: 'flux3-klein-base:official:edit-image:prompt-preview-append-fp32:v1',
    },
    flux3_klein_base_fp8r512_raw_coordinate_prompt: {
      schemaVersion: 1,
      pipelineClass: 'Flux3ModularPipeline',
      task: 'text_to_image',
      executionProfileId: 'flux3-klein-base:official-provider:v1',
      bindingSpec: {
        modelType: 'Flux3ModularPipeline',
        mode: 'text_to_image',
      },
      implementation: 'native_stages',
      memoryPolicy: 'custom_experimental',
      authoringRecipeId: 'flux3-klein-base:official:text-to-image:prompt-preview-append-fp32:v1',
    },
    flux3_klein_base_fp8r512_lora_style: {
      schemaVersion: 1,
      pipelineClass: 'Flux3ModularPipeline',
      task: 'text_to_image',
      executionProfileId: 'flux3-klein-base:official-provider:v1',
      bindingSpec: {
        modelType: 'Flux3ModularPipeline',
        mode: 'text_to_image',
      },
      implementation: 'native_stages',
      memoryPolicy: 'custom_experimental',
      authoringRecipeId: 'flux3-klein-base:official:text-to-image:prompt-preview-append-fp32:v1',
      loraPolicy: {
        defaultAdapterName: 'tarot',
      },
    },

    ...recipes(
      STANDARD_Z_TEMPLATE_IDS,
      native(
        'ZImageModularPipeline',
        'z-image:modular',
        'ZImageModularPipeline',
        'modular_text_to_image',
        'text_to_image',
      ),
    ),
    ...recipes(
      [
        'qwen_text_rendering',
        'qwen_poster_logo_text',
        'qwen_product_mockup',
        'qwen_low_vram_text_rendering',
        'qwen_low_vram_product_concept',
        'qwen_low_vram_poster_layout',
        'qwen_upscale_finish',
        'high_quality',
      ],
      native(
        'QwenImageModularPipeline',
        'qwen-image:modular',
        'QwenImageModularPipeline',
        'modular_text_to_image',
        'text_to_image',
      ),
    ),
    ...recipes(
      ['qwen_control_image_layout', 'qwen_packaging_dieline'],
      native('QwenImageModularPipeline', 'qwen-image:modular', 'QwenImageModularPipeline', 'control_image'),
    ),
    ...recipes(
      [
        'qwen_product_ad_composite',
        'qwen_product_relight',
        'qwen_logo_texture',
        'reference_fusion',
        'qwen_multi_reference_product',
      ],
      native(
        'QwenImageEditPlusModularPipeline',
        'qwen-edit-plus:modular',
        'QwenImageEditPlusModularPipeline',
        'multi_image_reference_edit',
      ),
    ),
    ...recipes(
      ['character_edit', 'qwen_edit_plus_single_image'],
      native(
        'QwenImageEditPlusModularPipeline',
        'qwen-edit-plus:modular',
        'QwenImageEditPlusModularPipeline',
        'edit_image',
      ),
    ),
    ...recipes(
      ['qwen_character_angles', 'qwen_tile_extract', 'qwen_edit_strength_sweep'],
      native('QwenImageEditModularPipeline', 'qwen-edit:modular', 'QwenImageEditModularPipeline', 'edit_image'),
    ),
    ...recipes(
      ['qwen_layered_portrait'],
      native(
        'QwenImageLayeredModularPipeline',
        'qwen-layered:modular',
        'QwenImageLayeredModularPipeline',
        'layer_decomposition',
      ),
    ),
    ...recipes(
      ['flux_schnell_text_to_image'],
      native('FluxModularPipeline', 'flux-schnell:modular', 'FluxModularPipeline', 'text_to_image'),
    ),
    ...recipes(
      [
        'flux_dev_expert_text_to_image',
        'flux_lora_cinematic_octane_3d',
        'flux_lora_ghibli_story',
        'flux_lora_oil_painting',
        'flux_lora_film_noir',
        'flux_lora_retro_comic',
        'flux_lora_watercolor',
        'flux_lora_paper_cutout',
        'flux_lora_photoreal_documentary',
      ],
      native('FluxModularPipeline', 'flux-dev:modular', 'FluxModularPipeline', 'text_to_image'),
    ),
    ...recipes(
      ['flux_krea_text_to_image'],
      native('FluxModularPipeline', 'flux-krea:modular', 'FluxModularPipeline', 'text_to_image'),
    ),
    ...recipes(
      ['flux_kontext_edit'],
      native('FluxKontextModularPipeline', 'flux-kontext:modular', 'FluxKontextModularPipeline', 'edit_image'),
    ),
    ...recipes(
      ['flux_kontext_multi_reference'],
      native(
        'FluxKontextModularPipeline',
        'flux-kontext:modular',
        'FluxKontextModularPipeline',
        'edit_image',
        'multi_image_reference_edit',
      ),
    ),
    ...recipes(
      ['flux2_klein_text_to_image'],
      native('Flux2KleinModularPipeline', 'flux2-klein:modular', 'Flux2KleinModularPipeline', 'text_to_image'),
    ),
    ...recipes(['flux2_dev_text_to_image'], {
      ...native('Flux2ModularPipeline', 'flux2:modular', 'Flux2ModularPipeline', 'text_to_image'),
      memoryPolicy: 'custom_experimental',
    }),
    ...recipes(['cosmos3_super_text_to_image'], {
      ...native(
        'Cosmos3OmniModularPipeline',
        'cosmos3-super-text-to-image:official-modular-workflow',
        'Cosmos3OmniModularPipeline',
        'text_to_image',
      ),
      backendDefaultInputs: ['prompt'],
      memoryPolicy: 'custom_experimental',
    }),
    ...recipes(
      ['flux2_klein_edit'],
      native('Flux2KleinModularPipeline', 'flux2-klein:modular', 'Flux2KleinModularPipeline', 'edit_image'),
    ),
    ...recipes(
      ['flux2_klein_multi_reference'],
      native(
        'Flux2KleinModularPipeline',
        'flux2-klein:modular',
        'Flux2KleinModularPipeline',
        'edit_image',
        'multi_image_reference_edit',
      ),
    ),
    ...recipes(
      [
        'qwen_inpaint_object_replace',
        'qwen_inpaint_mask_draft',
        'qwen_outpaint_aspect_template',
        'qwen_outpaint_draft',
      ],
      qwenInpaintNativeCandidateSelection('qwen_inpaint_object_replace'),
    ),
    ...recipes(
      ['flux_fill_inpaint'],
      pipeline(
        'FluxFillPipeline',
        'flux-fill:direct',
        'FluxFillPipeline',
        'inpaint',
        'Encode Inputs encodes text only; official Fill Denoise retains source, mask and seed preparation, and Image Output decodes and composites.',
      ),
    ),
    ...recipes(
      ['flux_fill_outpaint'],
      pipeline(
        'FluxFillPipeline',
        'flux-fill:direct',
        'FluxFillPipeline',
        'outpaint',
        'Encode Inputs encodes text only; official Fill Denoise retains source, mask and seed preparation, and Image Output decodes and composites.',
      ),
    ),
    ...recipes(
      ['flux_control_canny'],
      pipeline(
        'FluxControlPipeline',
        'flux-canny:direct',
        'FluxCannyPipeline',
        'control_image',
        'Encode Inputs prepares text and VAE control conditioning; Denoise uses the official latent sampler and Image Output decodes latents.',
      ),
    ),
    ...recipes(
      ['flux_depth_control'],
      pipeline(
        'FluxControlPipeline',
        'flux-depth:direct',
        'FluxDepthPipeline',
        'control_image',
        'Encode Inputs prepares text and VAE control conditioning; Denoise uses the official latent sampler and Image Output decodes latents.',
      ),
    ),
    ...recipes(
      ['flux_redux_edit'],
      pipeline(
        'FluxReduxPipeline',
        'flux-redux:direct',
        'FluxReduxPipeline',
        'edit_image',
        'Encode Inputs runs the retained pinned Redux prior; Denoise uses the official base latent sampler and Image Output uses the matching VAE.',
      ),
    ),
    ...recipes(
      ['flux_redux_multi_reference'],
      pipeline(
        'FluxReduxPipeline',
        'flux-redux:direct',
        'FluxReduxPipeline',
        'multi_image_reference_edit',
        'Encode Inputs runs the retained pinned Redux prior in reference order; Denoise uses the official base latent sampler and Image Output uses the matching VAE.',
      ),
    ),
  };

/** Audio retains the actual backend execution decomposition. Integrated
 * generation is not presented as independent encoding/denoising/decoding. */
export const AUDIO_TEMPLATE_EXECUTION_SELECTIONS: Partial<Record<StudioTemplateId, StudioTemplateExecutionSelection>> =
  {
    ...Object.fromEntries(
      (
        [
          ['ace_step_text_to_audio', 'text_to_audio'],
          ['ace_step_audio_variation', 'audio_variation'],
          ['ace_step_audio_continuation', 'audio_continuation'],
          ['ace_step_audio_repaint', 'audio_repaint'],
          ['ace_step_chinese_new_year_lora', 'text_to_audio'],
          ['ace_step_custom_lora', 'text_to_audio'],
        ] as const satisfies readonly (readonly [StudioTemplateId, StudioMode])[]
      ).map(([id, task]) => [
        id,
        {
          schemaVersion: 1,
          pipelineClass: 'AceStepPipeline',
          task,
          executionProfileId: 'ace-step-audio:direct',
          bindingSpec: { modelType: 'AceStepAudioPipeline', mode: task },
          implementation: 'whole_pipeline',
          note: 'Model Setup owns configuration and the reviewed adapter; Generate Audio remains the real integrated pipeline action.',
        } satisfies StudioTemplateExecutionSelection,
      ]),
    ),
    minimax_music3_chamber_pop: {
      schemaVersion: 1,
      pipelineClass: 'MiniMaxMusic3ModularPipeline',
      task: 'text_to_audio',
      executionProfileId: 'minimax-music3:official-modular-workflow',
      bindingSpec: { modelType: 'MiniMaxMusic3ModularPipeline', mode: 'text_to_audio' },
      implementation: 'native_stages',
      note: 'The real semantic generation and denoising stages feed Audio Output; no prompt encoder or Guider is invented.',
    },
  };
