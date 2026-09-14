function normalizeSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Every keyword must occur in the entry; spacing, separators and word order are insignificant. */
export function matchesSearchKeywords(search: string, fields: readonly (string | undefined)[]) {
  if (!search.trim()) return true;
  const query = normalizeSearchText(search);
  // A punctuation-only query must not accidentally match the entire library.
  if (!query) return false;
  const text = normalizeSearchText(fields.filter(Boolean).join(' '));
  return query.split(/\s+/u).every((keyword) => text.includes(keyword));
}
