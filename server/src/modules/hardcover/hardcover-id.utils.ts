const GRAPHQL_INT_MAX = 2_147_483_647;

export function parseHardcoverBookId(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= GRAPHQL_INT_MAX ? id : null;
}

export const parseHardcoverEditionId = parseHardcoverBookId;

/**
 * The identifiers a Hardcover link was resolved from. A cached link is only re-checked when this
 * changes, so a corrected Hardcover ID or ISBN moves the link without querying on every sync.
 */
export function buildHardcoverMatchBasis(book: { hardcoverMetadataId: string | null; isbn13: string | null; isbn10: string | null }): string {
  return JSON.stringify([book.hardcoverMetadataId ?? null, book.isbn13 ?? null, book.isbn10 ?? null]);
}
