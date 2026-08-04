import { createContext, useContext } from 'react';

export type ModiffFieldControlContextValue = {
  controlId: string;
  describedBy?: string;
  disabled: boolean;
  errorMessageId?: string;
  invalid: boolean;
  readOnly: boolean;
  required: boolean;
};

export const ModiffFieldControlContext = createContext<ModiffFieldControlContextValue | null>(null);

function mergeIdRefs(...values: Array<string | undefined>) {
  const ids = values
    .flatMap((value) => value?.split(/\s+/) ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  return ids.length > 0 ? [...new Set(ids)].join(' ') : undefined;
}

export type ModiffFieldControlOverrides = {
  ariaDescribedBy?: string;
  ariaErrorMessage?: string;
  disabled?: boolean;
  id?: string;
  invalid?: boolean;
  readOnly?: boolean;
  required?: boolean;
};

export function useModiffFieldControl({
  ariaDescribedBy,
  ariaErrorMessage,
  disabled,
  id,
  invalid,
  readOnly,
  required,
}: ModiffFieldControlOverrides) {
  const context = useContext(ModiffFieldControlContext);
  return {
    ariaDescribedBy: mergeIdRefs(ariaDescribedBy, context?.describedBy),
    ariaErrorMessage: mergeIdRefs(ariaErrorMessage, context?.errorMessageId),
    disabled: Boolean(disabled || context?.disabled),
    id: context?.controlId ?? id,
    invalid: Boolean(invalid || context?.invalid),
    readOnly: Boolean(readOnly || context?.readOnly),
    required: Boolean(required || context?.required),
  };
}
