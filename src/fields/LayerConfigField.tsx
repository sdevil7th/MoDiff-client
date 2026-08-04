// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { FieldProps } from '../components/NodeContent';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FieldFrame, ModiffCheckbox, ModiffFieldShell, RangeSliderFrame } from '../ui';
import { GraphControlInput } from '../ui/GraphControls';

type LayerConfigValue = {
  dropout?: unknown;
  dropout_visible?: unknown;
  skip_checkboxes_visible?: unknown;
  indices?: unknown;
  skip_attention?: unknown;
  skip_attention_scores?: unknown;
  skip_ff?: unknown;
};

function asLayerConfig(value: unknown): LayerConfigValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as LayerConfigValue) : {};
}

export default function LayerConfigField(props: FieldProps) {
  const { fieldKey, updateStore } = props;
  const fieldValue = asLayerConfig(props.value);
  const fallbackValue = Number.isFinite(Number(props.default)) ? Number(props.default) : 1.0;

  const getCurrentValue = () => {
    const dropoutValue = fieldValue.dropout ?? fallbackValue;
    const value = isNaN(Number(dropoutValue)) ? fallbackValue : Number(dropoutValue);
    const clampedValue = Math.min(1.0, Math.max(0.01, value));
    return clampedValue * 100;
  };

  const getDisplayValue = (sliderValue: number) => {
    return Math.min(1.0, Math.max(0.01, sliderValue / 100)).toFixed(2);
  };
  const currentSliderValue = getCurrentValue();
  const currentIndices = typeof fieldValue.indices === 'string' ? fieldValue.indices : '';
  const [draftDropout, setDraftDropout] = useState(currentSliderValue);
  const [draftIndices, setDraftIndices] = useState(currentIndices);
  const skipNextIndicesCommitRef = useRef(false);

  useEffect(() => {
    setDraftDropout(currentSliderValue);
  }, [currentSliderValue]);

  useEffect(() => {
    setDraftIndices(currentIndices);
  }, [currentIndices]);

  const commitSliderValue = useCallback(
    (newValue: number | [number, number]) => {
      const sliderValue = Array.isArray(newValue) ? newValue[0] : newValue;
      const actualValue = Math.min(1.0, Math.max(0.01, sliderValue / 100));
      const updatedValue = {
        ...fieldValue,
        dropout: Number(actualValue.toFixed(2)),
      };
      updateStore(fieldKey, updatedValue);
    },
    [fieldValue, fieldKey, updateStore],
  );

  const commitIndices = useCallback(
    (value: string) => {
      if (value === currentIndices) return;
      const updatedValue = {
        ...fieldValue,
        indices: value,
      };
      updateStore(fieldKey, updatedValue);
    },
    [currentIndices, fieldKey, fieldValue, updateStore],
  );

  const handleCheckboxChange = (property: string) => (checked: boolean) => {
    const updatedValue = {
      ...fieldValue,
      [property]: checked,
    };
    props.updateStore(props.fieldKey, updatedValue);
  };

  const dropoutVisible = fieldValue.dropout_visible ?? true;
  const skipCheckboxesVisible = fieldValue.skip_checkboxes_visible ?? true;

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="modiff-field"
    >
      <ModiffFieldShell
        htmlFor={`${props.nodeId}-${props.fieldKey}`}
        label={props.label}
        disabled={props.disabled}
        labelClassName="font-normal text-modiff-text"
        className="nodrag nowheel rounded-modiff-compact border border-modiff-border-subtle px-2 py-1"
      >
        {dropoutVisible && (
          <div className="flex w-full items-center gap-2">
            <RangeSliderFrame
              className="min-w-0 flex-1 px-0 py-0"
              value={draftDropout}
              onChange={(value) => setDraftDropout(Array.isArray(value) ? value[0] : value)}
              onCommit={commitSliderValue}
              disabled={props.disabled}
              min={1}
              max={100}
            />
            <span className="w-9 text-right text-xs text-modiff-subtle-text">{getDisplayValue(draftDropout)}</span>
          </div>
        )}

        <div className="flex w-full items-center">
          <GraphControlInput
            id={`${props.nodeId}-${props.fieldKey}`}
            value={draftIndices}
            onChange={(event) => setDraftIndices(event.target.value)}
            onBlur={(event) => {
              if (skipNextIndicesCommitRef.current) {
                skipNextIndicesCommitRef.current = false;
                return;
              }
              commitIndices(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                skipNextIndicesCommitRef.current = true;
                setDraftIndices(currentIndices);
                event.currentTarget.blur();
              }
            }}
            placeholder="Indices"
            title="Layer Indices"
            disabled={props.disabled}
            className="text-modiff-tiny min-w-0 flex-1 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 py-1 text-modiff-text outline-none focus:border-modiff-focus disabled:cursor-not-allowed disabled:opacity-50"
          />
          {skipCheckboxesVisible && (
            <>
              <LayerCheckbox
                checked={Boolean(fieldValue.skip_attention)}
                disabled={props.disabled}
                label="SA"
                title="Skip Attention"
                onChange={handleCheckboxChange('skip_attention')}
              />
              <LayerCheckbox
                checked={Boolean(fieldValue.skip_attention_scores)}
                disabled={props.disabled}
                label="SAS"
                title="Skip Attention Scores"
                onChange={handleCheckboxChange('skip_attention_scores')}
              />
              <LayerCheckbox
                checked={Boolean(fieldValue.skip_ff)}
                disabled={props.disabled}
                label="SFF"
                title="Skip Feed-forward Blocks"
                onChange={handleCheckboxChange('skip_ff')}
              />
            </>
          )}
        </div>
      </ModiffFieldShell>
    </FieldFrame>
  );
}

function LayerCheckbox({
  checked,
  disabled,
  label,
  onChange,
  title,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <ModiffCheckbox
      aria-label={title}
      checked={checked}
      disabled={disabled}
      label={label}
      onCheckedChange={onChange}
      className="text-modiff-label ml-1 gap-0.5"
    />
  );
}
