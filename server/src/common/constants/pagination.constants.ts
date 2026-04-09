export const MAX_OFFSET_ROWS = 50_000;

export function isOffsetWithinLimit(offset: number): boolean {
  return offset <= MAX_OFFSET_ROWS;
}
