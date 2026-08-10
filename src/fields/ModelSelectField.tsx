// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { FieldProps } from '../components/NodeContent';

import AutocompleteField from './AutocompleteField';

import { Download, Library, LoaderCircle, RefreshCw } from 'lucide-react';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { isHfDownloadActive } from '../studio/modelInstall';
import {
  compatibleInstalledHubModels,
  compatibleInstalledLocalModels,
  indexedHubModelIsInstalled,
  parseModelSelectionFilters,
} from '../studio/modelSelection';
import { FieldFrame, ModiffButton } from '../ui';
import { GraphIconButton } from '../ui/GraphControls';
import { enqueueSnackbar } from '../ui/snackbar';
import fieldAction from '../utils/fieldAction';
import { useInitialFieldAction } from '../utils/useInitialFieldAction';

type HfCacheItem = {
  id?: unknown;
  class_names?: unknown;
  installed?: unknown;
  complete?: unknown;
};

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

export default function ModelSelectField(props: FieldProps) {
  const actionTimerRef = useRef(0);
  const latestActionPropsRef = useRef(props);
  latestActionPropsRef.current = props;
  const activeSources = asModelSources(props.fieldOptions?.sources);
  const fallbackSource = activeSources[0] ?? 'hub';
  const propsValue =
    typeof props.value === 'string' && activeSources.length === 1
      ? { source: fallbackSource, value: props.value }
      : asModelFieldValue(props.value, fallbackSource);
  const sourceType = activeSources.length === 1 ? fallbackSource : propsValue.source;
  const fieldValue = propsValue.value ?? '';
  const currentModelId = typeof fieldValue === 'string' ? fieldValue.trim() : '';
  const { fetchHfCache, fetchLocalModels, hfCache, hfDownloadProgress, installHfModel, isLoading, localModels } =
    useNodesStore(
      useShallow((state) => ({
        fetchHfCache: state.fetchHfCache,
        fetchLocalModels: state.fetchLocalModels,
        hfCache: state.hfCache,
        hfDownloadProgress: state.hfDownloadProgress,
        installHfModel: state.installHfModel,
        isLoading: state.isLoading,
        localModels: state.localModels,
      })),
    );
  const sid = useWebsocketStore((state) => state.sid);
  const setModelManagerOpener = useSettingsStore((state) => state.setModelManagerOpener);
  const filters = parseModelSelectionFilters(props.fieldOptions?.filter);
  const hubFilter = filters.hub;
  const localFilter = filters.local;
  const hubOptions = useMemo(
    () =>
      compatibleInstalledHubModels({
        classNameFilter: hubFilter.className,
        filterValid: hubFilter.valid,
        idFilter: hubFilter.id,
        items: hfCache,
      }),
    [hfCache, hubFilter.className, hubFilter.id, hubFilter.valid],
  );
  const localModelOptions = useMemo(
    () =>
      compatibleInstalledLocalModels({
        classNameFilter: localFilter.className,
        filterValid: localFilter.valid,
        idFilter: localFilter.id,
        items: localModels,
      }),
    [localFilter.className, localFilter.id, localFilter.valid, localModels],
  );
  const currentInstalled = useMemo(() => {
    if (!currentModelId) return false;
    if (sourceType === 'local') return localModels.some((item) => item === currentModelId);
    return hfCache.some(
      (item) =>
        Boolean(item && typeof item === 'object') &&
        typeof (item as HfCacheItem).id === 'string' &&
        (item as HfCacheItem).id === currentModelId &&
        indexedHubModelIsInstalled(item as HfCacheItem),
    );
  }, [currentModelId, hfCache, localModels, sourceType]);
  const currentOptions = sourceType === 'hub' ? hubOptions : localModelOptions;
  const currentCompatible = !currentModelId || currentOptions.includes(currentModelId);
  const installProgress = currentModelId ? hfDownloadProgress[currentModelId] : undefined;
  const installActive = isHfDownloadActive(installProgress);

  const scheduleFieldAction = (value: ModelFieldValue) => {
    clearTimeout(actionTimerRef.current);
    const scheduledAction = props.onChange;
    actionTimerRef.current = window.setTimeout(() => {
      const liveNode = useFlowStore.getState().nodes.find(({ id }) => id === props.nodeId);
      if (
        liveNode?.data.module === props.module &&
        liveNode.data.action === props.action &&
        liveNode.data.params[props.fieldKey]?.onChange === scheduledAction
      ) {
        void fieldAction(latestActionPropsRef.current, value);
      }
    }, 250);
  };

  const handleSourceTypeChange = (source: ModelSource) => {
    const nextValue = { ...propsValue, value: '', source };
    props.updateStore(props.fieldKey, nextValue);
    scheduleFieldAction(nextValue);
  };

  const handleFieldChange = (key: string, value: unknown) => {
    const nextValue = isRecord(value) ? value.value : (value ?? null);
    const nextModelValue = { ...propsValue, value: nextValue };
    props.updateStore(key, nextModelValue);
    scheduleFieldAction(nextModelValue);
  };

  useInitialFieldAction(props);
  useEffect(() => () => clearTimeout(actionTimerRef.current), []);

  const handleRefresh = async () => {
    props.updateStore(props.fieldKey, true, 'disabled');
    try {
      await fetchHfCache(true);
      await fetchLocalModels(true);
    } finally {
      props.updateStore(props.fieldKey, false, 'disabled');
    }
  };

  const handleInstall = async () => {
    if (!currentModelId || sourceType !== 'hub' || installActive) return;
    try {
      await installHfModel(currentModelId, sid);
      enqueueSnackbar(`${currentModelId} installed`, { variant: 'success', autoHideDuration: 2200 });
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : `Could not install ${currentModelId}`, {
        variant: 'error',
      });
    }
  };

  const handleOpenModels = () => {
    setModelManagerOpener({
      nodeId: props.nodeId,
      fieldKey: props.fieldKey,
      focus: {
        repo: currentModelId || undefined,
        label: props.label,
        source: 'graph',
      },
    });
  };

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
            onChange={undefined}
            value={fieldValue}
            disabled={props.disabled || isLoading}
            fieldOptions={{ ...props.fieldOptions, emptyMessage: 'No compatible installed models' }}
            options={sourceType === 'hub' ? hubOptions : localModelOptions}
            updateStore={handleFieldChange}
          />
        </div>
        <GraphIconButton
          type="button"
          onClick={handleRefresh}
          className="shrink-0 hover:text-hf-yellow"
          disabled={props.disabled || isLoading}
          label="Refresh models"
        >
          {isLoading ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </GraphIconButton>
        {sourceType === 'hub' && currentModelId && !currentInstalled ? (
          <GraphIconButton
            type="button"
            onClick={handleInstall}
            disabled={props.disabled || isLoading || installActive}
            label={`Install ${currentModelId}`}
          >
            {installActive ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
          </GraphIconButton>
        ) : null}
        {currentOptions.length === 0 || !currentCompatible ? (
          <GraphIconButton
            type="button"
            onClick={handleOpenModels}
            disabled={props.disabled || isLoading}
            label={
              currentCompatible
                ? `Find a compatible ${props.label.toLowerCase()}`
                : `Choose a compatible replacement for ${currentModelId}`
            }
          >
            <Library size={16} />
          </GraphIconButton>
        ) : null}
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
    <ModiffButton
      type="button"
      size="compact"
      tone={active ? 'primary' : 'ghost'}
      className="nodrag nowheel px-2"
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </ModiffButton>
  );
}
