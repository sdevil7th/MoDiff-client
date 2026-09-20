import {
  Checkbox,
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Radio,
  RadioGroup,
  Switch,
} from '@headlessui/react';
import { Check, ChevronDown, Minus, Search, X } from 'lucide-react';
import {
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type HTMLAttributes,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cx } from '../utils/classNames';
import { visibleModiffComboboxOptions } from './comboboxOptions';
import { controlHeightClasses, controlMinHeightClasses, type ModiffControlSize } from './controlStyles';
import { ModiffFieldControlContext, useModiffFieldControl } from './fieldContext';
import { ModiffTooltip } from './overlays';

const controlBaseClassName =
  'rounded-modiff-compact border border-modiff-border bg-modiff-bg text-modiff-text transition placeholder:text-modiff-subtle-text hover:border-modiff-border-subtle focus:border-modiff-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-modiff-focus/35 read-only:cursor-default read-only:bg-modiff-disabled/10 disabled:cursor-not-allowed disabled:border-modiff-border disabled:bg-modiff-disabled/15 disabled:text-modiff-subtle-text disabled:opacity-60 aria-invalid:border-modiff-invalid aria-invalid:focus-visible:ring-modiff-invalid/35';

export type ModiffFieldShellProps = {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  descriptionClassName?: string;
  disabled?: boolean;
  error?: ReactNode;
  errorClassName?: string;
  htmlFor?: string;
  label?: ReactNode;
  labelClassName?: string;
  layout?: 'inline' | 'stacked';
  readOnly?: boolean;
  required?: boolean;
};

export function ModiffFieldShell({
  children,
  className,
  description,
  descriptionClassName,
  disabled = false,
  error,
  errorClassName,
  htmlFor,
  label,
  labelClassName,
  layout = 'stacked',
  readOnly = false,
  required = false,
}: ModiffFieldShellProps) {
  const generatedId = useId();
  const controlId = htmlFor ?? `${generatedId}-control`;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <ModiffFieldControlContext.Provider
      value={{
        controlId,
        describedBy,
        disabled,
        errorMessageId: errorId,
        invalid: Boolean(error),
        readOnly,
        required,
      }}
    >
      <div
        className={cx(
          'min-w-0 gap-1',
          layout === 'stacked' ? 'grid' : 'flex items-center',
          disabled && 'opacity-60',
          readOnly && 'data-[readonly=true]:opacity-90',
          className,
        )}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
      >
        {label ? (
          <label
            htmlFor={controlId}
            className={cx('text-modiff-label font-semibold text-modiff-subtle-text', labelClassName)}
          >
            {label}
            {required ? (
              <span className="ml-0.5 text-modiff-invalid" aria-hidden="true">
                *
              </span>
            ) : null}
          </label>
        ) : null}
        {children}
        {description ? (
          <p id={descriptionId} className={cx('text-modiff-metadata text-modiff-subtle-text', descriptionClassName)}>
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className={cx('text-modiff-metadata text-modiff-invalid', errorClassName)} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </ModiffFieldControlContext.Provider>
  );
}

export type ModiffInputProps = InputHTMLAttributes<HTMLInputElement> & {
  controlSize?: ModiffControlSize;
  invalid?: boolean;
};

export const ModiffInput = forwardRef<HTMLInputElement, ModiffInputProps>(function ModiffInput(
  {
    'aria-describedby': ariaDescribedBy,
    'aria-errormessage': ariaErrorMessage,
    'aria-invalid': ariaInvalid,
    className,
    controlSize = 'dense',
    disabled,
    id,
    invalid: invalidProp,
    readOnly,
    required,
    ...props
  },
  ref,
) {
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid: Boolean(invalidProp || ariaInvalid === true || ariaInvalid === 'true'),
    readOnly,
    required,
  });
  return (
    <input
      {...props}
      ref={ref}
      id={field.id}
      aria-describedby={field.ariaDescribedBy}
      aria-errormessage={field.ariaErrorMessage}
      aria-invalid={field.invalid || undefined}
      disabled={field.disabled}
      readOnly={field.readOnly}
      required={field.required}
      className={cx(controlBaseClassName, controlHeightClasses[controlSize], 'w-full px-2', className)}
    />
  );
});

export type ModiffSearchInputProps = Omit<ModiffInputProps, 'type'> & {
  clearLabel?: string;
  onClear?: () => void;
};

