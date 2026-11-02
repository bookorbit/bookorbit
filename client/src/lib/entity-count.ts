export interface CountableEntity {
  bookCount?: number | null
}

/** An entity's book count, or null when it carries none, so callers render no badge instead of a misleading zero. */
export function entityCount(item: CountableEntity): number | null {
  return typeof item.bookCount === 'number' ? item.bookCount : null
}
