import type { OptionDescriptor } from './types';
import type { NodeParamOptions, NodeParams } from '../stores/useNodeStore';

type UnknownRecord = Record<string, unknown>;

export type RuntimeOptionEntry =
  | {
      key: string;
      label: string;
      raw: unknown;
      type: 'header';
    }
  | {
      key: string;
      value: string;
      label: string;
      group?: string;
      disabled: boolean;
      disabledReason?: string;
      descriptor?: OptionDescriptor;
      raw: unknown;
      type: 'option';
    };

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function primitiveText(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function recordText(record: UnknownRecord, keys: readonly string[]) {
  for (const key of keys) {
    const value = primitiveText(record[key]);
    if (value) return value;
  }
  return '';
}

export function isOptionDescriptor(value: unknown): value is OptionDescriptor {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1 && typeof value.value === 'string' && typeof value.label === 'string';
}

export function optionDescriptorIsSelectable(descriptor: OptionDescriptor) {
  return (
    descriptor.compatibility === 'compatible' &&
    descriptor.availability === 'installed' &&
    descriptor.installationState === 'installed'
  );
}

function descriptorDisabledReason(descriptor: OptionDescriptor) {
  if (descriptor.disabledReason) return descriptor.disabledReason;
  if (descriptor.availability === 'remote' || descriptor.installationState === 'installable') {
    return 'Install this option before using it.';
  }
  if (descriptor.installationState === 'installing') {
    return 'This option is still being installed.';
  }
  if (descriptor.compatibility === 'unknown') {
    return 'Compatibility with the current node connections and runtime has not been established.';
  }
  return 'This option is not compatible with the current node connections and runtime.';
}

function normalizedOption(raw: unknown, fallbackValue?: string, fallbackKey?: string): RuntimeOptionEntry | null {
  if (isOptionDescriptor(raw)) {
    const disabled = !optionDescriptorIsSelectable(raw);
    return {
      type: 'option',
      key: fallbackKey ?? raw.value,
      value: raw.value,
      label: raw.label,
      group: raw.group,
      disabled,
      disabledReason: disabled ? descriptorDisabledReason(raw) : undefined,
      descriptor: raw,
      raw,
    };
  }

  if (isRecord(raw)) {
    const value = fallbackValue ?? recordText(raw, ['value', 'id', 'key']);
    if (!value) return null;
    const label = recordText(raw, ['label', 'name', 'title']) || value;
    return {
      type: 'option',
      key: fallbackKey ?? value,
      value,
      label,
      disabled: Boolean(raw.disabled),
      disabledReason: primitiveText(raw.disabledReason) || undefined,
      raw,
    };
  }

  const value = fallbackValue ?? primitiveText(raw);
  if (!value) return null;
  return {
    type: 'option',
    key: fallbackKey ?? value,
    value,
    label: primitiveText(raw) || value,
    disabled: false,
    raw,
  };
}

/**
 * Normalizes both the versioned backend option contract and legacy node option
 * declarations. Invalid object values are omitted instead of becoming
 * "[object Object]".
 */
export function runtimeOptionEntries(options: unknown, currentOptions?: unknown): RuntimeOptionEntry[] {
  if (currentOptions !== undefined) options = runtimeOptionPresentation(options, currentOptions);
  if (Array.isArray(options)) {
    return options
      .map((option, index) => normalizedOption(option, undefined, `option-${index}`))
      .filter((entry): entry is RuntimeOptionEntry => Boolean(entry));
  }

  if (!isRecord(options)) return [];

  return Object.entries(options)
    .map(([key, option]) => {
      if (key.startsWith('__')) {
        const label = isRecord(option)
          ? recordText(option, ['label', 'name', 'title']) || key
          : primitiveText(option) || key;
        return { type: 'header' as const, key, label, raw: option };
      }
      return normalizedOption(option, key, key);
    })
    .filter((entry): entry is RuntimeOptionEntry => Boolean(entry));
}

/** Current runtime status is presentation, not part of an imported document. */
export function runtimeOptionPresentation(options: unknown, currentOptions: unknown): NodeParamOptions {
  const saved = runtimeOptionEntries(options);
  const current = runtimeOptionEntries(currentOptions);
  if (![...saved, ...current].some((row) => row.type === 'option' && row.descriptor)) {
    return (options ?? []) as NodeParamOptions;
  }
  const present = (raw: unknown, key?: string) => {
    const entry = normalizedOption(raw, key, key);
    if (!entry || entry.type !== 'option') return raw;
    const matches = current.filter((row) => row.type === 'option' && row.value === entry.value);
    const match = matches.length === 1 ? matches[0] : undefined;
    const live = match?.type === 'option' ? match.descriptor : undefined;
    return {
      schemaVersion: 1,
      value: entry.value,
      label: entry.label,
      ...(entry.group ? { group: entry.group } : {}),
      compatibility: live?.compatibility ?? 'unknown',
      availability: live?.availability ?? 'unavailable',
      installationState: live?.installationState ?? 'unavailable',
      ...(live?.dependencies ? { dependencies: { ...live.dependencies } } : {}),
      ...(live?.disabledReason
        ? { disabledReason: live.disabledReason }
        : !live
          ? { disabledReason: 'This option is not declared by the current runtime.' }
          : {}),
    };
  };
  if (Array.isArray(options)) return options.map((raw) => present(raw));
  if (!isRecord(options)) return [];
  return Object.fromEntries(
    Object.entries(options).map(([key, raw]) => [key, key.startsWith('__') ? raw : present(raw, key)]),
  );
}

function actionCanSetOptions(action: unknown, fieldKey: string): boolean {
  if (Array.isArray(action)) return action.some((item) => actionCanSetOptions(item, fieldKey));
  if (typeof action === 'string') return true;
  if (!isRecord(action)) return false;
  return (
    action.action === 'exec' ||
    action.action === 'create' ||
    (action.action === 'value' && action.target === fieldKey && action.prop === 'options')
  );
}

/** Dynamic actions/optionsSource keep their existing authority and consent. */
export function registeredRuntimeOptionPresentation(
  options: NodeParamOptions,
  fieldKey: string,
  currentFields: Record<string, NodeParams> | undefined,
): NodeParamOptions {
  const current = currentFields?.[fieldKey];
  if (
    !current ||
    Object.prototype.hasOwnProperty.call(current, 'optionsSource') ||
    Object.values(currentFields ?? {}).some(
      (field) => actionCanSetOptions(field.onChange, fieldKey) || actionCanSetOptions(field.onSignal, fieldKey),
    )
  ) {
    return options;
  }
  return runtimeOptionPresentation(options, current.options ?? []);
}

export function runtimeOptionValues(options: unknown, { includeDisabled = false }: { includeDisabled?: boolean } = {}) {
  return runtimeOptionEntries(options)
    .filter(
      (entry): entry is Extract<RuntimeOptionEntry, { type: 'option' }> =>
        entry.type === 'option' && (includeDisabled || !entry.disabled),
    )
    .map((entry) => entry.value);
}
