// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { FieldProps } from '../components/NodeContent';
import fieldAction from '../utils/fieldAction';
import { useInitialFieldAction } from '../utils/useInitialFieldAction';
import { FieldFrame, ModiffRadioGroup } from '../ui';
import { cx } from '../utils/classNames';
import { runtimeOptionEntries } from '../studio/runtimeOptions';

export default function RadioField(props: FieldProps) {
  const options = runtimeOptionEntries(props.options)
    .filter((entry) => entry.type === 'option')
    .map((entry) => ({
      value: entry.value,
      label: <span title={entry.disabledReason}>{entry.label}</span>,
      disabled: entry.disabled,
    }));

  const handleOnChange = (value: string) => {
    props.updateStore(props.fieldKey, value);
    fieldAction(props, value);
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
      <ModiffRadioGroup
        className={cx('flex gap-2', props.fieldOptions?.row ? 'flex-row flex-wrap items-center' : 'flex-col')}
        aria-label={props.label}
        name={props.inputId ?? `${props.nodeId}-${props.fieldKey}`}
        options={options}
        value={String(props.value)}
        disabled={props.disabled}
        onValueChange={handleOnChange}
      />
    </FieldFrame>
  );
}
