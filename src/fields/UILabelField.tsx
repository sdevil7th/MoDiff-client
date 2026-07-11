import { FieldFrame } from '../ui/FieldFrame';
import { FieldProps } from '../components/NodeContent';

export default function UILabelField(props: FieldProps) {
  const value = props.value === null || props.value === undefined ? ' ' : String(props.value);
  return (
    <FieldFrame dataKey={props.fieldKey} hidden={props.hidden} layoutStyle={props.style}>
      <span className="block truncate text-[13px] text-modiff-muted" title={value}>
        {value}
      </span>
    </FieldFrame>
  );
}
