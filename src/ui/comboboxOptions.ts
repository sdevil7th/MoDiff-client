export type ComboboxFilterOption = {
  label: string;
  value: string;
};

export function visibleModiffComboboxOptions<T extends ComboboxFilterOption>(
  options: readonly T[],
  query: string,
  selectedValues: readonly string[],
  multiple: boolean,
) {
  const normalizedQuery = query.trim().toLowerCase();
  const selectedLabel =
    !multiple && selectedValues[0]
      ? (options.find((option) => option.value === selectedValues[0])?.label ?? selectedValues[0])
      : '';
  const queryIsSelectedValue = !multiple && normalizedQuery === selectedLabel.trim().toLowerCase();
  return normalizedQuery && !queryIsSelectedValue
    ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : options;
}
