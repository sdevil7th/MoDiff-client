import batchLocks from '../config/retained-gallery-batch-recipe-locks.v1.json';
import legacyLocks from '../config/retained-gallery-legacy-recipe-locks.v1.json';
import { APPROVED_RETAINED_TEMPLATES } from '../src/studio/retainedGalleryApprovedBatch';
import { LEGACY_RETAINED_GALLERY_TEMPLATES, type RetainedGalleryRecipe } from '../src/studio/retainedGalleryTemplates';
import type { StudioTemplate } from '../src/studio/types';

type RecipeLock = RetainedGalleryRecipe extends infer Recipe
  ? Recipe extends RetainedGalleryRecipe
    ? Omit<Recipe, 'template'>
    : never
  : never;

function bindRecipes(templates: readonly StudioTemplate[], locksById: Record<string, RecipeLock>) {
  if (Object.keys(locksById).length !== templates.length) {
    throw new Error('Retained Gallery metadata and the published template catalog differ.');
  }
  return templates.map((template) => {
    const lock = locksById[template.id];
    if (!lock) throw new Error(`Retained Gallery metadata is missing for ${template.id}.`);
    return { ...lock, template };
  });
}

export const APPROVED_RETAINED_BATCH = bindRecipes(APPROVED_RETAINED_TEMPLATES, batchLocks);
export const RETAINED_GALLERY_TEMPLATES = [
  ...APPROVED_RETAINED_BATCH,
  ...bindRecipes(LEGACY_RETAINED_GALLERY_TEMPLATES, legacyLocks),
];
