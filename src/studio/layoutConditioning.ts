/** Authored layout data only. The selected backend owns prompt serialization. */
export type LayoutBox = readonly [number, number, number, number];

export type LayoutRegion = {
  id: string;
  description: string;
  targetBox: LayoutBox | null;
  action?: 'place' | 'relocate' | 'remove';
  source?: { referenceIndex: number; box: LayoutBox; expectedReferenceId?: string };
};

export type LayoutConditioning = {
  schemaVersion: 1 | 2;
  coordinateSpace: 'normalized_xyxy';
  regions: LayoutRegion[];
};

export type LayoutConditioningSupport =
  | { schemaVersion: 1 | 2; sourceRegions: false; supportsBoundSourceRegions?: true }
  | { schemaVersion: 1; sourceRegions: true; referenceCount: number }
  | { schemaVersion: 2; sourceRegions: true; references: LayoutReferenceSummary['references'] };

export type LayoutReferenceSummary = {
  schemaVersion: 1;
  ownerFingerprint: string;
  bindingFingerprint: string;
  references: { referenceId: string; sourceSize: [number, number]; processedSize: [number, number] }[];
  taskId?: string;
  attemptIndex?: number;
  runInputHash?: string;
};

export const MAX_LAYOUT_REGIONS = 32;
export const MAX_LAYOUT_REFERENCES = 8;
export const MAX_BOUND_LAYOUT_REFERENCES = 10;
export const MAX_LAYOUT_DESCRIPTION = 4096;
export const MAX_LAYOUT_BYTES = 64 * 1024;
const REFERENCE_ID = /^sha256:[0-9a-f]{64}$/u;

function invalid(detail: string): never {
  throw new Error(`Invalid layout conditioning: ${detail}`);
}

function record(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('expected an object.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid('expected plain JSON data.');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ![...required, ...optional].includes(key)) invalid('unknown properties.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) invalid('expected enumerable data properties.');
    result[key] = descriptor.value;
  }
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(result, key))) invalid('missing properties.');
  return result;
}

function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid('collection exceeds its supported size.');
  if (
    Reflect.ownKeys(value).length !== value.length + 1 ||
    Array.from({ length: value.length }, (_, index) => index).some((index) => {
      const item = Object.getOwnPropertyDescriptor(value, index);
      return !item || !item.enumerable || !('value' in item);
    })
  )
    invalid('expected a dense JSON array.');
  return value;
}

function box(value: unknown): LayoutBox {
  const values = array(value, 4);
  if (
    values.length !== 4 ||
    values.some((item) => typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1)
  )
    invalid('box coordinates must be four finite numbers between 0 and 1.');
  const [left, top, right, bottom] = values as [number, number, number, number];
  if (left >= right || top >= bottom) invalid('box corners must enclose a positive area.');
  return [left, top, right, bottom];
}

function description(value: unknown): string {
  if (typeof value !== 'string') invalid('region descriptions must be text.');
  const characters = [...value];
  if (
    characters.length > MAX_LAYOUT_DESCRIPTION ||
    !characters.some((character) => {
      // Python's whitespace test additionally includes these four separators.
      const code = character.charCodeAt(0);
      return !/\p{White_Space}/u.test(character) && !(code >= 28 && code <= 31);
    })
  )
    invalid('region descriptions must contain 1–4096 characters.');
  // TextEncoder replaces lone surrogates. Reject them so UTF-8 accounting and
  // the backend's strict UTF-8 encoder describe exactly the same authored text.
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid('text must be valid Unicode.');
    } else if (code >= 0xdc00 && code <= 0xdfff) invalid('text must be valid Unicode.');
  }
  return value;
}

