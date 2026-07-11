import {
  AUDIO_STUDIO_MODES,
  isStudioModelVisibleInCatalog,
  STUDIO_MODEL_LABELS,
  STUDIO_MODE_LABELS,
  VIDEO_STUDIO_MODES,
} from './modelProfiles';
import type {
  StudioFormState,
  StudioModelType,
  StudioTemplate,
  StudioTemplateDifficulty,
  StudioTemplateIntentGroup,
  StudioTemplateThumbnailVariant,
} from './types';

export type TemplateBrowserCategoryId =
  | 'recommended'
  | 'all'
  | 'getting-started'
  | 'image'
  | 'edit'
  | 'control'
  | 'audio'
  | 'video'
  | 'adapters'
  | 'upscale'
  | 'performance';

export type TemplateBrowserFilter = {
  category: TemplateBrowserCategoryId;
  includeBlocked?: boolean;
  query: string;
  modelType: StudioModelType | 'all';
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
  { id: 'all', label: 'All recipes' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'image', label: 'Image' },
  { id: 'edit', label: 'Edit' },
  { id: 'control', label: 'Control' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'adapters', label: 'Adapters' },
  { id: 'upscale', label: 'Upscale' },
  { id: 'performance', label: 'Performance' },
];

export function inferTemplateIntentGroup(template: StudioTemplate): StudioTemplateIntentGroup {
  if (template.intentGroup) return template.intentGroup;
  if (template.difficulty === 'blocked' || template.example?.status === 'blocked') return 'planning';
  if (
    AUDIO_STUDIO_MODES.includes(template.mode) ||
    template.category === 'audio_generation' ||
    template.category === 'audio_edit'
  )
    return 'audio';
  if (VIDEO_STUDIO_MODES.includes(template.mode)) return 'video';
  if (template.category === 'low_vram') return 'performance';
  if (template.category === 'lora') return 'adapters';
  if (template.category === 'upscale') return 'upscale';
  if (template.category === 'product' || template.category === 'poster' || template.category === 'text')
    return 'generate_image';
  if (template.category === 'control' || template.category === 'reference' || template.category === 'layers')
    return 'reference_control';
  if (template.category === 'edit' || template.category === 'inpaint' || template.category === 'outpaint')
    return 'edit_image';
  return 'generate_image';
}

export function templateCategoryId(template: StudioTemplate): TemplateBrowserCategoryId {
  if (template.category === 'low_vram') return 'performance';
  if (template.category === 'lora') return 'adapters';
  if (template.category === 'upscale') return 'upscale';
  if (template.category === 'concept' && template.difficulty === 'starter') return 'getting-started';
  if (template.category === 'flux') {
    if (template.mode === 'control_image') return 'control';
    if (template.mode === 'edit_image' || template.mode === 'inpaint' || template.mode === 'outpaint') return 'edit';
    return 'image';
  }
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

export function templateSearchText(template: StudioTemplate) {
  return [
    template.label,
    template.description,
    template.prompt,
    template.category,
    template.difficulty,
    template.vramEstimate,
    template.runtimeEstimate,
    STUDIO_MODE_LABELS[template.mode],
    STUDIO_MODEL_LABELS[template.modelType],
    ...(template.tags ?? []),
    ...(template.inputRequirements?.sampleAssets ?? []),
    ...(template.requiredBackendCapabilities ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function runtimeSortValue(template: StudioTemplate) {
  const text = `${template.runtimeEstimate ?? ''} ${template.example?.runtimeEstimate ?? ''}`;
  const number = Number(text.match(/\d+/)?.[0] ?? 9999);
  return Number.isFinite(number) ? number : 9999;
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

export function filterStudioTemplates(
  templates: StudioTemplate[],
  form: StudioFormState,
  filter: TemplateBrowserFilter,
) {
  const query = filter.query.trim().toLowerCase();
  const selectedCategory = filter.category;

  const filtered = templates.filter((template) => {
    const blocked = template.difficulty === 'blocked' || template.example?.status === 'blocked';
    if (blocked && !filter.includeBlocked) return false;
    if (!isStudioModelVisibleInCatalog(template.modelType, { currentModelType: form.modelType })) return false;
    if (selectedCategory === 'recommended' && blocked) return false;
    if (selectedCategory !== 'recommended' && selectedCategory !== 'all') {
      if (templateCategoryId(template) !== selectedCategory) return false;
    }
    if (filter.modelType !== 'all' && template.modelType !== filter.modelType) return false;
    if (filter.difficulty !== 'all' && template.difficulty !== filter.difficulty) return false;
    if (query && !templateSearchText(template).includes(query)) return false;
    return true;
  });

  return filtered.sort((left, right) => {
    if (filter.sort === 'runtime') return runtimeSortValue(left) - runtimeSortValue(right);
    if (filter.sort === 'model')
      return STUDIO_MODEL_LABELS[left.modelType].localeCompare(STUDIO_MODEL_LABELS[right.modelType]);
    if (filter.sort === 'task') return STUDIO_MODE_LABELS[left.mode].localeCompare(STUDIO_MODE_LABELS[right.mode]);
    return recommendedRank(left, form) - recommendedRank(right, form) || left.label.localeCompare(right.label);
  });
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
      path: slot.path,
      posterPath: slot.posterPath,
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
