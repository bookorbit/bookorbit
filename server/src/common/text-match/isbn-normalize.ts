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

export function splitMetadataIsbn(value: string | null | undefined): { isbn10?: string; isbn13?: string } {
  const normalized = normalizeMetadataIsbn(value);
  if (/^[0-9]{9}[0-9X]$/.test(normalized)) return { isbn10: normalized };
  if (/^97[89][0-9]{10}$/.test(normalized)) return { isbn13: normalized };
  return {};
}

export function isValidIsbn10(n: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/.test(n)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = n[i];
    const v = c === 'X' ? 10 : c.charCodeAt(0) - 48;
    sum += (i + 1) * v;
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(n: string): boolean {
  if (!/^97[89][0-9]{10}$/.test(n)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const v = n.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? v : v * 3;
  }
  return sum % 10 === 0;
}

export function canonicalIsbn13(value: string | null | undefined): string | undefined {
  const normalized = normalizeMetadataIsbn(value);
  if (isValidIsbn13(normalized)) return normalized;
  if (!isValidIsbn10(normalized)) return undefined;
  const prefix = `978${normalized.slice(0, 9)}`;
  const sum = [...prefix].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${prefix}${(10 - (sum % 10)) % 10}`;
}
