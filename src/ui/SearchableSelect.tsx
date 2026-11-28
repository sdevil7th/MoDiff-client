import {
  Combobox,
  ComboboxInput,
  ComboboxOptions,
  ComboboxOption,
  Popover,
  PopoverButton,
  PopoverPanel,
} from '@headlessui/react';
import { Check, Search } from 'lucide-react';
import { isValidElement, useState, type ReactNode, type ComponentProps } from 'react';
import { cx } from '../utils/classNames';
import type { ModiffSelectOption, ModiffSelectProps } from './controls';

export const SEARCHABLE_OPTION_COUNT = 16;

function optionText(label: ReactNode): string {
  if (typeof label === 'string' || typeof label === 'number') return String(label);
  if (Array.isArray(label)) return label.map(optionText).join(' ');
  if (isValidElement<{ children?: ReactNode }>(label)) return optionText(label.props.children);
  return '';
}

type SearchableSelectProps = {
  button: ReactNode;
  buttonProps: ComponentProps<'button'>;
  className?: string;
  disabled?: boolean;
  form?: string;
  invalid?: boolean;
  layer?: ModiffSelectProps['layer'];
  multiple?: boolean;
  name?: string;
  onChange: (values: string[]) => void;
  options: readonly ModiffSelectOption[];
  optionsClassName?: string;
  values: string[];
};

export function SearchableSelect({
  button,
  buttonProps,
  className,
  disabled,
  form,
  invalid,
  layer,
  multiple = false,
  name,
  onChange,
  options,
  optionsClassName,
  values,
}: SearchableSelectProps) {
  const [query, setQuery] = useState('');
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const visible = options.filter((option) => {
    const text = [optionText(option.label), option.group, option.value].join(' ').toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  return (
    <Popover as="div" className={cx('relative min-w-0', className)}>
      {({ open, close }) => (
        <Combobox<string, boolean>
          immediate
          multiple={multiple}
          value={multiple ? values : values[0]}
          disabled={disabled}
          invalid={invalid}
          form={form}
          name={name}
          onChange={(next: string | string[] | null) => {
            if (next === null) return;
            onChange(Array.isArray(next) ? next : [next]);
            if (!multiple) close();
          }}
        >
          <PopoverButton
            {...buttonProps}
            type="button"
            disabled={disabled}
            aria-haspopup="dialog"
            onClick={() => setQuery('')}
            onKeyDown={(event) => {
              if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
          >
            {button}
          </PopoverButton>
          {open && (
            <PopoverPanel
              static
              focus
              anchor="bottom start"
              portal
              role="dialog"
              aria-label="Filter choices"
              className={cx(
                'nodrag nowheel w-[var(--button-width)] min-w-[min(18rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] max-h-72 [--anchor-max-height:18rem] flex flex-col overflow-hidden rounded-modiff-panel border border-modiff-border-subtle bg-modiff-surface p-1 font-sans text-modiff-control text-modiff-text shadow-modiff-node',
                layer === 'popover' ? 'z-[120]' : 'z-[100]',
                optionsClassName,
              )}
              onKeyDownCapture={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  close();
                }
              }}
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-modiff-border px-2 py-1.5">
                <Search size={15} aria-hidden="true" className="shrink-0 text-modiff-subtle-text" />
                <ComboboxInput
                  autoFocus
                  aria-label="Search options"
                  autoComplete="off"
                  placeholder="Search options"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="nodrag min-w-0 flex-1 bg-transparent py-1 text-modiff-text outline-none placeholder:text-modiff-subtle-text"
                />
              </div>
              <ComboboxOptions
                static
                modal={false}
                className="nowheel min-h-0 overflow-y-auto overscroll-contain py-1 outline-none"
              >
                {visible.map((option, index) => (
                  <div key={option.value} role="presentation">
                    {option.group && option.group !== visible[index - 1]?.group && (
                      <div className="px-2 py-1 text-modiff-label font-semibold text-modiff-subtle-text">
                        {option.group}
                      </div>
                    )}
                    <ComboboxOption
                      value={option.value}
                      disabled={option.disabled}
                      className="group flex min-h-8 cursor-default items-center gap-2 rounded-modiff-compact px-2 py-1.5 text-left data-[focus]:bg-modiff-selected-surface data-[focus]:text-hf-yellow data-[disabled]:opacity-40"
                    >
                      <Check
                        size={14}
                        aria-hidden="true"
                        className="invisible shrink-0 text-hf-yellow group-data-[selected]:visible"
                      />
                      <span className="min-w-0 break-words">{option.label}</span>
                    </ComboboxOption>
                  </div>
                ))}
              </ComboboxOptions>
              {!visible.length && (
                <p role="status" className="px-2 py-2 text-modiff-subtle-text">
                  No matching options
                </p>
              )}
            </PopoverPanel>
          )}
        </Combobox>
      )}
    </Popover>
  );
}