export const ModiffSearchInput = forwardRef<HTMLInputElement, ModiffSearchInputProps>(function ModiffSearchInput(
  { className, clearLabel = 'Clear search', controlSize = 'dense', disabled, onClear, readOnly, value, ...props },
  ref,
) {
  const hasValue = value !== undefined && String(value).length > 0;

  return (
    <div className={cx('relative min-w-0', className)}>
      <Search
        size={15}
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-modiff-subtle-text"
        aria-hidden="true"
      />
      <ModiffInput
        {...props}
        ref={ref}
        type="search"
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        controlSize={controlSize}
        className={cx(
          'pl-8 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none',
          onClear && hasValue && 'pr-8',
        )}
      />
      {onClear && hasValue ? (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          disabled={disabled || readOnly}
          onClick={onClear}
          className="absolute right-0.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-modiff-compact text-modiff-subtle-text transition hover:bg-modiff-surface-hover hover:text-modiff-text active:bg-modiff-surface-pressed disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-modiff-focus"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
});

export type ModiffNumberInputProps = Omit<ModiffInputProps, 'onChange' | 'type' | 'value'> & {
  onValueChange: (value: number | null) => void;
  value: number | '';
};

export const ModiffNumberInput = forwardRef<HTMLInputElement, ModiffNumberInputProps>(function ModiffNumberInput(
  { invalid: invalidProp, max, min, onBlur, onValueChange, step, value, ...props },
  ref,
) {
  const [parseInvalid, setParseInvalid] = useState(false);
  const minimum = typeof min === 'number' ? min : Number(min);
  const maximum = typeof max === 'number' ? max : Number(max);
  const stepNumber = typeof step === 'number' ? step : Number(step);

  const normalizeValue = (next: number) => {
    const clamped = Math.max(
      Number.isFinite(minimum) ? minimum : -Infinity,
      Math.min(Number.isFinite(maximum) ? maximum : Infinity, next),
    );
    if (!(Number.isFinite(stepNumber) && stepNumber > 0)) return clamped;

    const base = Number.isFinite(minimum) ? minimum : 0;
    const snapped = base + Math.round((clamped - base) / stepNumber) * stepNumber;
    const precision = Math.min(12, Math.max(0, String(stepNumber).split('.')[1]?.length ?? 0));
    return Number(
      Math.max(
        Number.isFinite(minimum) ? minimum : -Infinity,
        Math.min(Number.isFinite(maximum) ? maximum : Infinity, snapped),
      ).toFixed(precision),
    );
  };

  return (
    <ModiffInput
      {...props}
      ref={ref}
      type="number"
      inputMode={step !== undefined && Number(step) % 1 !== 0 ? 'decimal' : 'numeric'}
      min={min}
      max={max}
      step={step}
      value={value}
      invalid={Boolean(invalidProp || parseInvalid)}
      onChange={(event) => {
        if (event.currentTarget.value === '') {
          setParseInvalid(false);
          onValueChange(null);
          return;
        }
        const next = event.currentTarget.valueAsNumber;
        if (!Number.isFinite(next)) {
          setParseInvalid(true);
          onValueChange(null);
          return;
        }
        setParseInvalid(false);
        onValueChange(normalizeValue(next));
      }}
      onBlur={(event) => {
        setParseInvalid(!event.currentTarget.validity.valid);
        onBlur?.(event);
      }}
    />
  );
});

export type ModiffPasswordInputProps = Omit<ModiffInputProps, 'type'>;

export const ModiffPasswordInput = forwardRef<HTMLInputElement, ModiffPasswordInputProps>(
  function ModiffPasswordInput(props, ref) {
    return <ModiffInput {...props} ref={ref} type="password" />;
  },
);

export type ModiffTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
  resize?: 'none' | 'vertical' | 'both';
  showCharacterCount?: boolean;
};

export const ModiffTextarea = forwardRef<HTMLTextAreaElement, ModiffTextareaProps>(function ModiffTextarea(
  {
    'aria-describedby': ariaDescribedBy,
    'aria-errormessage': ariaErrorMessage,
    'aria-invalid': ariaInvalid,
    className,
    defaultValue,
    disabled,
    id,
    invalid: invalidProp,
    maxLength,
    onChange,
    readOnly,
    required,
    resize = 'vertical',
    showCharacterCount = false,
    value,
    ...props
  },
  ref,
) {
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid: Boolean(invalidProp || ariaInvalid === true || ariaInvalid === 'true'),
    readOnly,
    required,
  });
  const [uncontrolledLength, setUncontrolledLength] = useState(() => String(defaultValue ?? '').length);
  const characterCount = value === undefined ? uncontrolledLength : String(value ?? '').length;
  const textarea = (
    <textarea
      {...props}
      ref={ref}
      id={field.id}
      aria-describedby={field.ariaDescribedBy}
      aria-errormessage={field.ariaErrorMessage}
      aria-invalid={field.invalid || undefined}
      defaultValue={defaultValue}
      disabled={field.disabled}
      maxLength={maxLength}
      readOnly={field.readOnly}
      required={field.required}
      value={value}
      onChange={(event) => {
        setUncontrolledLength(event.currentTarget.value.length);
        onChange?.(event);
      }}
      className={cx(
        controlBaseClassName,
        'min-h-20 w-full px-2 py-1.5 text-sm',
        resize === 'none' && 'resize-none',
        resize === 'vertical' && 'resize-y',
        resize === 'both' && 'resize',
        className,
      )}
    />
  );

  if (!showCharacterCount) return textarea;

  return (
    <div className="grid gap-1">
      {textarea}
      <output className="text-right text-modiff-metadata text-modiff-subtle-text" aria-live="polite">
        {characterCount}
        {typeof maxLength === 'number' ? ` / ${maxLength}` : null}
      </output>
    </div>
  );
});

export type ModiffComboboxOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

export type ModiffComboboxProps = {
  openOnFocus?: boolean;
  wrapOptions?: boolean;
  'aria-describedby'?: string;
  'aria-errormessage'?: string;
  'aria-label': string;
  'data-testid'?: string;
  className?: string;
  disabled?: boolean;
  emptyMessage?: string;
  id?: string;
  invalid?: boolean;
  multiple?: boolean;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onQueryChange: (query: string) => void;
  onValueChange: (value: string | string[] | null) => void;
  options: readonly ModiffComboboxOption[];
  placeholder?: string;
  query: string;
  readOnly?: boolean;
  required?: boolean;
  size?: ModiffControlSize;
  value: string | readonly string[] | null;
};

