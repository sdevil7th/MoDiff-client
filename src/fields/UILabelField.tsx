// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { FieldFrame } from '../ui/FieldFrame';
import { FieldProps } from '../components/NodeContent';

export default function UILabelField(props: FieldProps) {
  const value = props.value === null || props.value === undefined ? ' ' : String(props.value);
  return (
    <FieldFrame dataKey={props.fieldKey} hidden={props.hidden} layoutStyle={props.style}>
      <span className="text-modiff-control block truncate text-modiff-subtle-text" title={value}>
        {value}
      </span>
    </FieldFrame>
  );
}
