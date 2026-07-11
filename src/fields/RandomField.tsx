import { FieldProps } from '../components/NodeContent';

import InputField from './InputField';
import { WandSparkles } from 'lucide-react';
import { FieldFrame } from '../ui';
import { cx } from '../utils/classNames';

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
        <button
          type="button"
          className={cx(
            'nodrag grid size-7 shrink-0 place-items-center rounded-modiff-compact text-gray-400 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow disabled:pointer-events-none disabled:opacity-40',
            isRandom && 'text-hf-yellow opacity-100',
            !isRandom && 'opacity-60',
          )}
          disabled={props.disabled}
          onClick={randomToggle}
          aria-pressed={Boolean(isRandom)}
          aria-label={`Toggle random ${props.label}`}
          title="Toggle random"
        >
          <WandSparkles size={16} />
        </button>
      </div>
    </FieldFrame>
  );
}
