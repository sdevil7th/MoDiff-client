// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { Fragment, lazy, memo, ReactNode, Suspense, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AlertTriangle, Pin, RotateCcw } from 'lucide-react';
import type { Position } from '@xyflow/react';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  autoFieldOverrideKey,
  captureWorkflowOperationContext,
  useStudioStore,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { formPatchForAutoCandidate, selectedAutoCandidate } from '../studio/autoResource';
import { NodeParams, type NodeParamOptions, type NodeParamSignal } from '../stores/useNodeStore';
import { useFlowStore } from '../stores/useFlowStore';
import { classifyManagedControl } from '../studio/managedControlPolicy';
import { runtimeOptionValues } from '../studio/runtimeOptions';
import { sanitizeModiffFieldStyle, type ModiffFieldStyle } from '../theme';
import type { ImageArtifact } from '../utils/imageArtifacts';
import { GraphControlButton } from '../ui/GraphControls';
import { ModiffDisclosure, ModiffTooltip } from '../ui';
import { cx } from '../utils/classNames';
import { EncodeImageSummary } from './EncodeImageSummary';
import { blockControlConnectionNotesV2 } from '../studio/blockControlConnectionsV2';
import { FieldFrame } from '../ui/FieldFrame';
import { PreviewEmptyState } from '../ui/PreviewFrame';
import { operationOwnsModel } from '../workflow/operationContracts';

import HandleField from '../fields/HandleField';
import InputField from '../fields/InputField';
import FileBrowserField from '../fields/FileBrowserField';
import SelectField from '../fields/SelectField';
import RandomField from '../fields/RandomField';
import ToggleField from '../fields/ToggleField';
import AutocompleteField from '../fields/AutocompleteField';
import TextareaField from '../fields/TextareaField';
import RadioField from '../fields/RadioField';
import NumberField from '../fields/NumberField';
import RangeField from '../fields/RangeField';
import ModelSelectField from '../fields/ModelSelectField';
import LayerConfigField from '../fields/LayerConfigField';
import SelectDialogField from '../fields/SelectDialogField';

import UITextField from '../fields/UITextField';
import UIImageField from '../fields/UIImageField';
import UIButtonField from '../fields/UIButtonField';
import UILabelFieldField from '../fields/UILabelField';
import UIGroupField from '../fields/UIGroupField';
import UIImagecompareField from '../fields/UIImagecompareField';
const UIVideoField = lazy(() => import('../fields/UIVideoField'));
const UIAudioField = lazy(() => import('../fields/UIAudioField'));
const SplineField = lazy(() => import('../fields/SplineField'));

export type FieldProps = {
  nodeId: string;
  /** Owning canvas when this field contract was rendered. */
  workflowContext?: WorkflowOperationContext;
  /** DOM identity for an alternate view; graph actions always use nodeId. */
  inputId?: string;
  fieldKey: string;
  label: string;
  display: string;
  disabled: boolean;
  hidden: boolean;
  style: ModiffFieldStyle;
  value: unknown;
  default: unknown;
  options: NodeParamOptions;
  optionsSource?: Record<string, unknown>;
  dataType: string;
  connectionType?: string | string[];
  fieldType: string;
  updateStore: (param: string, value: unknown, key?: keyof NodeParams) => void;
  /** Declared actions can target fields omitted from an alternate control view. */
  updateFieldActionStore?: FieldProps['updateStore'];
  module: string;
  action: string;
  isConnected?: boolean;
  onChange?: unknown;
  min?: number;
  max?: number;
  step?: number;
  fieldOptions?: Record<string, unknown>;
  artifacts?: ImageArtifact[];
  executionStatus?: string;
  progressMessage?: string;
  uiStateMessage?: string;
  onSignal?: unknown;
  signal?: NodeParamSignal;
  children?: ReactNode;
  compactHandle?: boolean;
  handlePosition?: Position;
};

type NodeContentProps = {
  nodeId: string;
  controlIdPrefix?: string;
  params: Record<string, NodeParams>;
  updateStore: (param: string, value: unknown, key?: keyof NodeParams) => void;
  updateFieldActionStore?: (origin: string, param: string, value: unknown, key?: keyof NodeParams) => void;
  module: string;
  action: string;
  mode?: 'all' | 'controls' | 'connectors';
  compactConnectors?: boolean;
  hidePreviews?: boolean;
  executionStatus?: string;
  progressMessage?: string;
  uiStateMessage?: string;
};