export function parseLayoutConditioning(value: unknown): LayoutConditioning | null {
  if (value === null) return null;
  const item = record(value, ['schemaVersion', 'coordinateSpace', 'regions']);
  if ((item.schemaVersion !== 1 && item.schemaVersion !== 2) || item.coordinateSpace !== 'normalized_xyxy')
    invalid('unsupported schema.');
  const version = item.schemaVersion;
  const ids = new Set<string>();
  const regions = array(item.regions, MAX_LAYOUT_REGIONS).map((raw): LayoutRegion => {
    const region = record(raw, ['id', 'description', 'targetBox', ...(version === 2 ? ['action'] : [])], ['source']);
    const action = region.action;
    if (version === 2 && action !== 'place' && action !== 'relocate' && action !== 'remove')
      invalid('unsupported region action.');
    const hasSource = Object.prototype.hasOwnProperty.call(region, 'source');
    if (version === 2 && (action === 'place') === hasSource)
      invalid('place has no source; relocate and remove require a bound source.');
    if (action === 'remove' && region.targetBox !== null) invalid('remove requires a null target box.');
    if (
      typeof region.id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(region.id) ||
      /^ref_image_[0-9]+$/u.test(region.id) ||
      ids.has(region.id)
    )
      invalid('region IDs must be unique ASCII identifiers and cannot use ref_image_N.');
    ids.add(region.id);
    let source: LayoutRegion['source'];
    if (Object.prototype.hasOwnProperty.call(region, 'source')) {
      const input = record(region.source, ['referenceIndex', 'box', ...(version === 2 ? ['expectedReferenceId'] : [])]);
      if (
        typeof input.referenceIndex !== 'number' ||
        !Number.isInteger(input.referenceIndex) ||
        input.referenceIndex < 0 ||
        input.referenceIndex >= (version === 2 ? MAX_BOUND_LAYOUT_REFERENCES : MAX_LAYOUT_REFERENCES)
      )
        invalid('source reference index is outside the supported range.');
      if (
        version === 2 &&
        (typeof input.expectedReferenceId !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.expectedReferenceId))
      )
        invalid('source requires its exact backend-issued reference ID.');
      source = {
        referenceIndex: input.referenceIndex,
        box: box(input.box),
        ...(version === 2 ? { expectedReferenceId: input.expectedReferenceId as string } : {}),
      };
    }
    return {
      id: region.id,
      description: description(region.description),
      targetBox: action === 'remove' ? null : box(region.targetBox),
      ...(version === 2 ? { action: action as 'place' | 'relocate' | 'remove' } : {}),
      ...(source ? { source } : {}),
    };
  });
  const parsed: LayoutConditioning = { schemaVersion: version, coordinateSpace: 'normalized_xyxy', regions };
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > MAX_LAYOUT_BYTES)
    invalid('structured layout exceeds 64 KiB of UTF-8 JSON.');
  return parsed;
}

export function parseLayoutConditioningSupport(value: unknown): LayoutConditioningSupport {
  const item = record(value, ['schemaVersion', 'sourceRegions'], ['referenceCount', 'supportsBoundSourceRegions']);
  if (item.schemaVersion !== 1 && item.schemaVersion !== 2) invalid('unsupported layout capability.');
  const bound = Object.prototype.hasOwnProperty.call(item, 'supportsBoundSourceRegions');
  if (bound && (item.schemaVersion !== 2 || item.supportsBoundSourceRegions !== true || item.sourceRegions !== false))
    invalid('bound source editing needs an exact selected capability.');
  if (item.sourceRegions === false && !Object.prototype.hasOwnProperty.call(item, 'referenceCount'))
    return {
      schemaVersion: item.schemaVersion,
      sourceRegions: false,
      ...(bound ? { supportsBoundSourceRegions: true } : {}),
    };
  if (
    item.schemaVersion !== 1 ||
    item.sourceRegions !== true ||
    typeof item.referenceCount !== 'number' ||
    !Number.isInteger(item.referenceCount) ||
    item.referenceCount < 1 ||
    item.referenceCount > MAX_LAYOUT_REFERENCES
  )
    invalid('source regions need a declared bound reference count.');
  return { schemaVersion: 1, sourceRegions: true, referenceCount: item.referenceCount };
}

export function validateLayoutConditioningSupport(
  value: LayoutConditioning | null,
  support: LayoutConditioningSupport,
) {
  if (value?.schemaVersion === 2 && support.schemaVersion !== 2)
    invalid('version two actions are unavailable for this input.');
  for (const region of value?.regions ?? []) {
    if (!region.source) continue;
    if (!support.sourceRegions) invalid('source regions are unavailable for this selected input contract.');
    if (value?.schemaVersion === 1 && support.schemaVersion === 2)
      invalid('legacy source mappings need an explicit version two rebind.');
    if (
      region.source.referenceIndex >= (support.schemaVersion === 2 ? support.references.length : support.referenceCount)
    )
      invalid('a source region refers to an input that is no longer bound.');
    if (
      value?.schemaVersion === 2 &&
      support.schemaVersion === 2 &&
      region.source.expectedReferenceId !== support.references[region.source.referenceIndex]?.referenceId
    )
      invalid('reference content, order, or preprocessing changed; explicitly rebind this source region.');
  }
}

