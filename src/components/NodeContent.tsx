import { lazy, memo, ReactNode, Suspense } from 'react';
import { NodeParams, type NodeParamOptions, type NodeParamSignal } from '../stores/useNodeStore';
import { sanitizeModiffFieldStyle, type ModiffFieldStyle } from '../theme';
import type { ImageArtifact } from '../utils/imageArtifacts';

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
import SplineField from '../fields/SplineField';
import ModelSelectField from '../fields/ModelSelectField';
import LayerConfigField from '../fields/LayerConfigField';
import SelectDialogField from '../fields/SelectDialogField';

import UITextField from '../fields/UITextField';
import UIImageField from '../fields/UIImageField';
import UIButtonField from '../fields/UIButtonField';
import UILabelFieldField from '../fields/UILabelField';
import UIGroupField from '../fields/UIGroupField';
import UIImagecompareField from '../fields/UIImagecompareField';
import UIVideoField from '../fields/UIVideoField';
import UIAudioField from '../fields/UIAudioField';

export type FieldProps = {
  nodeId: string;
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
  fieldType: string;
  updateStore: (param: string, value: unknown, key?: keyof NodeParams) => void;
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
};

type NodeContentProps = {
  nodeId: string;
  params: Record<string, NodeParams>;
  updateStore: (param: string, value: unknown, key?: keyof NodeParams) => void;
  module: string;
  action: string;
  groupHandles?: boolean;
  handlesOnly?: boolean;
  compactHandles?: boolean;
  hideHandles?: boolean;
  executionStatus?: string;
  progressMessage?: string;
  uiStateMessage?: string;
};

const NodeContent = memo(function NodeContent({
  nodeId,
  params,
  updateStore,
  module,
  action,
  groupHandles = false,
  handlesOnly = false,
  compactHandles = false,
  hideHandles = false,
  executionStatus,
  progressMessage,
  uiStateMessage,
}: NodeContentProps) {
  const fields = Object.entries(params).map(([key, data]: [string, NodeParams]) => {
    const label = data.label ?? key.charAt(0).toUpperCase() + key.slice(1);
    const display = data.isInput ? 'input' : data.display || '';
    const dataType = (
      Array.isArray(data.type) && data.type.length > 0 ? data.type[0] : data.type || 'string'
    ) as string;
    const fieldType = getFieldType(display, dataType, data.options);
    const hidden = data.hidden || false;
    const value = data.value ?? data.default;
    const isConnected = display === 'input' || display === 'output' ? data.isConnected || false : undefined;

    const props = {
      nodeId,
      value,
      label,
      display,
      isConnected,
      dataType,
      fieldType,
      hidden,
      updateStore,
      module,
      action,
      onChange: data.onChange,
      fieldKey: key,
      default: data.default,
      options: data.options || [],
      style: sanitizeModiffFieldStyle(data.style, `${nodeId}.${key}`),
      disabled: data.disabled || false,
      min: data.min,
      max: data.max,
      step: data.step,
      fieldOptions: data.fieldOptions || {},
      artifacts: data.artifacts,
      executionStatus,
      progressMessage,
      uiStateMessage,
      optionsSource: data.optionsSource || {},
      signal: data.signal,
      onSignal: data.onSignal,
    };

    return { key, props };
  });
  const renderFields = hideHandles
    ? fields.filter(({ props }) => props.fieldType !== 'input' && props.fieldType !== 'output')
    : fields;

  if (groupHandles) {
    const inputs = fields.filter(({ props }) => props.fieldType === 'input');
    const outputs = fields.filter(({ props }) => props.fieldType === 'output');
    const others = fields.filter(({ props }) => props.fieldType !== 'input' && props.fieldType !== 'output');
    const inputRailClassName = compactHandles
      ? 'absolute left-[-4px] top-1/2 z-10 flex w-5 -translate-y-1/2 flex-col items-center gap-1 py-1'
      : 'absolute left-[-20px] top-1/2 -translate-y-1/2 rounded-modiff-compact bg-modiff-panel py-0.5 text-xs';
    const outputRailClassName = compactHandles
      ? 'absolute right-[-4px] top-1/2 z-10 flex w-5 -translate-y-1/2 flex-col items-center gap-1 py-1'
      : 'absolute right-[-20px] top-1/2 -translate-y-1/2 rounded-modiff-compact bg-modiff-panel py-0.5 text-xs';

    return (
      <>
        {inputs.length > 0 && (
          <div className={inputRailClassName}>
            {inputs.map(({ key, props }) => (
              <FieldMemo key={key} {...props} compactHandle={compactHandles} />
            ))}
          </div>
        )}
        {outputs.length > 0 && (
          <div className={outputRailClassName}>
            {outputs.map(({ key, props }) => (
              <FieldMemo key={key} {...props} compactHandle={compactHandles} />
            ))}
          </div>
        )}
        {!handlesOnly && others.length > 0 && (
          <div>
            {others.map(({ key, props }) => (
              <FieldMemo key={key} {...props} />
            ))}
          </div>
        )}
      </>
    );
  }

  // Search `ui_group` fields and collect their children
  const groupFields: Record<string, { props: FieldProps; children: { key: string; props: FieldProps }[] }> = {};
  const groupedFieldKeys = new Set<string>();

  renderFields.forEach(({ key, props }) => {
    if (props.fieldType === 'ui_group' && Array.isArray(props.options)) {
      groupFields[key] = { props, children: [] };
      props.options.forEach((option) => {
        const optionKey = String(option);
        const child = renderFields.find((field) => field.key === optionKey);
        if (child && !groupedFieldKeys.has(optionKey)) {
          groupFields[key]?.children.push(child);
          groupedFieldKeys.add(optionKey); // Mark as grouped
        }
      });
    }
  });

  // Build the final ordered list of fields to render
  const orderedFields = renderFields
    .filter(({ key }) => !groupedFieldKeys.has(key)) // Exclude children of groups from the top level
    .map(({ key, props }) => {
      const group = groupFields[key];
      if (group) {
        // This is a group, render it with its children
        return (
          <GroupMemo key={key} {...props}>
            {group.children.map(({ key: childKey, props: childProps }) => (
              <FieldMemo key={childKey} {...childProps} />
            ))}
          </GroupMemo>
        );
      }
      // This is a regular field
      return <FieldMemo key={key} {...props} />;
    });

  return orderedFields;
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
      return <SplineField {...props} />;
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
      return <UIVideoField {...props} />;
    case 'ui_audio':
      return <UIAudioField {...props} />;
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

  if (options && typeof options === 'object') {
    return 'select';
  }

  if (dataType.startsWith('int') || dataType === 'float' || dataType === 'number') {
    return display === 'slider' ? 'slider' : 'number';
  }

  return 'text';
}