export function ModiffCombobox({
  openOnFocus = false,
  wrapOptions = false,
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  'aria-label': ariaLabel,
  'data-testid': testId,
  className,
  disabled,
  emptyMessage = 'No options available',
  id,
  invalid,
  multiple = false,
  onBlur,
  onFocus,
  onKeyDown,
  onQueryChange,
  onValueChange,
  options,
  placeholder,
  query,
  readOnly,
  required,
  size = 'dense',
  value,
}: ModiffComboboxProps) {
  const generatedId = useId();
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid,
    readOnly,
    required,
  });
  const inputId = field.id ?? generatedId;
  const selectedValues = multiple ? (Array.isArray(value) ? value : []) : typeof value === 'string' ? [value] : [];
  const [editingQuery, setEditingQuery] = useState(false);
  const visibleOptions = visibleModiffComboboxOptions(options, query, selectedValues, multiple, editingQuery);

  const content = (
    <div className={cx('relative min-w-0 flex-1', className)}>
      <div
        className={cx(
          controlBaseClassName,
          controlMinHeightClasses[size],
          'nodrag nowheel flex w-full min-w-0 flex-wrap items-center gap-1 py-0.5 pl-2 pr-8',
          'focus-within:border-modiff-focus focus-within:ring-2 focus-within:ring-modiff-focus/35',
          field.invalid && 'border-modiff-invalid focus-within:ring-modiff-invalid/35',
        )}
      >
        {multiple
          ? selectedValues.map((selectedValue) => {
              const option = options.find((candidate) => candidate.value === selectedValue);
              const label = option?.label ?? selectedValue;
              return (
                <button
                  key={selectedValue}
                  type="button"
                  aria-label={`Remove ${label}`}
                  disabled={field.disabled || field.readOnly}
                  className="inline-flex min-h-7 max-w-full items-center gap-1 rounded-modiff-compact border border-modiff-border bg-modiff-panel px-2 text-modiff-metadata font-semibold text-modiff-text transition hover:border-hf-yellow/70 hover:bg-modiff-surface-hover active:bg-modiff-surface-pressed disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-modiff-focus"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (field.readOnly) return;
                    onValueChange(selectedValues.filter((item) => item !== selectedValue));
                  }}
                >
                  <span className="truncate">{label}</span>
                  <X size={12} aria-hidden="true" />
                </button>
              );
            })
          : null}
        <ComboboxInput
          id={inputId}
          aria-describedby={field.ariaDescribedBy}
          aria-errormessage={field.ariaErrorMessage}
          aria-invalid={field.invalid || undefined}
          aria-label={ariaLabel}
          aria-readonly={field.readOnly || undefined}
          aria-required={field.required || undefined}
          data-testid={testId}
          disabled={field.disabled}
          readOnly={field.readOnly}
          autoComplete="off"
          placeholder={selectedValues.length === 0 ? placeholder : undefined}
          value={query}
          onChange={(event) => {
            setEditingQuery(true);
            onQueryChange(event.currentTarget.value);
          }}
          onBlur={(event) => {
            onBlur?.(event);
            setEditingQuery(false);
          }}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          className="nodrag min-w-20 flex-1 bg-transparent p-0 text-modiff-control text-modiff-text outline-none placeholder:text-modiff-subtle-text disabled:cursor-not-allowed"
        />
        <ModiffTooltip<HTMLButtonElement> content="Show options">
          {(tooltipProps) => (
            <ComboboxButton
              {...tooltipProps}
              aria-label="Show options"
              disabled={field.disabled || field.readOnly}
              onClick={() => setEditingQuery(false)}
              className="absolute right-0.5 top-0.5 grid size-7 place-items-center rounded-modiff-compact text-modiff-subtle-text transition hover:bg-modiff-surface-hover hover:text-modiff-text active:bg-modiff-surface-pressed disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-modiff-focus"
            >
              <ChevronDown size={14} aria-hidden="true" />
            </ComboboxButton>
          )}
        </ModiffTooltip>
      </div>
      <ComboboxOptions
        anchor="bottom start"
        portal
        modal={false}
        className="z-[100] max-h-72 w-[var(--input-width)] min-w-40 overflow-auto rounded-modiff-panel border border-modiff-border-subtle bg-modiff-surface p-1 font-sans text-modiff-control text-modiff-text shadow-modiff-node outline-none empty:invisible"
      >
        {visibleOptions.length === 0 ? (
          <div className="px-2 py-2 text-modiff-metadata text-modiff-subtle-text">{emptyMessage}</div>
        ) : (
          visibleOptions.map((option) => (
            <ComboboxOption
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="group flex min-h-8 cursor-default select-none items-center gap-2 rounded-modiff-compact px-2 py-1.5 text-left text-modiff-text outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[focus]:bg-modiff-selected-surface data-[focus]:text-hf-yellow"
            >
              <span className="grid size-4 shrink-0 place-items-center text-hf-yellow">
                <Check size={13} className="invisible group-data-[selected]:visible" aria-hidden="true" />
              </span>
              <span
                title={option.label}
                className={cx('min-w-0 flex-1', wrapOptions ? 'break-words whitespace-normal' : 'truncate')}
              >
                {option.label}
              </span>
            </ComboboxOption>
          ))
        )}
      </ComboboxOptions>
    </div>
  );

  if (multiple) {
    return (
      <Combobox
        immediate={openOnFocus}
        multiple
        value={[...selectedValues]}
        onChange={(nextValue) => {
          setEditingQuery(false);
          if (!field.readOnly) onValueChange(nextValue);
        }}
        disabled={field.disabled}
      >
        {content}
      </Combobox>
    );
  }

  return (
    <Combobox
      immediate={openOnFocus}
      value={selectedValues[0] ?? null}
      onChange={(nextValue) => {
        setEditingQuery(false);
        if (!field.readOnly) onValueChange(nextValue);
      }}
      disabled={field.disabled}
    >
      {content}
    </Combobox>
  );
}

export type ModiffSelectOption = {
  disabled?: boolean;
  group?: string;
  label: ReactNode;
  value: string;
};

export type ModiffSelectProps = {
  'aria-describedby'?: string;
  'aria-errormessage'?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
  buttonClassName?: string;
  className?: string;
  disabled?: boolean;
  form?: string;
  id?: string;
  invalid?: boolean;
  name?: string;
  onValueChange: (value: string) => void;
  options: readonly ModiffSelectOption[];
  optionsClassName?: string;
  /** Portal menus must sit above their owning canvas popover. */
  layer?: 'panel' | 'popover';
  placeholder?: ReactNode;
  readOnly?: boolean;
  required?: boolean;
  size?: ModiffControlSize;
  title?: string;
  value: string;
};

