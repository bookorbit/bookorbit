/**
 * Strict comparison keys for suggesting a manual link from an unmatched KOReader book's title and
 * authors. Only case, Unicode compatibility forms and whitespace are folded: a missed suggestion
 * costs one manual search, while a wrong one sends a device copy's reading history to another book.
 */
export function linkSuggestionTextKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return key.length > 0 ? key : null;
}

/** KOReader reports several authors on separate lines. */
export function koreaderAuthorKeys(authors: string | null | undefined): string[] {
  return authorKeys((authors ?? '').split('\n'));
}

export function authorKeys(names: readonly (string | null | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const name of names) {
    const key = linkSuggestionTextKey(name);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

export function sameAuthorKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((key, index) => key === b[index]);
}
