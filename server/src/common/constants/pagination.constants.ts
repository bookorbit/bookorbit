export const MAX_OFFSET_ROWS = 50_000;

// Book query endpoints support jump-rail deep links (e.g. jumping to 'Z' in a
// very large library resolves to a deep page), so they get a dedicated, much
// higher ceiling. Generic endpoints only ever page forward a few times and
// keep the shallow bound.
export const MAX_BOOK_QUERY_OFFSET_ROWS = 1_000_000;

export function isOffsetWithinLimit(offset: number): boolean {
  return offset <= MAX_OFFSET_ROWS;
}

export function isBookQueryOffsetWithinLimit(offset: number): boolean {
  return offset <= MAX_BOOK_QUERY_OFFSET_ROWS;
}
