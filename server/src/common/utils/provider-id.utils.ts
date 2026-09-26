/**
 * Storage bound for each provider identifier, mirroring the `book_metadata` column widths.
 * A parsed identifier longer than its column cannot survive: Postgres rejects the write with
 * 22001, and the metadata DTO rejects the next manual save with a 400 that names a field the
 * user never typed into. Bounding at the point of parse keeps both from happening.
 *
 * `lubimyczytac_id` is a `text` column, so 512 is the API bound rather than a storage limit.
 */
export const PROVIDER_ID_MAX_LENGTHS = {
  googleBooksId: 50,
  goodreadsId: 50,
  amazonId: 20,
  hardcoverId: 255,
  hardcoverEditionId: 50,
  openLibraryId: 50,
  itunesId: 50,
  audibleId: 20,
  librofmId: 50,
  koboId: 255,
  comicvineId: 50,
  ranobedbId: 50,
  lubimyczytacId: 512,
  aladinId: 20,
  mangabakaId: 50,
  mangabakaSeriesId: 50,
} as const;

export type ProviderIdField = keyof typeof PROVIDER_ID_MAX_LENGTHS;

/**
 * Drops an identifier that cannot fit its column instead of truncating it. A value that overflows
 * is not a long identifier, it is a different kind of value: a Calibre `<dc:identifier
 * opf:scheme="AMAZON">` holding a product URL is not a 20-character ASIN, and its first 20
 * characters are not one either. Storing nothing beats storing a corrupted prefix.
 *
 * `undefined` is preserved so callers can keep "field absent" distinct from "field cleared".
 */
export function boundProviderId(field: ProviderIdField, value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  return value.length > PROVIDER_ID_MAX_LENGTHS[field] ? null : value;
}
