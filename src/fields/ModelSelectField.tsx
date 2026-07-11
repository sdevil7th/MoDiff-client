import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FieldProps } from '../components/NodeContent';

import AutocompleteField from './AutocompleteField';

import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useNodesStore } from '../stores/useNodeStore';
import { FieldFrame } from '../ui';
import { cx } from '../utils/classNames';

type HfCacheItem = {
  id?: unknown;
  class_names?: unknown;
};

function isHfCacheItem(item: unknown): item is HfCacheItem {
  return Boolean(item && typeof item === 'object');
}

function asStringList(items: unknown[]) {
  return items.filter((item): item is string => typeof item === 'string');
}

type ModelSource = 'hub' | 'local';
type ModelFieldValue = { source: ModelSource; value: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asModelSource(value: unknown): ModelSource | null {
  return value === 'hub' || value === 'local' ? value : null;
}

function asModelSources(value: unknown): ModelSource[] {
  if (Array.isArray(value)) {
    const sources = value.map(asModelSource).filter((item): item is ModelSource => item !== null);
    return sources.length > 0 ? sources : ['hub', 'local'];
  }
  const source = asModelSource(value);
  return source ? [source] : ['hub', 'local'];
}

function asModelFieldValue(value: unknown, fallbackSource: ModelSource): ModelFieldValue {
  if (typeof value === 'string') return { source: fallbackSource, value };
  if (isRecord(value)) {
    return {
      source: asModelSource(value.source) ?? fallbackSource,
      value: value.value ?? '',
    };
  }
  return { source: fallbackSource, value: '' };
}

function asFilterRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export default function ModelSelectField(props: FieldProps) {
  const activeSources = asModelSources(props.fieldOptions?.sources);
  const fallbackSource = activeSources[0] ?? 'hub';
  const propsValue =
    typeof props.value === 'string' && activeSources.length === 1
      ? { source: fallbackSource, value: props.value }
      : asModelFieldValue(props.value, fallbackSource);
  const sourceType = activeSources.length === 1 ? fallbackSource : propsValue.source;
  const fieldValue = propsValue.value ?? '';
  const { hfCache, localModels } = useNodesStore.getState();
  const hfCacheItems = useMemo(() => hfCache.filter(isHfCacheItem), [hfCache]);
  const localModelItems = useMemo(() => asStringList(localModels), [localModels]);
  const fetchLocalModels = useNodesStore((state) => state.fetchLocalModels);
  const fetchHfCache = useNodesStore((state) => state.fetchHfCache);
  const isLoading = useNodesStore((state) => state.isLoading);

  const [hubOptions, setHubOptions] = useState<string[]>([]);
  const [localModelOptions, setLocalModelOptions] = useState<string[]>([]);
  const initialDefaultRef = useRef({
    defaultValue: props.default,
    fieldKey: props.fieldKey,
    source: fallbackSource,
    updateStore: props.updateStore,
  });

  const handleSourceTypeChange = (source: 'hub' | 'local') => {
    const propsDefault = asModelFieldValue(props.default, source);
    const value = propsDefault.source === source ? propsDefault.value : null;
    props.updateStore(props.fieldKey, { ...propsValue, value, source });
  };

  const handleFieldChange = (key: string, value: unknown) => {
    if (value === null || value === undefined) {
      value = null;
    } else if (typeof value === 'object') {
      value = (value as { value?: unknown }).value;
    }

    props.updateStore(key, { ...propsValue, value });
  };

  const handleRefresh = async () => {
    props.updateStore(props.fieldKey, true, 'disabled');
    try {
      await fetchHfCache(true);
      await fetchLocalModels(true);
    } finally {
      const defaultValue = asModelFieldValue(props.default, sourceType);
      const value = defaultValue.source === sourceType ? defaultValue.value : '';
      props.updateStore(props.fieldKey, { ...propsValue, value });
      props.updateStore(props.fieldKey, false, 'disabled');
    }
  };

  const getHubOptions = useCallback(() => {
    const filterRoot = asFilterRecord(props.fieldOptions?.filter);
    const hubFilter = asFilterRecord(filterRoot.hub);

    let options = Array.isArray(props.options) ? asStringList(props.options) : [];
    //const className = Array.isArray(hubFilter.className) ? hubFilter.className : hubFilter.className ? [hubFilter.className] : [];
    const className = hubFilter.className || [];
    if (typeof className === 'string') {
      const cnRegex = new RegExp(className);
      const cnMatch = hfCacheItems
        .filter((item) =>
          Array.isArray(item.class_names)
            ? item.class_names.some((name) => typeof name === 'string' && cnRegex.test(name))
            : typeof item.class_names === 'string' && cnRegex.test(item.class_names),
        )
        .map((item) => String(item.id));
      options = Array.from(new Set([...options, ...cnMatch]));
    } else if (Array.isArray(className) && className.length > 0) {
      const cnOptions = hfCacheItems
        .filter((item) =>
          Array.isArray(item.class_names)
            ? item.class_names.some((name) => typeof name === 'string' && className.includes(name))
            : typeof item.class_names === 'string' && className.includes(item.class_names),
        )
        .map((item) => String(item.id));
      options = Array.from(new Set([...options, ...cnOptions]));
    } else {
      options = Array.from(new Set([...options, ...hfCacheItems.map((item) => String(item.id))]));
    }

    const idMatch = typeof hubFilter.id === 'string' ? hubFilter.id : '';
    if (idMatch) {
      try {
        const regex = new RegExp(idMatch);
        options = options.filter((item) => regex.test(item));
        //options = Array.from(new Set([...options, ...hubOptions.map((item) => item.id)]));
      } catch (error) {
        console.warn('Invalid regex pattern:', idMatch, error);
      }
    }
    setHubOptions(options);
  }, [hfCacheItems, props.fieldOptions?.filter, props.options]);

  const getLocalOptions = useCallback(() => {
    let options = Array.isArray(props.options) ? asStringList(props.options) : [];
    const filterRoot = asFilterRecord(props.fieldOptions?.filter);
    const localFilter = asFilterRecord(filterRoot.local);
    const fileMatch = typeof localFilter.id === 'string' ? localFilter.id : '';
    if (fileMatch) {
      try {
        const regex = new RegExp(fileMatch);
        const localOptions = localModelItems.filter((item) => regex.test(item));
        options = localOptions;
      } catch (error) {
        console.warn('Invalid regex pattern:', fileMatch, error);
      }
    } else {
      options = localModelItems;
    }
    setLocalModelOptions(options);
  }, [localModelItems, props.fieldOptions?.filter, props.options]);

  useEffect(() => {
    getHubOptions();
  }, [getHubOptions]);

  useEffect(() => {
    getLocalOptions();
  }, [getLocalOptions]);

  useEffect(() => {
    const initial = initialDefaultRef.current;
    if (typeof initial.defaultValue === 'string') {
      initial.updateStore(initial.fieldKey, { source: initial.source, value: initial.defaultValue });
    }
  }, []);

  return (
    <FieldFrame dataKey={props.fieldKey} hidden={props.hidden} layoutStyle={props.style} className="modiff-field">
      <div className="nodrag inline-flex overflow-hidden rounded-modiff-compact border border-modiff-border">
        {activeSources.includes('hub') && (
          <SourceButton
            active={sourceType === 'hub'}
            disabled={props.disabled || isLoading}
            onClick={() => handleSourceTypeChange('hub')}
            title="Hugging Face Hub"
          >
            HF&nbsp;Hub
          </SourceButton>
        )}
        {activeSources.includes('local') && (
          <SourceButton
            active={sourceType === 'local'}
            disabled={props.disabled || isLoading}
            onClick={() => handleSourceTypeChange('local')}
            title="Local Models"
          >
            Local
          </SourceButton>
        )}
      </div>
      <div className="flex w-full items-center justify-between gap-1">
        <div className="z-[1] min-w-0 flex-1">
          <AutocompleteField
            {...props}
            value={fieldValue}
            disabled={props.disabled || isLoading}
            options={sourceType === 'hub' ? hubOptions : localModelOptions}
            updateStore={handleFieldChange}
          />
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="grid size-7 shrink-0 place-items-center rounded-modiff-compact text-gray-300 transition hover:bg-white/10 hover:text-hf-yellow disabled:pointer-events-none disabled:opacity-40"
          disabled={props.disabled || isLoading}
          title="Refresh Models"
          aria-label="Refresh Models"
        >
          {isLoading ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      </div>
    </FieldFrame>
  );
}

function SourceButton({
  active,
  children,
  disabled,
  onClick,
  title,
}: {
  active: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className={cx(
        'px-2 py-1 text-xs font-semibold transition disabled:pointer-events-none disabled:opacity-40',
        active ? 'bg-hf-yellow text-black' : 'bg-modiff-bg text-gray-300 hover:bg-white/10 hover:text-white',
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