export function ModiffSelect({
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'data-testid': testId,
  buttonClassName,
  className,
  disabled,
  form,
  id,
  invalid,
  name,
  onValueChange,
  options,
  optionsClassName,
  layer = 'panel',
  placeholder = 'Select…',
  readOnly,
  required,
  size = 'dense',
  title,
  value,
}: ModiffSelectProps) {
  const generatedId = useId();
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid,
    readOnly,
    required,
  });
  const buttonId = field.id ?? generatedId;
  const selectedOption = options.find((option) => option.value === value);
  const optionGroups = options.reduce<Array<{ group?: string; options: ModiffSelectOption[] }>>((groups, option) => {
    const current = groups[groups.length - 1];
    if (!current || current.group !== option.group) {
      groups.push({ group: option.group, options: [option] });
    } else {
      current.options.push(option);
    }
    return groups;
  }, []);

  const renderOption = (option: ModiffSelectOption) => (
    <ListboxOption
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      className="group flex min-h-8 cursor-default select-none items-center gap-2 rounded-modiff-compact px-2 py-1.5 text-left text-modiff-text outline-none data-[active]:bg-modiff-surface-pressed data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[focus]:bg-modiff-selected-surface data-[focus]:text-hf-yellow"
    >
      <span className="grid size-4 shrink-0 place-items-center text-hf-yellow">
        <Check size={14} className="invisible group-data-[selected]:visible" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
    </ListboxOption>
  );
  const selectButtonClassName = cx(
    controlBaseClassName,
    controlHeightClasses[size],
    'nodrag nowheel flex min-w-0 w-full items-center justify-between gap-2 px-2 text-left',
    !selectedOption && 'text-modiff-subtle-text',
    field.readOnly && 'cursor-default',
    buttonClassName,
  );
  const selectButtonContent = (
    <>
      <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? placeholder}</span>
      <ChevronDown size={14} className="shrink-0 text-modiff-subtle-text" aria-hidden="true" />
    </>
  );

  return (
    <Listbox
      value={value}
      onChange={(nextValue) => {
        if (!field.readOnly) onValueChange(nextValue);
      }}
      disabled={field.disabled}
      invalid={field.invalid}
      name={name}
      form={form}
    >
      <div className={cx('relative min-w-0', className)}>
        {field.readOnly ? (
          <button
            id={buttonId}
            type="button"
            aria-describedby={field.ariaDescribedBy}
            aria-errormessage={field.ariaErrorMessage}
            aria-haspopup="listbox"
            aria-expanded={false}
            aria-invalid={field.invalid || undefined}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-readonly="true"
            aria-required={field.required || undefined}
            data-testid={testId}
            disabled={field.disabled}
            title={title}
            className={selectButtonClassName}
          >
            {selectButtonContent}
          </button>
        ) : (
          <ListboxButton
            id={buttonId}
            aria-describedby={field.ariaDescribedBy}
            aria-errormessage={field.ariaErrorMessage}
            aria-invalid={field.invalid || undefined}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-required={field.required || undefined}
            data-testid={testId}
            title={title}
            className={selectButtonClassName}
          >
            {selectButtonContent}
          </ListboxButton>
        )}
        <ListboxOptions
          anchor="bottom start"
          portal
          modal={false}
          transition
          className={cx(
            'max-h-72 w-[var(--button-width)] min-w-32 overflow-auto rounded-modiff-panel border border-modiff-border-subtle bg-modiff-surface p-1 font-sans text-sm text-modiff-text shadow-modiff-node outline-none transition duration-100 ease-out data-[closed]:pointer-events-none data-[closed]:scale-95 data-[closed]:opacity-0',
            layer === 'popover' ? 'z-[120]' : 'z-[100]',
            optionsClassName,
          )}
        >
          {optionGroups.map((group, groupIndex) => {
            if (!group.group) return group.options.map(renderOption);
            const groupLabelId = `${generatedId}-group-${groupIndex}`;
            return (
              <div key={`${group.group}-${groupIndex}`} role="group" aria-labelledby={groupLabelId}>
                <div
                  id={groupLabelId}
                  className="px-2 pb-1 pt-2 text-modiff-label font-semibold uppercase tracking-wide text-modiff-subtle-text"
                >
                  {group.group}
                </div>
                {group.options.map(renderOption)}
              </div>
            );
          })}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

export type ModiffMultiSelectProps = Omit<ModiffSelectProps, 'onValueChange' | 'value'> & {
  onValueChange: (value: string[]) => void;
  renderValue?: (selectedOptions: readonly ModiffSelectOption[]) => ReactNode;
  value: readonly string[];
};

export function ModiffMultiSelect({
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'data-testid': testId,
  buttonClassName,
  className,
  disabled,
  form,
  id,
  invalid,
  name,
  onValueChange,
  options,
  optionsClassName,
  placeholder = 'Select…',
  readOnly,
  renderValue,
  required,
  size = 'dense',
  title,
  value,
}: ModiffMultiSelectProps) {
  const generatedId = useId();
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid,
    readOnly,
    required,
  });
  const buttonId = field.id ?? generatedId;
  const selectedOptions = options.filter((option) => value.includes(option.value));
  const optionGroups = options.reduce<Array<{ group?: string; options: ModiffSelectOption[] }>>((groups, option) => {
    const current = groups[groups.length - 1];
    if (!current || current.group !== option.group) {
      groups.push({ group: option.group, options: [option] });
    } else {
      current.options.push(option);
    }
    return groups;
  }, []);

  const renderOption = (option: ModiffSelectOption) => (
    <ListboxOption
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      className="group flex min-h-8 cursor-default select-none items-center gap-2 rounded-modiff-compact px-2 py-1.5 text-left text-modiff-text outline-none data-[active]:bg-modiff-surface-pressed data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[focus]:bg-modiff-selected-surface data-[focus]:text-hf-yellow"
    >
      <span className="grid size-4 shrink-0 place-items-center rounded-[3px] border border-modiff-border-subtle bg-modiff-bg text-modiff-on-accent group-data-[selected]:border-hf-yellow group-data-[selected]:bg-hf-yellow">
        <Check size={12} className="invisible group-data-[selected]:visible" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
    </ListboxOption>
  );
  const multiSelectButtonClassName = cx(
    controlBaseClassName,
    controlHeightClasses[size],
    'nodrag nowheel flex min-w-0 w-full items-center justify-between gap-2 px-2 text-left',
    selectedOptions.length === 0 && 'text-modiff-subtle-text',
    field.readOnly && 'cursor-default',
    buttonClassName,
  );
  const multiSelectButtonContent = (
    <>
      <span className="min-w-0 flex-1">
        {selectedOptions.length === 0
          ? placeholder
          : (renderValue?.(selectedOptions) ?? selectedOptions.map((option) => option.label).join(', '))}
      </span>
      <ChevronDown size={14} className="shrink-0 text-modiff-subtle-text" aria-hidden="true" />
    </>
  );

  return (
    <Listbox
      multiple
      value={[...value]}
      onChange={(nextValue) => {
        if (!field.readOnly) onValueChange(nextValue);
      }}
      disabled={field.disabled}
      invalid={field.invalid}
      name={name}
      form={form}
    >
      <div className={cx('relative min-w-0', className)}>
        {field.readOnly ? (
          <button
            id={buttonId}
            type="button"
            aria-describedby={field.ariaDescribedBy}
            aria-errormessage={field.ariaErrorMessage}
            aria-haspopup="listbox"
            aria-expanded={false}
            aria-invalid={field.invalid || undefined}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-readonly="true"
            aria-required={field.required || undefined}
            data-testid={testId}
            disabled={field.disabled}
            title={title}
            className={multiSelectButtonClassName}
          >
            {multiSelectButtonContent}
          </button>
        ) : (
          <ListboxButton
            id={buttonId}
            aria-describedby={field.ariaDescribedBy}
            aria-errormessage={field.ariaErrorMessage}
            aria-invalid={field.invalid || undefined}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-required={field.required || undefined}
            data-testid={testId}
            title={title}
            className={multiSelectButtonClassName}
          >
            {multiSelectButtonContent}
          </ListboxButton>
        )}
        <ListboxOptions
          anchor="bottom end"
          portal
          modal={false}
          transition
          className={cx(
            'z-[100] max-h-72 min-w-[var(--button-width)] overflow-auto rounded-modiff-panel border border-modiff-border-subtle bg-modiff-surface p-1 font-sans text-sm text-modiff-text shadow-modiff-node outline-none transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0',
            optionsClassName,
          )}
        >
          {optionGroups.map((group, groupIndex) => {
            if (!group.group) return group.options.map(renderOption);
            const groupLabelId = `${generatedId}-multi-group-${groupIndex}`;
            return (
              <div key={`${group.group}-${groupIndex}`} role="group" aria-labelledby={groupLabelId}>
                <div
                  id={groupLabelId}
                  className="px-2 pb-1 pt-2 text-modiff-label font-semibold uppercase tracking-wide text-modiff-subtle-text"
                >
                  {group.group}
                </div>
                {group.options.map(renderOption)}
              </div>
            );
          })}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

export type ModiffCheckboxProps = {
  'aria-describedby'?: string;
  'aria-errormessage'?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  checked: boolean;
  className?: string;
  disabled?: boolean;
  form?: string;
  id?: string;
  indeterminate?: boolean;
  invalid?: boolean;
  label: ReactNode;
  name?: string;
  onCheckedChange: (checked: boolean) => void;
  readOnly?: boolean;
  required?: boolean;
  title?: string;
  value?: string;
};

export function ModiffCheckbox({
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  'aria-label': ariaLabel,
  'data-testid': testId,
  checked,
  className,
  disabled,
  form,
  id,
  indeterminate = false,
  invalid,
  label,
  name,
  onCheckedChange,
  readOnly,
  required,
  title,
  value,
}: ModiffCheckboxProps) {
  const labelId = useId();
  const resolvedAriaLabel = ariaLabel ?? (typeof label === 'string' ? label : undefined);
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid,
    readOnly,
    required,
  });

  return (
    <label
      className={cx(
        'inline-flex min-w-0 items-center gap-2 text-modiff-control text-modiff-text',
        field.disabled ? 'cursor-not-allowed' : field.readOnly ? 'cursor-default' : 'cursor-pointer',
        className,
      )}
    >
      <Checkbox
        id={field.id}
        aria-label={resolvedAriaLabel}
        aria-labelledby={resolvedAriaLabel ? undefined : labelId}
        aria-describedby={field.ariaDescribedBy}
        aria-errormessage={field.ariaErrorMessage}
        aria-invalid={field.invalid || undefined}
        aria-readonly={field.readOnly || undefined}
        aria-required={field.required || undefined}
        checked={checked}
        disabled={field.disabled}
        data-testid={testId}
        form={form}
        indeterminate={indeterminate}
        name={name}
        title={title}
        value={value}
        onChange={(nextChecked) => {
          if (!field.readOnly) onCheckedChange(nextChecked);
        }}
        className="group nodrag grid size-4 shrink-0 place-items-center rounded-[3px] border border-modiff-border-subtle bg-modiff-bg text-modiff-on-accent outline-none transition data-[active]:scale-95 data-[checked]:border-hf-yellow data-[checked]:bg-hf-yellow data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[indeterminate]:border-hf-yellow data-[indeterminate]:bg-hf-yellow aria-[invalid=true]:border-modiff-invalid focus-visible:ring-2 focus-visible:ring-modiff-focus/35 aria-[invalid=true]:focus-visible:ring-modiff-invalid/35"
      >
        <Check
          size={12}
          className="invisible col-start-1 row-start-1 group-data-[checked]:visible group-data-[indeterminate]:invisible"
          aria-hidden="true"
        />
        <Minus
          size={12}
          className="invisible col-start-1 row-start-1 group-data-[indeterminate]:visible"
          aria-hidden="true"
        />
      </Checkbox>
      <span id={labelId} className="min-w-0">
        {label}
      </span>
    </label>
  );
}

