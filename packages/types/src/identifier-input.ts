/**
 * How a hand-entered identifier is cleaned before it is stored. An identifier copied from a store
 * page carries its print formatting (hyphens, spaces) and often an invisible character such as a
 * zero-width space or a bidi mark. None of these belong to the identifier, and a field that looks
 * right while holding one is very hard to diagnose. Cleaning never truncates: an over-long result
 * stays over-long so validation can name it.
 */
export type IdentifierInputKind = "isbn" | "asin" | "provider-id";

/**
 * The cleaning rule for each editable identifier field. Only ISBNs and ASINs have a fixed alphabet;
 * every other provider id keeps its punctuation, because Google Books ids and Hardcover and Kobo
 * slugs legitimately contain `-` and `_`.
 */
export const IDENTIFIER_INPUT_KIND_BY_FIELD = {
  isbn10: "isbn",
  isbn13: "isbn",
  amazonId: "asin",
  audibleId: "asin",
  googleBooksId: "provider-id",
  goodreadsId: "provider-id",
  hardcoverId: "provider-id",
  hardcoverEditionId: "provider-id",
  openLibraryId: "provider-id",
  itunesId: "provider-id",
  librofmId: "provider-id",
  koboId: "provider-id",
  comicvineId: "provider-id",
  ranobedbId: "provider-id",
  lubimyczytacId: "provider-id",
  aladinId: "provider-id",
} as const satisfies Record<string, IdentifierInputKind>;

export type IdentifierInputField = keyof typeof IDENTIFIER_INPUT_KIND_BY_FIELD;

// Whitespace plus Unicode control (Cc) and format (Cf) characters: zero-width spaces and joiners,
// bidi marks, the byte-order mark and the soft hyphen.
const INVISIBLE_OR_WHITESPACE = /[\s\p{Cc}\p{Cf}]/gu;

// Amazon prints "ISBN-13 : 978-...". Without this the label's digits survive the digit filter and
// prefix the real number. The colon is required so an ISBN-10 starting with 10 or 13 is never cut.
const NUMBERED_ISBN_LABEL = /^ISBN\p{Pd}?1[03]:/iu;

/** Keeps the digits and the ISBN-10 check character `X`, so `978-3426226223` becomes `9783426226223`. */
export function normalizeIsbnInput(value: string): string {
  return value
    .normalize("NFKC")
    .replace(INVISIBLE_OR_WHITESPACE, "")
    .replace(NUMBERED_ISBN_LABEL, "")
    .toUpperCase()
    .replace(/[^0-9X]/g, "");
}

/** ASINs are upper-case alphanumerics; anything else is formatting or an invisible character. */
export function normalizeAsinInput(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

/** Removes only whitespace and invisible characters, which no provider id contains. */
export function normalizeProviderIdInput(value: string): string {
  return value.replace(INVISIBLE_OR_WHITESPACE, "");
}

export function normalizeIdentifierInput(kind: IdentifierInputKind, value: string): string {
  switch (kind) {
    case "isbn":
      return normalizeIsbnInput(value);
    case "asin":
      return normalizeAsinInput(value);
    case "provider-id":
      return normalizeProviderIdInput(value);
  }
}

export function identifierInputKindForField(field: string): IdentifierInputKind | null {
  return Object.prototype.hasOwnProperty.call(IDENTIFIER_INPUT_KIND_BY_FIELD, field)
    ? IDENTIFIER_INPUT_KIND_BY_FIELD[field as IdentifierInputField]
    : null;
}
