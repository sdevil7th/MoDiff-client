export type IndexedHubModel = {
  id?: unknown;
  class_names?: unknown;
  installed?: unknown;
  complete?: unknown;
};

export type ParsedModelSourceFilter = {
  className?: unknown;
  id?: unknown;
  valid: boolean;
};

export function indexedHubModelIsInstalled(item: IndexedHubModel) {
  if (typeof item.installed === 'boolean') return item.installed;
  if (typeof item.complete === 'boolean') return item.complete;
  // Older backends returned only cache entries. Preserve compatibility with
  // those responses while current backends explicitly describe completeness.
  return true;
}

function textList(value: unknown) {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseModelSourceFilter(value: unknown): ParsedModelSourceFilter {
  if (value === undefined || value === null) return { valid: true };
  if (!isRecord(value)) return { valid: false };
  const parsed: ParsedModelSourceFilter = { valid: true };
  if (Object.prototype.hasOwnProperty.call(value, 'className')) parsed.className = value.className;
  if (Object.prototype.hasOwnProperty.call(value, 'id')) parsed.id = value.id;
  return parsed;
}

export function parseModelSelectionFilters(value: unknown): {
  hub: ParsedModelSourceFilter;
  local: ParsedModelSourceFilter;
} {
  if (value === undefined || value === null) {
    return { hub: { valid: true }, local: { valid: true } };
  }
  if (!isRecord(value)) {
    return { hub: { valid: false }, local: { valid: false } };
  }
  return {
    hub: parseModelSourceFilter(value.hub),
    local: parseModelSourceFilter(value.local),
  };
}

type TextFilter =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'exact'; values: Set<string> }
  | { expression: RegExp; kind: 'regex' };

function parseTextFilter(filter: unknown): TextFilter {
  if (filter === undefined || filter === null) return { kind: 'none' };
  if (typeof filter === 'string') {
    if (!filter.trim()) return { kind: 'none' };
    try {
      return { expression: new RegExp(filter), kind: 'regex' };
    } catch {
      return { kind: 'invalid' };
    }
  }
  if (Array.isArray(filter)) {
    if (filter.length === 0) return { kind: 'none' };
    if (!filter.every((value): value is string => typeof value === 'string' && Boolean(value.trim()))) {
      return { kind: 'invalid' };
    }
    return { kind: 'exact', values: new Set(filter) };
  }
  return { kind: 'invalid' };
}

function matchesClassFilter(item: IndexedHubModel, filter: unknown) {
  const classNames = textList(item.class_names);
  const parsed = parseTextFilter(filter);
  if (parsed.kind === 'none') return true;
  if (parsed.kind === 'invalid') return false;
  if (parsed.kind === 'regex') return classNames.some((name) => parsed.expression.test(name));
  return classNames.some((name) => parsed.values.has(name));
}

function matchesIdFilter(id: string, filter: unknown) {
  const parsed = parseTextFilter(filter);
  if (parsed.kind === 'none') return true;
  if (parsed.kind === 'invalid') return false;
  if (parsed.kind === 'regex') return parsed.expression.test(id);
  return parsed.values.has(id);
}

export function compatibleInstalledHubModels({
  classNameFilter,
  filterValid = true,
  idFilter,
  items,
}: {
  classNameFilter?: unknown;
  filterValid?: unknown;
  idFilter?: unknown;
  items: unknown[];
}) {
  if (filterValid !== true) return [];
  return items
    .filter((item): item is IndexedHubModel => Boolean(item && typeof item === 'object'))
    .flatMap((item) => {
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (
        !id ||
        !indexedHubModelIsInstalled(item) ||
        !matchesClassFilter(item, classNameFilter) ||
        !matchesIdFilter(id, idFilter)
      ) {
        return [];
      }
      return [id];
    })
    .filter((id, index, values) => values.indexOf(id) === index)
    .sort((left, right) => left.localeCompare(right));
}

export function compatibleInstalledLocalModels({
  classNameFilter,
  filterValid = true,
  idFilter,
  items,
}: {
  classNameFilter?: unknown;
  filterValid?: unknown;
  idFilter?: unknown;
  items: unknown[];
}) {
  if (filterValid !== true) return [];
  // `/local_models` currently returns path strings without class metadata. A
  // backend class filter therefore cannot be evaluated safely: returning every
  // path would turn an authoritative compatibility constraint into a fail-open
  // hint. Keep ID-only local contracts usable, but wait for enriched local
  // discovery before admitting candidates under a declared class filter.
  if (parseTextFilter(classNameFilter).kind !== 'none') return [];

  return items
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim())
    .filter((id) => matchesIdFilter(id, idFilter))
    .filter((id, index, values) => values.indexOf(id) === index)
    .sort((left, right) => left.localeCompare(right));
}