const AUDIO_SAMPLE_RATE_OPTIONS = {
  '44100': '44.1 kHz',
  '48000': '48 kHz',
  '88200': '88.2 kHz',
  '96000': '96 kHz',
};

function liveFieldOptions(module: string, fieldKey: string, display: string, options: NodeParamOptions) {
  const isAudioSampleRate =
    /^modules\.(?:Audio|DiffusersAudio)$/.test(module) &&
    fieldKey === 'sample_rate' &&
    display !== 'input' &&
    display !== 'output';
  return isAudioSampleRate ? AUDIO_SAMPLE_RATE_OPTIONS : options;
}

const NodeContent = memo(function NodeContent({
  nodeId,
  controlIdPrefix,
  params,
  updateStore,
  updateFieldActionStore,
  module,
  action,
  mode = 'all',
  compactConnectors = false,
  hidePreviews = false,
  executionStatus,
  progressMessage,
  uiStateMessage,
}: NodeContentProps) {
  // A Studio-only rerender during navigation must not reassign an old canvas
  // contract to the incoming workflow. A new immutable schema gets a new owner.
  const renderedContract = useMemo(() => ({ params, context: captureWorkflowOperationContext() }), [params]);
  const autoResourcePlan = useStudioStore((state) => state.autoResourcePlan);
  const studioForm = useStudioStore((state) => state.form);
  const autoFieldOverrides = useStudioStore((state) => state.autoFieldOverrides);
  const resetAutoFieldOverride = useStudioStore((state) => state.resetAutoFieldOverride);
  const studioResourceMode = studioForm.resourceMode;
  const studioGraphBinding = useStudioStore((state) => state.graphBinding);
  const graphNode = useFlowStore((state) => state.nodes.find((node) => node.id === nodeId));
  const connectionNotes = useFlowStore(
    useShallow((state) =>
      blockControlConnectionNotesV2(
        state.nodes.find((node) => node.id === nodeId),
        params,
        state.nodes,
        state.edges,
      ),
    ),
  );
  const studioRole = graphNode?.data.studioRole;
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const selectedCandidate = selectedAutoCandidate(autoResourcePlan, studioForm);
  const resolved = selectedCandidate?.artifactResolution?.resolved;
  const isModelNode =
    /load|pipeline|model/i.test(`${module}.${action}`) &&
    Object.keys(params).some((key) => /model|repo|checkpoint|pipeline/i.test(key));
  const controlledStudioNode = Boolean(
    studioGraphBinding && (studioGraphBinding.managedNodeIds?.includes(nodeId) || graphNode?.data.studioOwned === true),
  );
  const showResolution = Boolean(
    controlledStudioNode &&
    isModelNode &&
    selectedCandidate &&
    (selectedCandidate.artifactResolution?.substituted ||
      (resolved?.format && resolved.format !== 'native') ||
      (selectedCandidate.quantizationMode && selectedCandidate.quantizationMode !== 'none')),
  );
  const resolvedRepo = resolved?.repo || selectedCandidate?.resolvedArtifact || selectedCandidate?.artifact || '';
  const resolutionFormat =
    resolved?.format || selectedCandidate?.artifactFormat || selectedCandidate?.quantizationMode || 'native';
  const resolutionNotice = showResolution ? (
    <GraphControlButton
      type="button"
      className="text-modiff-label mb-2 flex min-h-7 w-full items-center gap-1.5 rounded-modiff-compact border border-hf-yellow/50 bg-hf-yellow/10 px-2 py-1.5 text-left text-hf-yellow hover:bg-hf-yellow/15"
      title="Open model compatibility details"
      data-testid={`node-resolution-warning-${nodeId}`}
      onClick={() => {
        setRightPanelOpen(true);
        setRightPanelTab('compatibility');
      }}
    >
      <AlertTriangle size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {resolvedRepo} · {resolutionFormat}
      </span>
    </GraphControlButton>
  ) : null;
  // Workflow Auto plans resources without hiding manually authored controls.
  const autoModeActive = studioResourceMode === 'auto' && controlledStudioNode;
  const autoFormPatch = formPatchForAutoCandidate(selectedCandidate, studioForm);
  const fields = Object.entries(params).map(([key, data]: [string, NodeParams]) => {
    const label = data.label ?? key.charAt(0).toUpperCase() + key.slice(1);
    const display = data.isInput ? 'input' : data.display || '';
    const dataType = (
      Array.isArray(data.type) && data.type.length > 0 ? data.type[0] : data.type || 'string'
    ) as string;
    const connectionType = data.type || 'string';
    const options = liveFieldOptions(module, key, display, data.options || []);
    const fieldType = getFieldType(display, dataType, options);
    // A managed model choice already resolves the repository, implementation
    // route and pipeline class atomically. Keep model_type in the persisted
    // execution contract, but do not offer it as a second, conflicting choice.
    // Raw implementation nodes have no operation owner and retain the field for
    // low-level/custom contract authoring.
    const derivedPipelineType =
      key === 'model_type' && operationOwnsModel(graphNode?.data.operationAuthoring?.operation);
    const hidden = Boolean(data.hidden || derivedPipelineType);
    const configuredValue = data.value ?? data.default;
    const fileBackedLoaderPreview =
      (fieldType === 'ui_audio' || fieldType === 'ui_video') &&
      /(?:^|\.)Load$/i.test(action) &&
      typeof (params.file?.value ?? params.file?.default) === 'string'
        ? (params.file?.value ?? params.file?.default)
        : undefined;
    // Older runs stored `/cache/<node>/filename/...` for file-backed previews.
    // That endpoint contains the filename as text, not the media bytes. Loader
    // nodes can render their selected file directly before or after execution.
    const value = fileBackedLoaderPreview ?? configuredValue;
    const isConnected = display === 'input' || display === 'output' ? data.isConnected || false : undefined;
    const classification = classifyManagedControl(studioRole, key, data);
    const autoManaged = autoModeActive && classification.surface === 'advanced';
    const autoOverride = autoFieldOverrides[autoFieldOverrideKey(nodeId, key)];
    const autoValue = controlledStudioNode
      ? classification.formKey && autoFormPatch[classification.formKey] !== undefined
        ? autoFormPatch[classification.formKey]
        : autoValueForField(key, data.default, selectedCandidate, studioForm)
      : data.default;

    const props = {
      nodeId,
      workflowContext: renderedContract.context,
      inputId: controlIdPrefix ? `${controlIdPrefix}:${nodeId}:${key}` : undefined,
      value,
      label,
      display,
      isConnected,
      dataType,
      connectionType,
      fieldType,
      hidden,
      updateStore,
      updateFieldActionStore: updateFieldActionStore
        ? (param: string, nextValue: unknown, property?: keyof NodeParams) =>
            updateFieldActionStore(key, param, nextValue, property)
        : undefined,
      module,
      action,
      onChange: data.onChange,
      fieldKey: key,
      default: data.default,
      options,
      style: sanitizeModiffFieldStyle(data.style, `${nodeId}.${key}`),
      disabled: Boolean(data.disabled || connectionNotes[key]),
      min: data.min,
      max: data.max,
      step: data.step,
      fieldOptions: {
        ...data.fieldOptions,
        ...(connectionNotes[key] ? { connectedControlNote: connectionNotes[key] } : {}),
      },
      artifacts: data.artifacts,
      executionStatus,
      progressMessage,
      uiStateMessage,
      optionsSource: data.optionsSource || {},
      signal: data.signal,
      onSignal: data.onSignal,
    };

    return {
      key,
      props,
      autoManaged,
      autoOverride: Boolean(autoOverride),
      resetAutoOverride: () => {
        updateStore(key, autoValue, 'value');
        resetAutoFieldOverride(nodeId, key);
      },
      surface:
        (controlledStudioNode || data.fieldOptions?.controlTier === 'advanced') && !isPreviewFieldType(fieldType)
          ? classification.surface
          : ('main' as const),
    };
  });
  const connectors = fields.filter(({ props }) => props.fieldType === 'input' || props.fieldType === 'output');
  const controls = fields.filter(
    ({ props }) =>
      props.fieldType !== 'input' &&
      props.fieldType !== 'output' &&
      (!hidePreviews || !isPreviewFieldType(props.fieldType)),
  );

  if (mode === 'connectors') {
    if (connectors.length === 0) return null;
    const inputs = connectors.filter(({ props }) => props.fieldType === 'input');
    const outputs = connectors.filter(({ props }) => props.fieldType === 'output');

    return (
      <div
        aria-label="Node connectors"
        className={cx(
          'nodrag relative z-10 grid w-full shrink-0 grid-cols-2 overflow-visible border-t border-modiff-border-subtle bg-modiff-bg text-modiff-subtle-text',
          compactConnectors ? 'min-h-7 py-1' : 'min-h-9 py-1.5',
        )}
        data-connector-layout="bottom-tray"
        data-testid={`node-connector-tray-${nodeId}`}
        role="group"
      >
        <div className="grid min-w-0 grid-cols-1 content-start gap-1 pr-2">
          {inputs.map(({ key, props }) => (
            <FieldMemo key={key} {...props} compactHandle={compactConnectors} />
          ))}
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-1 border-l border-modiff-border-subtle pl-2">
          {outputs.map(({ key, props }) => (
            <FieldMemo key={key} {...props} compactHandle={compactConnectors} />
          ))}
        </div>
      </div>
    );
  }

  const renderFields = mode === 'controls' ? controls : [...controls, ...connectors];
  // Keep field ownership stable across presentations. Moving a control between
  // parents remounts its initialization hook and can repeat backend actions.
  const mainFields = renderFields.filter(({ surface }) => surface === 'main');
  const advancedFields = renderFields.filter(({ surface }) => surface === 'advanced');

  const orderedMainFields = orderedFieldElements(mainFields);
  const orderedAdvancedFields = orderedFieldElements(advancedFields);
  const orderedInternalFields = orderedFieldElements(renderFields.filter(({ surface }) => surface === 'hidden'));
  const collapseAdvanced = true;
  const encodeImageSummary =
    /ModularDiffusers/.test(module) && action === 'ImageEncode' ? (
      <EncodeImageSummary
        nodeId={nodeId}
        params={params}
        executionStatus={executionStatus}
        progressMessage={progressMessage}
      />
    ) : null;

  return (
    <>
      {encodeImageSummary}
      {resolutionNotice}
      {orderedMainFields}
      {orderedInternalFields.length > 0 && (
        <div className={collapseAdvanced ? 'hidden' : 'contents'}>{orderedInternalFields}</div>
      )}
      {orderedAdvancedFields.length > 0 ? (
        <ModiffDisclosure
          label="Advanced"
          data-testid={collapseAdvanced ? `node-advanced-controls-${nodeId}` : undefined}
          collapsible={collapseAdvanced}
          unmount={false}
          className={
            collapseAdvanced ? 'rounded-modiff-compact border border-modiff-border-subtle bg-modiff-bg/40' : 'contents'
          }
          buttonClassName="min-h-7 text-xs"
          panelClassName={
            collapseAdvanced ? 'grid min-w-0 grid-cols-1 gap-2 border-t border-modiff-border-subtle p-2' : 'contents'
          }
        >
          {orderedAdvancedFields}
        </ModiffDisclosure>
      ) : null}
    </>
  );
});

