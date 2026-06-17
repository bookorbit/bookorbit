export interface IsbnHit {
  value: string;
  kind: 10 | 13;
  labeled: boolean;
}

const LABEL_LOOKBACK = 25;

export function normalizeIsbn(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
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

/**
 * Find checksum-valid ISBN-10/13 strings inside free text. Each hit records whether
 * an "ISBN" label sits just before it. De-duplicates by value, upgrading to labeled
 * if any occurrence of the same value was labeled.
 */
export function findIsbnInText(text: string): IsbnHit[] {
  const candidate = /[0-9][0-9\s-]{7,16}[0-9Xx]/g;
  const byValue = new Map<string, IsbnHit>();

  for (const match of text.matchAll(candidate)) {
    const norm = normalizeIsbn(match[0]);
    let kind: 10 | 13 | null = null;
    if (norm.length === 13 && isValidIsbn13(norm)) kind = 13;
    else if (norm.length === 10 && isValidIsbn10(norm)) kind = 10;
    if (kind === null) continue;

    const idx = match.index ?? 0;
    const before = text.slice(Math.max(0, idx - LABEL_LOOKBACK), idx).toLowerCase();
    const labeled = before.includes('isbn');

    const existing = byValue.get(norm);
    if (!existing) byValue.set(norm, { value: norm, kind, labeled });
    else if (labeled && !existing.labeled) existing.labeled = true;
  }

  return [...byValue.values()];
}

/**
 * Pick the most trustworthy ISBN from a set of hits. Only labeled hits are eligible
 * (precision); prefers ISBN-13 over ISBN-10. Returns a single form, mirroring the
 * OPF parser's parseIsbn (no ISBN-10 -> 13 conversion).
 */
export function pickBestIsbn(hits: IsbnHit[]): { isbn10: string | null; isbn13: string | null } {
  const labeled = hits.filter((h) => h.labeled);
  const best13 = labeled.find((h) => h.kind === 13);
  if (best13) return { isbn10: null, isbn13: best13.value };
  const best10 = labeled.find((h) => h.kind === 10);
  if (best10) return { isbn10: best10.value, isbn13: null };
  return { isbn10: null, isbn13: null };
}
