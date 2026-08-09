import langs from 'langs';

const DEFAULT_KOBO_LANGUAGE = 'en';

const iso6391ByLanguage = new Map<string, string>();
for (const language of langs.all()) {
  const iso6391 = language['1'];
  if (!iso6391) continue;

  for (const value of [language['1'], language['2'], language['2B'], language['2T'], language['3'], language.name, language.local]) {
    if (value) iso6391ByLanguage.set(value.trim().toLowerCase(), iso6391);
  }
}

export function normalizeKoboLanguage(value: string | null): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_KOBO_LANGUAGE;

  const directMatch = iso6391ByLanguage.get(normalized);
  if (directMatch) return directMatch;

  for (const alias of normalized.split(';')) {
    const aliasMatch = iso6391ByLanguage.get(alias.trim());
    if (aliasMatch) return aliasMatch;
  }

  const primarySubtag = normalized.split(/[-_]/, 1)[0];
  return iso6391ByLanguage.get(primarySubtag) ?? DEFAULT_KOBO_LANGUAGE;
}

function normalizeIsbn(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^0-9Xx]/g, '').toUpperCase();
  return normalized || null;
}

function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;

  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    const digit = index === 9 && value[index] === 'X' ? 10 : Number(value[index]);
    sum += digit * (10 - index);
  }
  return sum % 11 === 0;
}

function isValidIsbn13(value: string): boolean {
  if (!/^97[89]\d{10}$/.test(value)) return false;

  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    sum += Number(value[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

export function selectKoboIsbn(isbn13: string | null, isbn10: string | null): string | null {
  const normalized13 = normalizeIsbn(isbn13);
  if (normalized13 && isValidIsbn13(normalized13)) return normalized13;

  const normalized10 = normalizeIsbn(isbn10);
  return normalized10 && isValidIsbn10(normalized10) ? normalized10 : null;
}