export default NodeContent;

const customFieldCache: Record<string, React.LazyExoticComponent<React.ComponentType<FieldProps>>> = {};

const getCustomField = (fieldName: string, module: string) => {
  const cacheKey = `${module}.${fieldName}`;

  if (!customFieldCache[cacheKey]) {
    customFieldCache[cacheKey] = lazy(() => import(`@custom-fields/${fieldName}.tsx`));
  }
  return customFieldCache[cacheKey];
};

const GroupMemo = memo((props: FieldProps) => {
  return <UIGroupField props={props}>{props.children}</UIGroupField>;
});

type ClassifiedField = {
  autoManaged: boolean;
  autoOverride: boolean;
  key: string;
  props: FieldProps;
  resetAutoOverride: () => void;
  surface: 'main' | 'advanced' | 'hidden';
};

const AUTO_MANAGED_MESSAGE =
  'Auto manages this setting until you edit it. Your edit stays pinned to this workflow while Auto manages the other settings.';
const AUTO_OVERRIDE_MESSAGE = 'Pinned override for this workflow. Auto remains active for other settings.';

function autoValueForField(
  fieldKey: string,
  defaultValue: unknown,
  candidate: ReturnType<typeof selectedAutoCandidate>,
  form: ReturnType<typeof useStudioStore.getState>['form'],
) {
  if (!candidate) return defaultValue;
  if (/^(model|model_id|repo_id)$/.test(fieldKey)) {
    return candidate.resolvedArtifact ?? candidate.artifact ?? candidate.modelRepo ?? defaultValue;
  }
  if (fieldKey === 'pipeline_class') return candidate.pipelineClass ?? defaultValue;
  if (fieldKey === 'dtype') return candidate.dtype ?? form.dtype;
  if (fieldKey === 'device') return form.device;
  if (fieldKey === 'offload_mode') return candidate.offloadMode ?? form.offloadMode;
  if (fieldKey === 'auto_offload') return (candidate.offloadMode ?? form.offloadMode) !== 'none';
  if (fieldKey === 'quantization_mode' || fieldKey === 'backend') {
    return candidate.quantizationMode ?? form.quantizationMode;
  }
  if (fieldKey === 'quantized_components' || fieldKey === 'components') {
    return candidate.quantizedComponents ?? defaultValue;
  }
  return defaultValue;
}

