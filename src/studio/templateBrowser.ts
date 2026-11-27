import { matchesSearchKeywords } from '../utils/searchKeywords';
import {
  AUDIO_STUDIO_MODES,
  isStudioModelVisibleInCatalog,
  STUDIO_MODEL_LABELS,
  STUDIO_MODE_LABELS,
  VIDEO_STUDIO_MODES,
} from './modelProfiles';
import { resolveTemplateAssetUrl } from './templateAssets';
import {
  AUDIO_TEMPLATE_EXECUTION_SELECTIONS,
  IMAGE_TEMPLATE_EXECUTION_SELECTIONS,
} from './templateOperationSelections';
import type {
  StudioFormState,
  StudioMode,
  StudioModelType,
  StudioTemplate,
  StudioTemplateDifficulty,
  StudioTemplateIntentGroup,
  StudioTemplateThumbnailVariant,
} from './types';

export type TemplateBrowserCategoryId =
  | 'recommended'
  | 'all'
  | 'experimental'
  | 'getting-started'
  | 'image'
  | 'edit'
  | 'control'
  | 'audio'
  | 'video'
  | 'text'
  | '3d'
  | 'adapters'
  | 'upscale'
  | 'performance';

export type TemplateBrowserFilter = {
  category: TemplateBrowserCategoryId;
  includeBlocked?: boolean;
  query: string;
  modelType: StudioModelType | 'all' | `label:${string}`;
  mode?: StudioMode | 'all';
  difficulty: StudioTemplateDifficulty | 'all';
  sort: 'recommended' | 'task' | 'model' | 'runtime';
};

export type TemplateMediaSlot = {
  id: string;
  label: string;
  kind: 'image' | 'gif' | 'video' | 'audio' | 'json' | 'compare-before' | 'compare-after' | 'poster' | 'placeholder';
  path?: string;
  posterPath?: string;
  placeholder: string;
};

export const TEMPLATE_BROWSER_CATEGORIES: Array<{ id: TemplateBrowserCategoryId; label: string }> = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'all', label: 'All templates' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'image', label: 'Image' },
  { id: 'edit', label: 'Edit' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'text', label: 'Text' },
  { id: '3d', label: '3D' },
  { id: 'control', label: 'Control & guidance' },
  { id: 'adapters', label: 'Adapters' },
  { id: 'upscale', label: 'Upscale' },
  { id: 'performance', label: 'Performance' },
  { id: 'experimental', label: 'Advanced & planning' },
];

const TEMPLATE_DISPLAY_NAME_OVERRIDES: Partial<Record<StudioTemplate['id'], string>> = {
  low_vram: 'Quick Preview',
};

export function templateModelDisplayName(template: Pick<StudioTemplate, 'modelType' | 'modelDisplayName'>) {
  return template.modelDisplayName?.trim() || STUDIO_MODEL_LABELS[template.modelType];
}

/**
 * The model and operation already have dedicated card metadata. Keep the
 * primary card title focused on the creative result so it remains readable at
 * every supported card width.
 */
export function templateDisplayName(template: StudioTemplate) {
  const override = TEMPLATE_DISPLAY_NAME_OVERRIDES[template.id];
  if (override) return override;
  const labelParts = template.label.split(' — ');
  const operationAndName = labelParts[labelParts.length - 1] ?? template.label;
  const colonIndex = operationAndName.indexOf(':');
  const resultName = colonIndex >= 0 ? operationAndName.slice(colonIndex + 1) : operationAndName;
  return resultName
    .replace(/\s*\((?:auto[ -]?offload|low[ -]?vram)\)\s*/gi, '')
    .replace(/^(?:multi-reference|single-image)\s+/i, '')
    .trim();
}

export function inferTemplateIntentGroup(template: StudioTemplate): StudioTemplateIntentGroup {
  if (template.difficulty === 'blocked' || template.example?.status === 'blocked') return 'planning';
  if (template.category === 'low_vram') return 'performance';
  if (template.category === 'lora') return 'adapters';
  if (template.category === 'upscale') return 'upscale';
  if (
    AUDIO_STUDIO_MODES.includes(template.mode) ||
    template.category === 'audio_generation' ||
    template.category === 'audio_edit'
  )
    return 'audio';
  if (VIDEO_STUDIO_MODES.includes(template.mode)) return 'video';
  if (
    template.mode === 'edit_image' ||
    template.mode === 'multi_image_reference_edit' ||
    template.mode === 'inpaint' ||
    template.mode === 'outpaint'
  )
    return 'edit_image';
  if (template.mode === 'control_image' || template.mode === 'layer_decomposition') return 'reference_control';
  if (template.category === 'product' || template.category === 'poster' || template.category === 'text')
    return 'generate_image';
  if (template.category === 'control' || template.category === 'reference' || template.category === 'layers')
    return 'reference_control';
  if (template.category === 'edit' || template.category === 'inpaint' || template.category === 'outpaint')
    return 'edit_image';
  return template.intentGroup ?? 'generate_image';
}

