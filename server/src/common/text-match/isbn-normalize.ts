/** Strips separators and case so two spellings of one ISBN compare equal. */
export function normalizeIsbn(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

/**
 * The only generic piece of the ISBN helpers: string in, comparable string out. The
 * candidate-shaped ones stay in `metadata-fetch`, because a release name and a byte count are not
 * a `MetadataCandidate`.
 */
export function normalizeMetadataIsbn(value: string | null | undefined): string {
  return value ? normalizeIsbn(value) : '';
}