function fieldElement(field: ClassifiedField) {
  const content = <FieldMemo {...field.props} />;
  const connectionNote = field.props.fieldOptions?.connectedControlNote;
  if (typeof connectionNote === 'string')
    return (
      <div
        key={field.key}
        role="group"
        aria-label={`${field.props.label} uses a connected value`}
        data-connected-control={field.key}
      >
        {content}
        <p role="note" className="px-2 pb-2 text-xs text-modiff-subtle-text">
          {connectionNote}
        </p>
      </div>
    );
  if (!field.autoManaged) return <Fragment key={field.key}>{content}</Fragment>;
  return (
    <ModiffTooltip<HTMLDivElement>
      key={field.key}
      content={field.autoOverride ? AUTO_OVERRIDE_MESSAGE : AUTO_MANAGED_MESSAGE}
    >
      {(tooltipProps) => (
        <div
          {...tooltipProps}
          role="group"
          aria-label={field.autoOverride ? AUTO_OVERRIDE_MESSAGE : AUTO_MANAGED_MESSAGE}
          className="relative"
          data-auto-managed-control={field.key}
          data-auto-override={field.autoOverride || undefined}
        >
          {content}
          {field.autoOverride ? (
            <div className="mt-1 flex items-center justify-end gap-0.5 border-t border-modiff-border-subtle pt-1">
              <span
                aria-label="Pinned Auto override"
                className="grid size-7 place-items-center text-hf-yellow"
                title={AUTO_OVERRIDE_MESSAGE}
              >
                <Pin size={13} aria-hidden="true" />
              </span>
              <GraphControlButton
                type="button"
                aria-label={`Reset ${field.props.label} to Auto`}
                title={`Reset ${field.props.label} to Auto`}
                className="grid size-7 place-items-center rounded-modiff-compact text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-modiff-text"
                onClick={field.resetAutoOverride}
              >
                <RotateCcw size={13} aria-hidden="true" />
              </GraphControlButton>
            </div>
          ) : null}
        </div>
      )}
    </ModiffTooltip>
  );
}