export function templateCategoryId(template: StudioTemplate): TemplateBrowserCategoryId {
  if (template.mode === 'text_to_3d') return '3d';
  if (template.mode === 'text_generation' || template.mode === 'image_to_text') return 'text';
  if (template.category === 'text' && template.mode === 'text_to_image') return 'image';
  if (template.category === 'low_vram') return 'performance';
  if (template.category === 'lora') return 'adapters';
  if (template.category === 'upscale') return 'upscale';
  if (template.category === 'concept' && template.difficulty === 'starter') return 'getting-started';
  const intent = inferTemplateIntentGroup(template);
  if (intent === 'edit_image') return 'edit';
  if (intent === 'reference_control') return 'control';
  if (intent === 'audio') return 'audio';
  if (intent === 'video') return 'video';
  if (intent === 'adapters') return 'adapters';
  if (intent === 'upscale') return 'upscale';
  if (intent === 'performance') return 'performance';
  return 'image';
}

/**
 * Templates can be discovered by both their workflow feature and their output
 * medium. Keep a LoRA recipe under Adapters without making image, video, or
 * audio users know that implementation detail before they can find it.
 */
export function templateCategoryIds(template: StudioTemplate): TemplateBrowserCategoryId[] {
  const primary = templateCategoryId(template);
  if (template.mode === 'speech_to_text' || template.mode === 'speech_translation') return [primary, 'text'];
  if (primary === 'audio' && template.outputKinds?.includes('video')) return [primary, 'video'];
  if (primary !== 'adapters') return [primary];
  if (AUDIO_STUDIO_MODES.includes(template.mode) || template.outputKinds?.includes('audio')) {
    return [primary, 'audio'];
  }
  if (VIDEO_STUDIO_MODES.includes(template.mode) || template.outputKinds?.includes('video')) {
    return [primary, 'video'];
  }
  if (template.outputKinds?.includes('image')) return [primary, 'image'];
  return [primary];
}

