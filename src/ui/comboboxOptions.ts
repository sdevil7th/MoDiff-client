export type ComboboxFilterOption = {
  label: string;
  value: string;
};

export function visibleModiffComboboxOptions<T extends ComboboxFilterOption>(
  options: readonly T[],
  query: string,
  selectedValues: readonly string[],
  multiple: boolean,
  editing = false,
) {
  const normalizedQuery = query.trim().toLowerCase();
  const selectedLabel =
    !multiple && selectedValues[0]
      ? (options.find((option) => option.value === selectedValues[0])?.label ?? selectedValues[0])
      : '';
  // Free-form fields persist each keystroke. Their query can equal the selected
  // value while the user is still typing; reopening every option lets Tab
  // silently commit the first unrelated model instead of the entered repository.
  const queryIsSelectedValue = !editing && !multiple && normalizedQuery === selectedLabel.trim().toLowerCase();
  return normalizedQuery && !queryIsSelectedValue
    ? options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
    : options;
}
