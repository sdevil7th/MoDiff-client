// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { FieldProps } from '../components/NodeContent';

import InputField from './InputField';
import { WandSparkles } from 'lucide-react';
import { FieldFrame } from '../ui';
import { GraphIconButton } from '../ui/GraphControls';

export default function RandomField(props: FieldProps) {
  const valueRecord =
    typeof props.value === 'object' && props.value !== null && !Array.isArray(props.value)
      ? (props.value as Record<string, unknown>)
      : null;
  const fieldValue = valueRecord && 'value' in valueRecord ? valueRecord.value || 0 : props.value || 0;
  const isRandom = valueRecord && 'isRandom' in valueRecord ? Boolean(valueRecord.isRandom) : false;

  const randomToggle = () => {
    props.updateStore(props.fieldKey, { value: fieldValue, isRandom: !isRandom });
  };

  const handleFieldChange = (key: string, value: unknown) => {
    props.updateStore(key, { value, isRandom });
  };

  return (
    <FieldFrame
      dataKey={`${props.fieldKey}-random`}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="modiff-field"
    >
      <div className="flex w-full items-center gap-2">
        <InputField
          {...props}
          value={fieldValue}
          disabled={props.disabled || isRandom}
          updateStore={handleFieldChange}
        />
        <GraphIconButton
          label={`Toggle random ${props.label}`}
          active={Boolean(isRandom)}
          className="shrink-0"
          disabled={props.disabled}
          onClick={randomToggle}
          aria-pressed={Boolean(isRandom)}
        >
          <WandSparkles size={16} />
        </GraphIconButton>
      </div>
    </FieldFrame>
  );
}