export function templateSearchText(template: StudioTemplate) {
  return [
    template.label,
    template.description,
    template.prompt,
    template.category,
    template.difficulty,
    template.vramEstimate,
    STUDIO_MODE_LABELS[template.mode],
    templateModelDisplayName(template),
    template.modelArtifact?.value,
    ...(template.tags ?? []),
    ...(template.inputRequirements?.sampleAssets ?? []),
    ...(template.requiredBackendCapabilities ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function recommendedRank(template: StudioTemplate, form: StudioFormState) {
  let rank = 0;
  if (template.mode === form.mode) rank -= 100;
  if (template.modelType === form.modelType) rank -= 30;
  if (template.difficulty === 'starter') rank -= 12;
  if (template.difficulty === 'blocked' || template.example?.status === 'blocked') rank += 80;
  if (template.example?.status === 'exact') rank -= 20;
  if (template.example?.status === 'unverified') rank += 2;
  return rank;
}

/** Recognize declared creators for browsing. Execution and resource eligibility remain separate. */
export function hasDeclaredExperimentalCreator(template: StudioTemplate) {
  const selection = template.executionSelection;
  const declared = IMAGE_TEMPLATE_EXECUTION_SELECTIONS[template.id] ?? AUDIO_TEMPLATE_EXECUTION_SELECTIONS[template.id];
  const artifact = template.modelArtifact;
  if (
    !selection ||
    !declared ||
    selection.schemaVersion !== 1 ||
    selection.memoryPolicy !== 'custom_experimental' ||
    declared.memoryPolicy !== 'custom_experimental' ||
    selection.bindingSpec?.modelType !== template.modelType ||
    selection.bindingSpec?.mode !== template.mode ||
    declared.bindingSpec.modelType !== template.modelType ||
    declared.bindingSpec.mode !== template.mode
  )
    return false;
  for (const key of ['pipelineClass', 'task', 'executionProfileId', 'authoringRecipeId', 'implementation'] as const) {
    const value = selection[key];
    if (typeof value !== 'string' || !value.trim() || value !== declared[key]) return false;
  }
  if (!artifact || typeof artifact.value !== 'string' || !artifact.value.trim()) return false;
  return artifact.source === 'hub'
    ? /^[0-9a-f]{40}$/i.test(artifact.revision ?? '')
    : artifact.source === 'local' && /^[0-9a-f]{64}$/i.test(artifact.sha256 ?? '');
}

export function filterStudioTemplates(
  templates: StudioTemplate[],
  form: StudioFormState,
  filter: TemplateBrowserFilter,
  localRuntimeSeconds?: (template: StudioTemplate) => number | null,
) {
  const query = filter.query.trim().toLowerCase();
  const selectedCategory = filter.category;

  const filtered = templates.filter((template) => {
    const blocked = template.difficulty === 'blocked' || template.example?.status === 'blocked';
    if (blocked && !filter.includeBlocked) return false;
    if (
      !isStudioModelVisibleInCatalog(template.modelType, {
        currentModelType: form.modelType,
        includeWorkflowOnly: true,
      }) &&
      !hasDeclaredExperimentalCreator(template)
    )
      return false;
    if (selectedCategory === 'recommended' && blocked) return false;
    if (selectedCategory !== 'recommended' && selectedCategory !== 'all' && selectedCategory !== 'experimental') {
      if (!templateCategoryIds(template).includes(selectedCategory)) return false;
    }
    if (
      filter.modelType !== 'all' &&
      filter.modelType !== template.modelType &&
      filter.modelType !== templateModelFilterValue(template)
    )
      return false;
    if (filter.mode && filter.mode !== 'all' && template.mode !== filter.mode) return false;
    if (filter.difficulty !== 'all' && template.difficulty !== filter.difficulty) return false;
    if (query && !matchesSearchKeywords(query, [templateSearchText(template)])) return false;
    return true;
  });

  return filtered.sort((left, right) => {
    if (filter.sort === 'runtime') {
      return (
        (localRuntimeSeconds?.(left) ?? Number.POSITIVE_INFINITY) -
        (localRuntimeSeconds?.(right) ?? Number.POSITIVE_INFINITY)
      );
    }
    if (filter.sort === 'model') return templateModelDisplayName(left).localeCompare(templateModelDisplayName(right));
    if (filter.sort === 'task') return STUDIO_MODE_LABELS[left.mode].localeCompare(STUDIO_MODE_LABELS[right.mode]);
    return recommendedRank(left, form) - recommendedRank(right, form) || left.label.localeCompare(right.label);
  });
}

export function templateModelFilterValue(template: StudioTemplate) {
  return `label:${templateModelDisplayName(template)}` as const;
}

export function templateModelOptions(templates: readonly StudioTemplate[]) {
  const labels = new Map(
    templates.map((template) => [templateModelFilterValue(template), templateModelDisplayName(template)]),
  );
  return Array.from(labels, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

const CATEGORY_FEATURES: Record<TemplateBrowserCategoryId, string> = {
  recommended: 'minimax_h3_image_old_town_cat',
  all: 'minimax_h3_image_old_town_cat',
  'getting-started': 'z_image_quick_concept',
  image: 'minimax_h3_image_old_town_cat',
  edit: 'qwen_product_relight',
  control: 'qwen_layered_sunset_and_peaks',
  video: 'wan_a14b_cloudbreak_over_the_ridges',
  audio: 'minimax_music3_chamber_pop',
  text: 'janus_reykjavik_travel_note',
  '3d': 'shap_e_traffic_cone_turntable',
  adapters: 'flux_lora_oil_painting',
  upscale: 'qwen_upscale_finish',
  performance: 'low_vram',
  experimental: 'flux3_klein_fp8r512_text_to_image',
};

/** Keep an editorial choice within the current results and prefer approved current-recipe media. */
export function featuredCategoryTemplate(
  templates: readonly StudioTemplate[],
  category: TemplateBrowserCategoryId,
  hasPreview?: (template: StudioTemplate) => boolean,
) {
  const choice = templates.find((template) => template.id === CATEGORY_FEATURES[category]);
  if (choice && (!hasPreview || hasPreview(choice))) return choice;
  return (hasPreview && templates.find(hasPreview)) || choice || templates[0];
}

export function templateMediaSlots(template: StudioTemplate): TemplateMediaSlot[] {
  if (template.mediaSlots?.length) {
    return template.mediaSlots.map((slot) => ({
      id: slot.id,
      label: slot.label,
      kind:
        slot.kind === 'comparison_before'
          ? 'compare-before'
          : slot.kind === 'comparison_after'
            ? 'compare-after'
            : slot.kind,
      path: resolveTemplateAssetUrl(slot.path),
      posterPath: resolveTemplateAssetUrl(slot.posterPath),
      placeholder: slot.placeholder,
    }));
  }

  const mediaType = template.example?.mediaType ?? template.outputKinds?.[0] ?? 'image';
  const variant: StudioTemplateThumbnailVariant = template.thumbnailVariant ?? 'image';

  if (variant === 'compareSlider' || variant === 'hoverDissolve') {
    return [
      { id: 'before', label: 'Before', kind: 'compare-before', placeholder: 'source pending' },
      { id: 'after', label: 'After', kind: 'compare-after', placeholder: `${mediaType} result pending` },
    ];
  }

  if (variant === 'contactSheet') {
    return ['A', 'B', 'C', 'D'].map((label) => ({
      id: label.toLowerCase(),
      label,
      kind: mediaType,
      placeholder: `${mediaType} tile pending`,
    }));
  }

  return [
    {
      id: 'primary',
      label: mediaType === 'video' ? 'Video' : 'Preview',
      kind: mediaType,
      placeholder: `${mediaType} example pending`,
    },
  ];
}
