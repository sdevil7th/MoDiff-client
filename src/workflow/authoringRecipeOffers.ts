import { boundedText, identifier, record } from './operationContracts';
import type { PipelineSupport } from './operationCatalog';

/** One bounded wire contract shared by public and explicit evaluation offers. */
export function parseAuthoringRecipeOffers(
  value: unknown,
  profiles: readonly { id: string; pipeline: string; modes: readonly string[] }[],
  declared: readonly PipelineSupport[],
  invalid: () => never,
) {
  const recipes = new Map<string, Record<string, string>>();
  const rawRecipes = new Map<string, Record<string, string>>();
  const rawChoices = new Map<string, Record<string, { authoringRecipeId: string; label: string }[]>>();
  const layoutChoices = new Map<string, Record<string, { authoringRecipeId: string; label: string }[]>>();
  const parseChoices = (value: unknown) => {
    if (!Array.isArray(value) || !value.length || value.length > 4) return invalid();
    if (Reflect.ownKeys(value).length !== value.length + 1) return invalid();
    const selected = Array.from({ length: value.length }, (_, index) => {
      const entry = Object.getOwnPropertyDescriptor(value, index);
      if (!entry?.enumerable || !('value' in entry)) return invalid();
      const choice = record(entry.value, ['authoringRecipeId', 'label']);
      if (Reflect.ownKeys(choice).length !== 2) return invalid();
      const identity = Object.getOwnPropertyDescriptor(choice, 'authoringRecipeId');
      const label = Object.getOwnPropertyDescriptor(choice, 'label');
      if (!identity?.enumerable || !('value' in identity) || !label?.enumerable || !('value' in label))
        return invalid();
      const selectedLabel = boundedText(label.value, 128);
      if (selectedLabel !== selectedLabel.trim()) return invalid();
      return { authoringRecipeId: boundedText(identity.value, 256), label: selectedLabel };
    });
    if (new Set(selected.map((choice) => choice.authoringRecipeId)).size !== selected.length) return invalid();
    return selected;
  };
  if (!Array.isArray(value) || value.length > 4) invalid();
  for (const raw of value as unknown[]) {
    const hasRaw =
      raw !== null && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'rawAuthoringRecipeId');
    const rawRecipe = hasRaw ? Object.getOwnPropertyDescriptor(raw, 'rawAuthoringRecipeId') : undefined;
    if (hasRaw && (!rawRecipe?.enumerable || !('value' in rawRecipe))) invalid();
    const hasChoices =
      raw !== null && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'rawAuthoringRecipeChoices');
    const choices = hasChoices ? Object.getOwnPropertyDescriptor(raw, 'rawAuthoringRecipeChoices') : undefined;
    if (hasChoices && (!hasRaw || !choices?.enumerable || !('value' in choices))) invalid();
    const hasLayout =
      raw !== null &&
      typeof raw === 'object' &&
      Object.prototype.hasOwnProperty.call(raw, 'layoutAuthoringRecipeChoices');
    const layout = hasLayout ? Object.getOwnPropertyDescriptor(raw, 'layoutAuthoringRecipeChoices') : undefined;
    if (hasLayout && (!layout?.enumerable || !('value' in layout))) invalid();
    const row = record(raw, [
      'executionProfileId',
      'pipelineClass',
      'task',
      'authoringRecipeId',
      ...(hasRaw ? ['rawAuthoringRecipeId'] : []),
      ...(hasChoices ? ['rawAuthoringRecipeChoices'] : []),
      ...(hasLayout ? ['layoutAuthoringRecipeChoices'] : []),
    ]);
    const profileId = boundedText(row.executionProfileId, 256);
    const task = identifier(row.task);
    const profile = profiles.find((p) => p.id === profileId && p.pipeline === row.pipelineClass);
    if (
      !profile ||
      !profile.modes.includes(task) ||
      !declared.some(
        (pipeline) =>
          pipeline.pipelineClass === profile.pipeline &&
          pipeline.tasks.some((row) => row.task === task && row.executionProfileIds.includes(profileId)),
      )
    )
      invalid();
    const byTask = recipes.get(profileId) ?? {};
    if (Object.prototype.hasOwnProperty.call(byTask, task)) invalid();
    byTask[task] = boundedText(row.authoringRecipeId, 256);
    recipes.set(profileId, byTask);
    if (hasRaw) {
      const rawId = boundedText(rawRecipe!.value, 256);
      if (rawId === byTask[task]) invalid();
      const rawByTask = rawRecipes.get(profileId) ?? {};
      rawByTask[task] = rawId;
      rawRecipes.set(profileId, rawByTask);
      if (hasChoices) {
        const selected = parseChoices(choices!.value);
        const ids = selected.map((choice) => choice.authoringRecipeId);
        if (!ids.includes(rawId) || ids.includes(byTask[task]!)) invalid();
        const byTaskChoices = rawChoices.get(profileId) ?? {};
        byTaskChoices[task] = selected;
        rawChoices.set(profileId, byTaskChoices);
      }
    }
    if (hasLayout) {
      const selected = parseChoices(layout!.value);
      const rawIds = new Set([
        ...(hasRaw ? [rawRecipes.get(profileId)![task]] : []),
        ...(rawChoices.get(profileId)?.[task]?.map((choice) => choice.authoringRecipeId) ?? []),
      ]);
      if (
        !selected.some((choice) => choice.authoringRecipeId === byTask[task]) ||
        selected.some((choice) => rawIds.has(choice.authoringRecipeId))
      )
        invalid();
      const byTaskChoices = layoutChoices.get(profileId) ?? {};
      byTaskChoices[task] = selected;
      layoutChoices.set(profileId, byTaskChoices);
    }
  }
  return { recipes, rawRecipes, rawChoices, layoutChoices };
}
