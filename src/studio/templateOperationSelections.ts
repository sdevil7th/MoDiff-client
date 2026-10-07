import type { StudioTemplateExecutionSelection, StudioTemplateId } from './types';

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

function recipes(ids: StudioTemplateId[], selection: StudioTemplateExecutionSelection) {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        ...selection,
        ...(PRESERVED_PIPELINE_POLICIES[id] ? { componentPolicy: PRESERVED_PIPELINE_POLICIES[id] } : {}),
        ...(['z_image_lora_style', 'fast_lora'].includes(id) ? { loraPolicy: { defaultAdapterName: 'default' } } : {}),
        ...(STANDARD_Z_TEMPLATE_IDS.includes(id)
          ? { guidancePolicy: { enabled: true, useOriginalFormulation: true } }
          : {}),
        ...(STANDARD_FLUX_TEMPLATE_IDS.includes(id)
          ? {
              guidancePolicy: {
                enabled: id !== 'flux_schnell_text_to_image',
                useOriginalFormulation: false,
                distilledGuidanceScale: id === 'flux_schnell_text_to_image' ? 0 : 3.5,
              },
            }
          : {}),
      },
    ]),
  );
}

// These fresh native recipes previously used the whole-pipeline recipe's
// explicit VAE/attention settings. Original native recipes keep their defaults.
const PRESERVED_PIPELINE_POLICIES: Partial<
  Record<StudioTemplateId, NonNullable<StudioTemplateExecutionSelection['componentPolicy']>>
> = Object.fromEntries([
  ...STANDARD_Z_TEMPLATE_IDS.map((id) => [id, { attentionBackend: '_native_math', vaeSlicing: true, vaeTiling: true }]),
  ...[
    'qwen_text_rendering',
    'qwen_poster_logo_text',
    'qwen_product_mockup',
    'qwen_low_vram_text_rendering',
    'qwen_low_vram_product_concept',
    'qwen_low_vram_poster_layout',
    'qwen_upscale_finish',
    'high_quality',
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
    'flux_kontext_edit',
    'flux_krea_text_to_image',
    'flux_kontext_multi_reference',
    'flux2_klein_text_to_image',
    'flux2_klein_edit',
    'flux2_klein_multi_reference',
  ].map((id) => [id, { attentionBackend: 'auto', vaeSlicing: true, vaeTiling: true }]),
]);
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
    implementation: 'whole_pipeline',
    note,
  };
}

/** Curated fresh recipes, not global model defaults or execution authority. */
export const IMAGE_TEMPLATE_EXECUTION_SELECTIONS: Partial<Record<StudioTemplateId, StudioTemplateExecutionSelection>> =
  {
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
      ['qwen_inpaint_object_replace', 'qwen_inpaint_mask_draft'],
      pipeline(
        'QwenImageEditInpaintPipeline',
        'qwen-edit:direct-inpaint',
        'QwenImageEditModularPipeline',
        'inpaint',
        'Retains the reviewed standard masked-edit semantics; native mask/generator parity has not been established.',
      ),
    ),
    ...recipes(
      ['qwen_outpaint_aspect_template', 'qwen_outpaint_draft'],
      pipeline(
        'QwenImageEditInpaintPipeline',
        'qwen-edit:direct-inpaint',
        'QwenImageEditModularPipeline',
        'outpaint',
        'Retains the reviewed canvas preparation and standard masked-edit semantics; native parity has not been established.',
      ),
    ),
    ...recipes(
      ['flux_fill_inpaint'],
      pipeline(
        'FluxFillPipeline',
        'flux-fill:direct',
        'FluxFillPipeline',
        'inpaint',
        'The pinned upstream Fill task uses its complete specialized pipeline.',
      ),
    ),
    ...recipes(
      ['flux_fill_outpaint'],
      pipeline(
        'FluxFillPipeline',
        'flux-fill:direct',
        'FluxFillPipeline',
        'outpaint',
        'The pinned upstream Fill task uses its complete specialized pipeline.',
      ),
    ),
    ...recipes(
      ['flux_control_canny'],
      pipeline(
        'FluxControlPipeline',
        'flux-canny:direct',
        'FluxCannyPipeline',
        'control_image',
        'The pinned upstream Canny task uses its specialized control transformer pipeline.',
      ),
    ),
    ...recipes(
      ['flux_depth_control'],
      pipeline(
        'FluxControlPipeline',
        'flux-depth:direct',
        'FluxDepthPipeline',
        'control_image',
        'The pinned upstream Depth task uses its specialized control transformer pipeline.',
      ),
    ),
    ...recipes(
      ['flux_redux_edit'],
      pipeline(
        'FluxReduxPipeline',
        'flux-redux:direct',
        'FluxReduxPipeline',
        'edit_image',
        'Retains the exact base pipeline and Redux prior conditioning at this upstream pin.',
      ),
    ),
    ...recipes(
      ['flux_redux_multi_reference'],
      pipeline(
        'FluxReduxPipeline',
        'flux-redux:direct',
        'FluxReduxPipeline',
        'multi_image_reference_edit',
        'Retains the exact base pipeline and ordered Redux prior conditioning at this upstream pin.',
      ),
    ),
  };