function orderedFieldElements(fields: ClassifiedField[]) {
  const groupFields: Record<string, { field: ClassifiedField; children: ClassifiedField[] }> = {};
  const groupedFieldKeys = new Set<string>();

  fields.forEach((field) => {
    if (field.props.fieldType !== 'ui_group' || !Array.isArray(field.props.options)) return;
    groupFields[field.key] = { field, children: [] };
    runtimeOptionValues(field.props.options, { includeDisabled: true }).forEach((optionKey) => {
      const child = fields.find((candidate) => candidate.key === optionKey);
      if (child && !groupedFieldKeys.has(optionKey)) {
        groupFields[field.key]?.children.push(child);
        groupedFieldKeys.add(optionKey);
      }
    });
  });

  return fields
    .filter(({ key }) => !groupedFieldKeys.has(key))
    .map((field) => {
      const group = groupFields[field.key];
      if (!group) return fieldElement(field);
      return (
        <GroupMemo key={field.key} {...field.props}>
          {group.children.map(fieldElement)}
        </GroupMemo>
      );
    });
}

const FieldMemo = memo((props: FieldProps) => {
  if (props.display.startsWith('custom')) {
    const fieldName = props.display.split('.');
    const CustomField = getCustomField(fieldName[fieldName.length - 1] ?? props.display, props.module);
    return (
      <Suspense fallback={<div>Loading custom field...</div>}>
        {CustomField ? <CustomField {...props} /> : <div>Custom field not found</div>}
      </Suspense>
    );
  }

  switch (props.fieldType) {
    case 'input':
    case 'output':
      return <HandleField {...props} />;
    case 'number':
    case 'slider':
      return <NumberField {...props} />;
    case 'filebrowser':
      return <FileBrowserField {...props} />;
    case 'select':
      return <SelectField {...props} />;
    case 'random':
      return <RandomField {...props} />;
    case 'checkbox':
    case 'switch':
      return <ToggleField {...props} />;
    case 'autocomplete':
      return <AutocompleteField {...props} />;
    case 'textarea':
      return <TextareaField {...props} />;
    case 'radio':
      return <RadioField {...props} />;
    case 'range':
      return <RangeField {...props} />;
    case 'spline':
      return (
        <Suspense
          fallback={
            <FieldFrame
              dataKey={props.fieldKey}
              hidden={props.hidden}
              disabled={props.disabled}
              layoutStyle={props.style}
            >
              <div
                role="status"
                className="nodrag nowheel grid min-h-32 place-items-center text-xs text-modiff-subtle-text"
              >
                Loading curve editor…
              </div>
            </FieldFrame>
          }
        >
          <SplineField {...props} />
        </Suspense>
      );
    case 'modelselect':
      return <ModelSelectField {...props} />;
    case 'layerconfig':
      return <LayerConfigField {...props} />;
    case 'selectdialog':
      return <SelectDialogField {...props} />;
    case 'ui_text':
      return <UITextField {...props} />;
    case 'ui_image':
      return <UIImageField {...props} />;
    case 'ui_video':
    case 'ui_audio':
      return (
        <Suspense
          fallback={
            <FieldFrame
              dataKey={props.fieldKey}
              hidden={props.hidden}
              disabled={props.disabled}
              layoutStyle={props.style}
            >
              <div role="status">
                <PreviewEmptyState
                  kind={props.fieldType === 'ui_audio' ? 'audio' : 'visual'}
                  compact={props.fieldOptions?.compactPreview === true}
                  message={`Loading ${props.fieldType === 'ui_audio' ? 'audio' : 'video'} preview…`}
                />
              </div>
            </FieldFrame>
          }
        >
          {props.fieldType === 'ui_audio' ? <UIAudioField {...props} /> : <UIVideoField {...props} />}
        </Suspense>
      );
    case 'ui_button':
      return <UIButtonField {...props} />;
    case 'ui_imagecompare':
      return <UIImagecompareField {...props} />;
    case 'ui_label':
      return <UILabelFieldField {...props} />;
    case 'ui_group':
      // this should never happen, handled in GroupMemo
      return null;
    case 'default':
    case 'string':
    default:
      return <InputField {...props} />;
  }
});

function getFieldType(display: string, dataType: string, options: unknown) {
  dataType = dataType.toLowerCase();

  if (display === 'input' || display === 'output') {
    return display;
  }

  if (dataType.startsWith('bool')) {
    return display === 'checkbox' || display === 'icontoggle' ? display : 'switch';
  }

  if (display.startsWith('ui_')) {
    return display;
  }

  if (dataType === 'text' || display.startsWith('text')) {
    return 'textarea';
  }

  if (display) {
    return display;
  }

  // Backend schemas commonly serialize "no options" as [] or {}. Treating any
  // object as a select turned numeric fields such as Export Video FPS into a
  // disabled "16 (unavailable)" dropdown. Only a real option set is a select.
  if (runtimeOptionValues(options, { includeDisabled: true }).length > 0) {
    return 'select';
  }

  if (dataType.startsWith('int') || dataType === 'float' || dataType === 'number') {
    return display === 'slider' ? 'slider' : 'number';
  }

  return 'text';
}

function isPreviewFieldType(fieldType: string) {
  return ['ui_image', 'ui_video', 'ui_audio', 'ui_text', 'ui_imagecompare'].includes(fieldType);
}