export type ModiffSwitchProps = {
  'aria-describedby'?: string;
  'aria-errormessage'?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  checked: boolean;
  className?: string;
  disabled?: boolean;
  form?: string;
  id?: string;
  invalid?: boolean;
  label: ReactNode;
  name?: string;
  onCheckedChange: (checked: boolean) => void;
  readOnly?: boolean;
  required?: boolean;
  title?: string;
  value?: string;
};

export function ModiffSwitch({
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  'aria-label': ariaLabel,
  'data-testid': testId,
  checked,
  className,
  disabled,
  form,
  id,
  invalid,
  label,
  name,
  onCheckedChange,
  readOnly,
  required,
  title,
  value,
}: ModiffSwitchProps) {
  const labelId = useId();
  const resolvedAriaLabel = ariaLabel ?? (typeof label === 'string' ? label : undefined);
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid,
    readOnly,
    required,
  });
  return (
    <label
      className={cx(
        'inline-flex min-w-0 items-center gap-2 text-modiff-control text-modiff-text',
        field.disabled ? 'cursor-not-allowed' : field.readOnly ? 'cursor-default' : 'cursor-pointer',
        className,
      )}
    >
      <Switch
        id={field.id}
        checked={checked}
        disabled={field.disabled}
        form={form}
        name={name}
        value={value}
        onChange={(nextChecked) => {
          if (!field.readOnly) onCheckedChange(nextChecked);
        }}
        aria-label={resolvedAriaLabel}
        aria-labelledby={resolvedAriaLabel ? undefined : labelId}
        aria-describedby={field.ariaDescribedBy}
        aria-errormessage={field.ariaErrorMessage}
        aria-invalid={field.invalid || undefined}
        aria-readonly={field.readOnly || undefined}
        aria-required={field.required || undefined}
        data-testid={testId}
        title={title}
        className="group nodrag relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-modiff-border-subtle bg-modiff-disabled/45 outline-none transition data-[active]:bg-modiff-surface-pressed data-[checked]:border-hf-yellow data-[checked]:bg-hf-yellow data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 aria-[invalid=true]:border-modiff-invalid focus-visible:ring-2 focus-visible:ring-modiff-focus/35 aria-[invalid=true]:focus-visible:ring-modiff-invalid/35"
      >
        <span className="ml-0.5 size-4 rounded-full bg-modiff-subtle-text transition group-data-[checked]:translate-x-4 group-data-[checked]:bg-modiff-on-accent" />
      </Switch>
      <span id={labelId} className="min-w-0">
        {label}
      </span>
    </label>
  );
}

