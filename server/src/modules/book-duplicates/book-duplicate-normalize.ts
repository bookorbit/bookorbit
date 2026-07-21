export function normalizeIsbn(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^0-9Xx]/g, '').toUpperCase();
  return normalized || null;
}

export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const digit = index === 9 && value[index] === 'X' ? 10 : Number(value[index]);
    sum += digit * (10 - index);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(value: string): boolean {
  if (!/^\d{13}$/.test(value) || (!value.startsWith('978') && !value.startsWith('979'))) return false;
  let sum = 0;
  for (let index = 0; index < 13; index += 1) {
    sum += Number(value[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

export function isbn10ToIsbn13(value: string): string {
  const body = `978${value.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

export function canonicalizeIsbn(isbn10: string | null, isbn13: string | null): string | null {
  const normalized13 = normalizeIsbn(isbn13);
  if (normalized13 && isValidIsbn13(normalized13)) return normalized13;

  const normalized10 = normalizeIsbn(isbn10);
  if (normalized10 && isValidIsbn10(normalized10)) return isbn10ToIsbn13(normalized10);
  return null;
}

export function mediaFamilyForFormat(format: string | null): 'ebook' | 'comic' | 'audiobook' | 'unknown' {
  const normalized = format?.toLowerCase();
  if (!normalized) return 'unknown';
  if (['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'].includes(normalized)) return 'audiobook';
  if (['cbz', 'cbr', 'cb7', 'cbx'].includes(normalized)) return 'comic';
  if (['epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'kepub'].includes(normalized)) return 'ebook';
  return 'unknown';
}
