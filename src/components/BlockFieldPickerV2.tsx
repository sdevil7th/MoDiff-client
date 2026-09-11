import { useState } from 'react';
import { ModiffCombobox, type ModiffSelectProps } from '../ui';

/** Search changes the option list, never the bound semantic endpoint. */
export default function BlockFieldPickerV2({
  value,
  options,
  onValueChange,
  placeholder,
  disabled,
  ...props
}: ModiffSelectProps) {
  const [search, setSearch] = useState<string | null>(null);
  const label = options.find((option) => option.value === value)?.label ?? '';
  return (
    <div className="min-w-0" title={typeof label === 'string' ? label : undefined}>
      <ModiffCombobox
        openOnFocus
        wrapOptions
        id={props.id}
        invalid={props.invalid}
        readOnly={props.readOnly}
        required={props.required}
        size={props.size}
        aria-describedby={props['aria-describedby']}
        aria-label={props['aria-label'] ?? (typeof placeholder === 'string' ? placeholder : 'Search internal fields')}
        data-testid={props['data-testid']}
        disabled={disabled}
        value={value || null}
        query={search ?? (typeof label === 'string' ? label : '')}
        onQueryChange={setSearch}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => setSearch(null)}
        onValueChange={(next) => {
          if (typeof next === 'string') onValueChange(next);
          setSearch(null);
        }}
        options={options.map((option) => ({ ...option, label: String(option.label) }))}
        placeholder={typeof placeholder === 'string' ? placeholder : 'Search internal fields'}
        emptyMessage="No matching internal fields"
      />
      {typeof label === 'string' && label ? (
        <p className="mt-1 break-words text-xs text-modiff-subtle-text">{label}</p>
      ) : null}
    </div>
  );
}