export type ModiffRadioOption = {
  disabled?: boolean;
  label: ReactNode;
  value: string;
};

export type ModiffRadioGroupProps = {
  'aria-describedby'?: string;
  'aria-errormessage'?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  className?: string;
  disabled?: boolean;
  form?: string;
  id?: string;
  invalid?: boolean;
  name?: string;
  onValueChange: (value: string) => void;
  options: readonly ModiffRadioOption[];
  readOnly?: boolean;
  required?: boolean;
  value: string;
  variant?: 'default' | 'segmented';
};

export function ModiffRadioGroup({
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  'aria-label': ariaLabel,
  'data-testid': testId,
  className,
  disabled,
  form,
  id,
  invalid,
  name,
  onValueChange,
  options,
  readOnly,
  required,
  value,
  variant = 'default',
}: ModiffRadioGroupProps) {
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid,
    readOnly,
    required,
  });
  return (
    <RadioGroup
      id={field.id}
      aria-label={ariaLabel}
      aria-describedby={field.ariaDescribedBy}
      aria-errormessage={field.ariaErrorMessage}
      aria-invalid={field.invalid || undefined}
      aria-readonly={field.readOnly || undefined}
      aria-required={field.required || undefined}
      data-testid={testId}
      value={value}
      onChange={(nextValue) => {
        if (!field.readOnly) onValueChange(nextValue);
      }}
      disabled={field.disabled}
      form={form}
      name={name}
      className={cx(
        variant === 'segmented'
          ? 'flex rounded-modiff-compact border border-modiff-border bg-modiff-bg p-0.5'
          : 'grid gap-2',
        field.readOnly && 'cursor-default',
        field.invalid && 'rounded-modiff-compact ring-1 ring-modiff-invalid/60',
        className,
      )}
    >
      {options.map((option) => (
        <Radio
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cx(
            'group nodrag flex items-center gap-2 text-modiff-control text-modiff-text outline-none data-[active]:text-hf-yellow data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
            variant === 'segmented' &&
              'rounded-modiff-compact px-2 py-1.5 font-semibold data-[checked]:bg-hf-yellow/15 data-[checked]:text-hf-yellow focus-visible:ring-2 focus-visible:ring-modiff-focus/35',
            field.readOnly ? 'cursor-default' : 'cursor-pointer',
          )}
        >
          {variant === 'default' && (
            <span className="grid size-4 shrink-0 place-items-center rounded-full border border-modiff-border-subtle bg-modiff-bg transition group-data-[active]:bg-modiff-surface-pressed group-data-[checked]:border-hf-yellow group-focus-visible:ring-2 group-focus-visible:ring-modiff-focus/35">
              <span className="size-2 rounded-full bg-hf-yellow opacity-0 group-data-[checked]:opacity-100" />
            </span>
          )}
          <span className="min-w-0">{option.label}</span>
        </Radio>
      ))}
    </RadioGroup>
  );
}

