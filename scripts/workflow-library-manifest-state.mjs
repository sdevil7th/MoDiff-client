export function compareCanonicalWorkflowRecordIds(left, right) {
  // Published IDs use codepoint order so host locale never rewrites unrelated pairs.
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function selectCanonicalWorkflowVariantTemplates(templates, reviewedTemplateIds = [], scope = {}) {
  if (scope.requestedPair && scope.requestedTemplateId) throw new Error('Choose one canonical generation scope.');
  const reviewed = new Set(reviewedTemplateIds);
  for (const id of reviewed) {
    if (templates.filter((template) => template.id === id).length !== 1)
      throw new Error(`Reviewed canonical template is missing or ambiguous: ${id}.`);
  }
  const variants = templates.filter(
    (template) =>
      (template.category === 'lora' || reviewed.has(template.id)) &&
      (!scope.requestedPair || `${template.modelType}|${template.mode}` === scope.requestedPair) &&
      (!scope.requestedTemplateId || template.id === scope.requestedTemplateId),
  );
  if (new Set(variants.map((template) => template.id)).size !== variants.length)
    throw new Error('Canonical template variant identities are ambiguous.');
  if (scope.requestedTemplateId && variants.length !== 1)
    throw new Error('The requested template has no reviewed canonical variant declaration.');
  return variants;
}

export function canonicalWorkflowVariantTemplateIds(policy) {
  if (
    policy?.schemaVersion !== 1 ||
    policy.format !== 'modiff.canonical-template-variants.v1' ||
    !Array.isArray(policy.templates) ||
    policy.templates.length > 64
  )
    throw new Error('Canonical template variant policy is invalid.');
  const ids = policy.templates.map((row) => {
    if (
      !row ||
      !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(row.id ?? '') ||
      typeof row.reason !== 'string' ||
      !row.reason.trim() ||
      row.reason.length > 400
    )
      throw new Error('Canonical template variant declaration is invalid.');
    if (Object.hasOwn(row, 'experimentalRecipe')) {
      const value = row.experimentalRecipe;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'mode,modelType,runtimeProfileId' ||
        !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(value.modelType ?? '') ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(value.mode ?? '') ||
        !/^[a-z0-9][a-z0-9:-]{0,127}$/.test(value.runtimeProfileId ?? '')
      )
        throw new Error('Reviewed experimental recipe declaration is invalid.');
    }
    return row.id;
  });
  if (new Set(ids).size !== ids.length) throw new Error('Canonical template variant declarations are duplicated.');
  return ids;
}

// A reviewed fixed recipe may have an ordinary execution receipt without
// promoting its experimental model family, optional runtime or Auto policy.
export function selectReviewedExperimentalWorkflows(records, policy) {
  canonicalWorkflowVariantTemplateIds(policy);
  return policy.templates
    .filter((row) => row.experimentalRecipe)
    .flatMap((row) => {
      const matches = records.filter((record) => record.sourceTemplateId === row.id && record.variant);
      if (matches.length > 1) throw new Error('Reviewed experimental association is ambiguous.');
      if (!matches.length) return [];
      const [record] = matches;
      const expected = row.experimentalRecipe;
      if (
        record.id !== `${expected.modelType}:${expected.mode}:${row.id}` ||
        record.modelType !== expected.modelType ||
        record.mode !== expected.mode ||
        record.supportTier !== 'experimental' ||
        !/^experimental\/[a-z0-9][a-z0-9-]{0,127}\/[a-z0-9][a-z0-9-]{0,255}\.json$/u.test(record.graphPath ?? '') ||
        !['template-recipe', 'lora-theme'].includes(record.variant) ||
        !record.experimentalRecipe ||
        Object.keys(record.experimentalRecipe).sort().join(',') !== 'mode,modelType,runtimeProfileId' ||
        ['modelType', 'mode', 'runtimeProfileId'].some((key) => record.experimentalRecipe[key] !== expected[key])
      )
        throw new Error(`Reviewed experimental association differs from its declaration: ${row.id}.`);
      return [record];
    });
}

export function parseCanonicalWorkflowGenerationScope(args) {
  let requestedPair = null;
  let requestedTemplateId = null;
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') continue;
    if (arg.startsWith('--pair=') && !requestedPair && /^[A-Za-z\d_]+\|[a-z\d_]+$/.test(arg.slice(7))) {
      requestedPair = arg.slice(7);
    } else if (
      arg.startsWith('--template=') &&
      !requestedTemplateId &&
      /^[a-z0-9][a-z0-9_-]{0,127}$/.test(arg.slice(11))
    ) {
      requestedTemplateId = arg.slice(11);
    } else throw new Error('Use one --pair=ModelType|mode or --template=reviewed_template_id scope.');
  }
  if (requestedPair && requestedTemplateId) throw new Error('Choose one canonical generation scope.');
  return { requestedPair, requestedTemplateId };
}

export function selectCanonicalWorkflowCapabilities(capabilities, templates, reviewedTemplateIds, scope) {
  let pair = scope.requestedPair;
  if (scope.requestedTemplateId) {
    const [template] = selectCanonicalWorkflowVariantTemplates(templates, reviewedTemplateIds, scope);
    pair = `${template.modelType}|${template.mode}`;
  }
  if (!pair) return capabilities;
  const selected = capabilities.filter((capability) =>
    (capability.runnableModes ?? []).some((mode) => `${capability.modelType}|${mode}` === pair),
  );
  if (selected.length !== 1) throw new Error(`The requested workflow pair is not uniquely runnable: ${pair}.`);
  return selected.map((capability) => ({
    ...capability,
    runnableModes: capability.runnableModes.filter((mode) => `${capability.modelType}|${mode}` === pair),
  }));
}

export function retainUnselectedCurrentWorkflowRecords(
  records,
  capabilities,
  requestedPair,
  requestedTemplateId = null,
) {
  if (requestedPair && requestedTemplateId) throw new Error('Choose one canonical generation scope.');
  if (!requestedPair && !requestedTemplateId) return [];
  const currentPairs = new Set(
    capabilities.flatMap((capability) =>
      (capability.runnableModes ?? []).map((mode) => `${capability.modelType}|${mode}`),
    ),
  );
  return (records ?? []).filter((record) => {
    const pair = `${record.modelType}|${record.mode}`;
    return (
      currentPairs.has(pair) &&
      (requestedTemplateId
        ? !(record.variant && record.sourceTemplateId === requestedTemplateId)
        : pair !== requestedPair)
    );
  });
}
