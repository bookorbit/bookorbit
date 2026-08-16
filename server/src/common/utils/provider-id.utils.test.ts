import { bookMetadata } from '../../db/schema';
import { boundProviderId, PROVIDER_ID_MAX_LENGTHS, type ProviderIdField } from './provider-id.utils';

const FIELDS = Object.keys(PROVIDER_ID_MAX_LENGTHS) as ProviderIdField[];

/** `lubimyczytac_id` is a `text` column, so its entry is an API bound with no storage width to match. */
const UNBOUNDED_COLUMNS: readonly ProviderIdField[] = ['lubimyczytacId'];

function column(field: ProviderIdField): { columnType: string; length?: number } {
  return bookMetadata[field] as unknown as { columnType: string; length?: number };
}

describe('provider id bounds', () => {
  // This is the guard the original defect needed: the DTO capped amazonId at 20 because the column
  // did, and nothing tied the two together. See issue #1015.
  it('matches every declared bound to its book_metadata column width', () => {
    for (const field of FIELDS) {
      if (UNBOUNDED_COLUMNS.includes(field)) continue;
      const { columnType, length } = column(field);
      expect({ field, columnType, length }).toEqual({ field, columnType: 'PgVarchar', length: PROVIDER_ID_MAX_LENGTHS[field] });
    }
  });

  it('only exempts columns that really are unbounded', () => {
    for (const field of UNBOUNDED_COLUMNS) {
      expect(column(field).columnType).toBe('PgText');
    }
  });

  it('covers every provider id column the metadata table declares', () => {
    const declared = Object.keys(bookMetadata).filter((key) => /(Id)$/.test(key) && key !== 'bookId' && key !== 'seriesId');
    expect(new Set(declared)).toEqual(new Set(FIELDS));
  });
});

describe('boundProviderId', () => {
  it('keeps a value that fits, including one sitting exactly on the bound', () => {
    expect(boundProviderId('amazonId', 'B0G3YRNY6Y')).toBe('B0G3YRNY6Y');
    expect(boundProviderId('amazonId', 'A'.repeat(20))).toBe('A'.repeat(20));
  });

  it('drops rather than truncates a value that overflows', () => {
    expect(boundProviderId('amazonId', 'A'.repeat(21))).toBeNull();
    expect(boundProviderId('amazonId', 'https://www.amazon.com/dp/0345415000')).toBeNull();
  });

  it('applies the bound belonging to the named field', () => {
    const value = 'C'.repeat(60);
    expect(boundProviderId('googleBooksId', value)).toBeNull();
    expect(boundProviderId('hardcoverId', value)).toBe(value);
  });

  it('preserves null and undefined so callers keep cleared distinct from absent', () => {
    expect(boundProviderId('amazonId', null)).toBeNull();
    expect(boundProviderId('amazonId', undefined)).toBeUndefined();
  });

  it('leaves the empty string alone rather than inventing a null', () => {
    expect(boundProviderId('amazonId', '')).toBe('');
  });
});