export type ModiffRadioCardOption = {
  description?: ReactNode;
  disabled?: boolean;
  label: ReactNode;
  meta?: ReactNode;
  value: string;
};

export type ModiffRadioCardGroupProps = {
  'aria-label': string;
  className?: string;
  disabled?: boolean;
  onOptionPreview?: (value: string) => void;
  onValueChange: (value: string) => void;
  options: readonly ModiffRadioCardOption[];
  value: string;
};

export function ModiffRadioCardGroup({
  'aria-label': ariaLabel,
  className,
  disabled,
  onOptionPreview,
  onValueChange,
  options,
  value,
}: ModiffRadioCardGroupProps) {
  return (
    <RadioGroup
      aria-label={ariaLabel}
      value={value}
      onChange={onValueChange}
      disabled={disabled}
      className={cx('grid gap-2', className)}
    >
      {options.map((option) => (
        <Radio
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          onPointerEnter={() => onOptionPreview?.(option.value)}
          onFocus={() => onOptionPreview?.(option.value)}
          className="group nodrag flex min-h-10 w-full cursor-pointer items-start gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-surface px-3 py-2 text-left text-modiff-text outline-none transition hover:border-hf-yellow/60 data-[checked]:border-hf-yellow data-[checked]:bg-hf-yellow/10 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 focus-visible:ring-2 focus-visible:ring-modiff-focus/35"
        >
          <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-modiff-border bg-modiff-bg text-modiff-on-accent group-data-[checked]:border-hf-yellow group-data-[checked]:bg-hf-yellow">
            <Check size={11} className="invisible group-data-[checked]:visible" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-modiff-control font-semibold">{option.label}</span>
            {option.description ? (
              <span className="mt-0.5 block text-modiff-metadata text-modiff-subtle-text">{option.description}</span>
            ) : null}
          </span>
          {option.meta ? (
            <span className="text-modiff-label shrink-0 font-semibold uppercase text-modiff-subtle-text">
              {option.meta}
            </span>
          ) : null}
        </Radio>
      ))}
    </RadioGroup>
  );
}

export type ModiffSliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'max' | 'min' | 'onChange' | 'type' | 'value'
> & {
  invalid?: boolean;
  max: number;
  min: number;
  onValueChange: (value: number) => void;
  value: number;
};

export const ModiffSlider = forwardRef<HTMLInputElement, ModiffSliderProps>(function ModiffSlider(
  {
    'aria-describedby': ariaDescribedBy,
    'aria-errormessage': ariaErrorMessage,
    'aria-invalid': ariaInvalid,
    className,
    disabled,
    id,
    invalid,
    max,
    min,
    onValueChange,
    readOnly,
    required,
    step,
    value,
    ...props
  },
  ref,
) {
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid: Boolean(invalid || ariaInvalid === true || ariaInvalid === 'true'),
    readOnly,
    required,
  });
  return (
    <input
      {...props}
      ref={ref}
      id={field.id}
      type="range"
      aria-describedby={field.ariaDescribedBy}
      aria-errormessage={field.ariaErrorMessage}
      aria-invalid={field.invalid || undefined}
      aria-readonly={field.readOnly || undefined}
      aria-required={field.required || undefined}
      disabled={field.disabled}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => {
        if (field.readOnly) return;
        const next = event.currentTarget.valueAsNumber;
        onValueChange(Number.isFinite(next) ? next : value);
      }}
      className={cx(
        'modiff-slider nodrag h-7 w-full cursor-pointer rounded-full outline-none aria-[readonly=true]:cursor-default disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-modiff-invalid focus-visible:ring-2 focus-visible:ring-modiff-focus/35 aria-[invalid=true]:focus-visible:ring-modiff-invalid/35',
        className,
      )}
    />
  );
});

export type ModiffBadgeTone = 'default' | 'success' | 'error' | 'warning';

const badgeToneClasses: Record<ModiffBadgeTone, string> = {
  default: 'border-modiff-border bg-modiff-panel text-modiff-subtle-text',
  success: 'border-modiff-green/60 bg-modiff-green/10 text-modiff-green',
  error: 'border-modiff-invalid/60 bg-modiff-invalid/10 text-modiff-invalid',
  warning: 'border-modiff-warning/60 bg-modiff-warning/10 text-modiff-warning',
};

export type ModiffBadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  children: ReactNode;
  tone?: ModiffBadgeTone;
};

