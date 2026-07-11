import { FieldProps } from '../components/NodeContent';
import fieldAction from '../utils/fieldAction';
import { useInitialFieldAction } from '../utils/useInitialFieldAction';
import { FieldFrame } from '../ui';
import { cx } from '../utils/classNames';

export default function RadioField(props: FieldProps) {
  const options = Array.isArray(props.options)
    ? props.options.map((value) => ({ value: String(value), label: String(value) }))
    : Object.entries(props.options).map(([key, value]) => ({ value: key, label: value }));

  const handleOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    props.updateStore(props.fieldKey, e.target.value);
    fieldAction(props, e.target.value);
  };

  useInitialFieldAction(props);

  return (
    <FieldFrame
      data-key={props.fieldKey}
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="modiff-field"
    >
      <div
        className={cx('flex gap-2', props.fieldOptions?.row ? 'flex-row flex-wrap items-center' : 'flex-col')}
        role="radiogroup"
        aria-label={props.label}
      >
        {options.map((option) => (
          <label
            key={String(option.value)}
            className="flex cursor-pointer items-center gap-1.5 pr-2 text-sm text-modiff-text"
          >
            <input
              type="radio"
              className="nodrag size-4 accent-hf-yellow"
              name={`${props.nodeId}-${props.fieldKey}`}
              value={String(option.value)}
              checked={String(props.value) === String(option.value)}
              disabled={props.disabled}
              onChange={handleOnChange}
            />
            <span className="min-w-0 truncate">{String(option.label)}</span>
          </label>
        ))}
      </div>
    </FieldFrame>
  );
}
