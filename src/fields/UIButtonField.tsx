// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { FieldProps } from '../components/NodeContent';
import { FieldFrame, ModiffButton } from '../ui';
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
      <ModiffButton
        type="button"
        loading={props.disabled}
        onClick={handleClick}
        fullWidth
        size="dense"
        tone={primary ? 'primary' : 'secondary'}
        className="nodrag"
      >
        <span className="truncate">{props.disabled ? ' ' : props.label || ' '}</span>
      </ModiffButton>
    </FieldFrame>
  );
}