export function ModiffBadge({ children, className, tone = 'default', ...props }: ModiffBadgeProps) {
  return (
    <span
      {...props}
      className={cx(
        'inline-flex min-h-6 items-center rounded-modiff-compact border px-2 py-0.5 text-modiff-metadata font-semibold',
        badgeToneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type ModiffChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & {
  active?: boolean;
  tone?: ModiffBadgeTone;
};

export function ModiffChip({
  active = false,
  children,
  className,
  tone = 'default',
  type = 'button',
  ...props
}: ModiffChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cx(
        'inline-flex min-h-7 items-center rounded-modiff-compact border px-2 py-0.5 text-modiff-metadata font-semibold transition active:bg-modiff-surface-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modiff-focus disabled:pointer-events-none disabled:opacity-50',
        active
          ? 'border-hf-yellow bg-hf-yellow text-modiff-on-accent active:bg-modiff-primary-pressed'
          : cx(
              badgeToneClasses[tone],
              'hover:border-hf-yellow/70 hover:bg-modiff-surface-hover hover:text-modiff-text',
            ),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export type ModiffTabOption<TValue extends string = string> = {
  className?: string;
  controls?: string;
  disabled?: boolean;
  id?: string;
  label: ReactNode;
  testId?: string;
  value: TValue;
};

export type ModiffTabsProps<TValue extends string = string> = {
  'aria-label': string;
  className?: string;
  onWheel?: HTMLAttributes<HTMLDivElement>['onWheel'];
  onValueChange: (value: TValue) => void;
  options: readonly ModiffTabOption<TValue>[];
  size?: ModiffControlSize;
  testId?: string;
  value: TValue;
};

function focusRelativeTab(current: HTMLButtonElement, direction: 1 | -1) {
  const tabList = current.closest<HTMLElement>('[role="tablist"]');
  const tabs = Array.from(tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? []);
  const currentIndex = tabs.indexOf(current);
  if (currentIndex < 0 || tabs.length < 2) return;
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  tabs[nextIndex]?.focus();
}

export type ModiffTabListProps = HTMLAttributes<HTMLDivElement> & {
  'aria-label': string;
};

export const ModiffTabList = forwardRef<HTMLDivElement, ModiffTabListProps>(function ModiffTabList(
  { 'aria-label': ariaLabel, children, className, ...props },
  ref,
) {
  return (
    <div ref={ref} {...props} role="tablist" aria-label={ariaLabel} className={cx('flex flex-wrap gap-1', className)}>
      {children}
    </div>
  );
});

export type ModiffTabProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  appearance?: 'accent' | 'surface';
  onSelect: () => void;
  selected: boolean;
  size?: ModiffControlSize;
};

export function ModiffTab({
  appearance = 'accent',
  children,
  className,
  onKeyDown,
  onSelect,
  selected,
  size = 'normal',
  type = 'button',
  ...props
}: ModiffTabProps) {
  return (
    <button
      {...props}
      type={type}
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          focusRelativeTab(event.currentTarget, 1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          focusRelativeTab(event.currentTarget, -1);
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const tabList = event.currentTarget.closest<HTMLElement>('[role="tablist"]');
          const tabs = Array.from(tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? []);
          tabs[event.key === 'Home' ? 0 : tabs.length - 1]?.focus();
        }
      }}
      className={cx(
        controlHeightClasses[size],
        'inline-flex items-center rounded-modiff-compact px-3 font-semibold transition active:bg-modiff-surface-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modiff-focus disabled:pointer-events-none disabled:opacity-50',
        selected
          ? appearance === 'surface'
            ? 'bg-modiff-selected-surface text-hf-yellow active:bg-modiff-surface-pressed'
            : 'bg-hf-yellow text-modiff-on-accent active:bg-modiff-primary-pressed'
          : 'text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-modiff-text',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ModiffTabs<TValue extends string>({
  'aria-label': ariaLabel,
  className,
  onWheel,
  onValueChange,
  options,
  size = 'normal',
  testId,
  value,
}: ModiffTabsProps<TValue>) {
  return (
    <ModiffTabList aria-label={ariaLabel} className={className} onWheel={onWheel} data-testid={testId}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <ModiffTab
            key={option.value}
            id={option.id}
            aria-controls={option.controls}
            disabled={option.disabled}
            data-testid={option.testId}
            onSelect={() => onValueChange(option.value)}
            selected={selected}
            size={size}
            className={option.className}
          >
            {option.label}
          </ModiffTab>
        );
      })}
    </ModiffTabList>
  );
}

export type ModiffFileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const ModiffFileInput = forwardRef<HTMLInputElement, ModiffFileInputProps>(function ModiffFileInput(
  {
    'aria-describedby': ariaDescribedBy,
    'aria-errormessage': ariaErrorMessage,
    'aria-invalid': ariaInvalid,
    className,
    disabled,
    id,
    readOnly,
    required,
    ...props
  },
  ref,
) {
  const field = useModiffFieldControl({
    ariaDescribedBy,
    ariaErrorMessage,
    disabled,
    id,
    invalid: ariaInvalid === true || ariaInvalid === 'true',
    readOnly,
    required,
  });
  return (
    <input
      {...props}
      ref={ref}
      id={field.id}
      type="file"
      aria-describedby={field.ariaDescribedBy}
      aria-errormessage={field.ariaErrorMessage}
      aria-invalid={field.invalid || undefined}
      aria-readonly={field.readOnly || undefined}
      disabled={field.disabled || field.readOnly}
      required={field.required}
      className={cx('modiff-file-input text-sm text-modiff-text', className)}
    />
  );
});

export type ModiffDisclosureProps = {
  'aria-describedby'?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  buttonClassName?: string;
  children: ReactNode;
  className?: string;
  /** Keep the same panel mounted when switching to an always-visible presentation. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  disabled?: boolean;
  id?: string;
  label: ReactNode;
  onOpenChange?: (open: boolean) => void;
  panelClassName?: string;
  unmount?: boolean;
};

export function ModiffDisclosure({
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
  'data-testid': testId,
  buttonClassName,
  children,
  className,
  collapsible = true,
  defaultOpen = false,
  disabled,
  id,
  label,
  onOpenChange,
  panelClassName,
  unmount = true,
}: ModiffDisclosureProps) {
  const field = useModiffFieldControl({ ariaDescribedBy, disabled, id });
  return (
    <Disclosure defaultOpen={defaultOpen} as="div" className={className} data-testid={testId}>
      {({ open }) => (
        <>
          <DisclosureButton
            hidden={!collapsible}
            id={field.id}
            aria-label={ariaLabel}
            aria-describedby={field.ariaDescribedBy}
            disabled={field.disabled}
            onClick={() => onOpenChange?.(!open)}
            className={cx(
              'flex min-h-8 w-full items-center justify-between gap-2 rounded-modiff-compact px-2 text-left text-sm font-semibold text-modiff-text transition hover:bg-modiff-surface-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-modiff-focus',
              buttonClassName,
            )}
          >
            <span className="min-w-0 flex-1">{label}</span>
            <ChevronDown
              size={14}
              className={cx('shrink-0 text-modiff-subtle-text transition', open && 'rotate-180')}
              aria-hidden="true"
            />
          </DisclosureButton>
          <DisclosurePanel static={!collapsible} unmount={unmount} className={panelClassName}>
            {children}
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  );
}