/** Authoring recovery only; full-layout validation and backend execution stay strict. */
export function parseLayoutConditioningEdit(
  value: unknown,
  previous: unknown,
  support: LayoutConditioningSupport,
): LayoutConditioning | null {
  const parsed = parseLayoutConditioning(value);
  if (parsed?.schemaVersion !== 2 || support.schemaVersion !== 2 || !support.sourceRegions) {
    validateLayoutConditioningSupport(parsed, support);
    return parsed;
  }
  const before = parseLayoutConditioning(previous);
  const saved = new Map(before?.schemaVersion === 2 ? before.regions.map((region) => [region.id, region]) : []);
  // An explicit edit may retain an identical stale sibling while repairing,
  // removing or reordering other regions. It cannot introduce/change stale data.
  // Parse the whole layout first so IDs, geometry, schema and byte/count bounds
  // still apply even to siblings whose current reference identity is deferred.
  const changed = parsed.regions.filter((region) => {
    const source = region.source;
    const stale = source && source.expectedReferenceId !== support.references[source.referenceIndex]?.referenceId;
    return !stale || JSON.stringify(saved.get(region.id)) !== JSON.stringify(region);
  });
  validateLayoutConditioningSupport({ ...parsed, regions: changed }, support);
  return parsed;
}

/** Display metadata only. Actual conditioning still needs the backend receipt. */
export function parseLayoutReferenceSummary(value: unknown): LayoutReferenceSummary {
  const item = record(
    value,
    ['schemaVersion', 'ownerFingerprint', 'bindingFingerprint', 'references'],
    ['taskId', 'attemptIndex', 'runInputHash'],
  );
  if (
    item.schemaVersion !== 1 ||
    typeof item.ownerFingerprint !== 'string' ||
    !REFERENCE_ID.test(item.ownerFingerprint) ||
    typeof item.bindingFingerprint !== 'string' ||
    !REFERENCE_ID.test(item.bindingFingerprint)
  )
    invalid('invalid reference summary identity.');
  const size = (value: unknown, maxPixels: number): [number, number] => {
    const dimensions = array(value, 2);
    if (
      dimensions.length !== 2 ||
      dimensions.some((value) => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) ||
      Number(dimensions[0]) * Number(dimensions[1]) > maxPixels
    )
      invalid('invalid reference dimensions.');
    return dimensions as [number, number];
  };
  const references = array(item.references, MAX_BOUND_LAYOUT_REFERENCES).map((value) => {
    const entry = record(value, ['referenceId', 'sourceSize', 'processedSize']);
    if (typeof entry.referenceId !== 'string' || !REFERENCE_ID.test(entry.referenceId))
      invalid('invalid reference ID.');
    return {
      referenceId: entry.referenceId,
      sourceSize: size(entry.sourceSize, Math.floor((256 * 1024 * 1024) / 3)),
      processedSize: size(entry.processedSize, 4096 * 4096),
    };
  });
  if (!references.length) invalid('reference summary is empty.');
  const hasTask = Object.prototype.hasOwnProperty.call(item, 'taskId');
  const hasAttempt = Object.prototype.hasOwnProperty.call(item, 'attemptIndex');
  if (
    hasTask !== hasAttempt ||
    (hasTask &&
      (typeof item.taskId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(item.taskId) ||
        typeof item.attemptIndex !== 'number' ||
        !Number.isSafeInteger(item.attemptIndex) ||
        item.attemptIndex < 0 ||
        item.attemptIndex > 1000))
  )
    invalid('invalid reference task identity.');
  const hasHash = Object.prototype.hasOwnProperty.call(item, 'runInputHash');
  if (hasHash && (!hasTask || typeof item.runInputHash !== 'string' || !/^run_[0-9a-f]{8}$/u.test(item.runInputHash)))
    invalid('invalid reference run identity.');
  const parsed: LayoutReferenceSummary = {
    schemaVersion: 1,
    ownerFingerprint: item.ownerFingerprint,
    bindingFingerprint: item.bindingFingerprint,
    references,
    ...(hasTask ? { taskId: item.taskId as string, attemptIndex: item.attemptIndex as number } : {}),
    ...(hasHash ? { runInputHash: item.runInputHash as string } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 16384) invalid('reference summary exceeds 16 KiB.');
  return parsed;
}

export function nextLayoutRegionId(regions: readonly LayoutRegion[]) {
  const existing = new Set(regions.map((region) => region.id));
  for (let index = 1; index <= MAX_LAYOUT_REGIONS + 1; index++) {
    const id = `region_${index}`;
    if (!existing.has(id)) return id;
  }
  return invalid('no region identity is available.');
}
