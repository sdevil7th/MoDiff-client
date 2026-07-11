import { LoaderCircle } from 'lucide-react';
import { FieldProps } from '../components/NodeContent';
import { FieldFrame } from '../ui/FieldFrame';
import { cx } from '../utils/classNames';
import fieldAction from '../utils/fieldAction';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export default function UIButtonField(props: FieldProps) {
  const handleClick = async () => {
    const action =
      typeof props.onChange === 'string' ? 'exec' : isRecord(props.onChange) ? props.onChange.action : undefined;
    const data =
      typeof props.onChange === 'string' ? props.onChange : isRecord(props.onChange) ? props.onChange.data : undefined;
    // ButtonField supports only exec action for now.
    if (action !== 'exec') {
      return;
    }
    fieldAction(props, data);
  };

  const variant = typeof props.fieldOptions?.variant === 'string' ? props.fieldOptions.variant : 'outlined';
  const color = typeof props.fieldOptions?.color === 'string' ? props.fieldOptions.color : 'primary';
  const primary = variant === 'contained' || color === 'primary';

  return (
    <FieldFrame dataKey={props.fieldKey} hidden={props.hidden} layoutStyle={props.style} className="nodrag">
      <button
        type="button"
        disabled={props.disabled}
        onClick={handleClick}
        className={cx(
          'inline-flex h-8 w-full items-center justify-center gap-2 px-3 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
          primary
            ? 'bg-hf-yellow text-black hover:bg-hf-orange'
            : 'border border-modiff-border bg-modiff-surface text-gray-200 hover:border-hf-yellow/70 hover:text-white',
        )}
      >
        {props.disabled ? <LoaderCircle size={16} className="animate-spin" /> : null}
        <span className="truncate">{props.disabled ? ' ' : props.label || ' '}</span>
      </button>
    </FieldFrame>
  );
}
