import type { AnnotationHubGroupMode, AnnotationHubItem } from '@bookorbit/types'

/**
 * The single control at the top of the hub. It picks the grouping and the server sort
 * together, because grouping one page of an infinite list only ever lands on whole groups
 * when the rows arrived already ordered by the same key.
 */
export type HubViewKey = 'newest' | 'oldest' | 'book' | 'color' | 'source'

export interface HubViewSpec {
  group: AnnotationHubGroupMode
  sortBy: 'createdAt' | 'book' | 'color' | 'origin'
  sortDir: 'asc' | 'desc'
}

export const HUB_VIEWS: Record<HubViewKey, HubViewSpec> = {
  newest: { group: 'month', sortBy: 'createdAt', sortDir: 'desc' },
  oldest: { group: 'month', sortBy: 'createdAt', sortDir: 'asc' },
  book: { group: 'book', sortBy: 'book', sortDir: 'asc' },
  color: { group: 'color', sortBy: 'color', sortDir: 'asc' },
  source: { group: 'source', sortBy: 'origin', sortDir: 'asc' },
}

export const HUB_VIEW_KEYS = Object.keys(HUB_VIEWS) as HubViewKey[]

export function isHubViewKey(value: string): value is HubViewKey {
  return value in HUB_VIEWS
}

export interface HubGroup {
  key: string
  mode: AnnotationHubGroupMode
  /** The first item of the group, so a book rule can reach title, author and cover. */
  lead: AnnotationHubItem
  items: AnnotationHubItem[]
}

/** `yyyy-mm` in the viewer's own timezone, so a month rule matches the dates printed under it. */
export function monthKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Same timezone as `monthKey`, and the key the date rail elides repeated days by. */
export function dayKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${monthKey(iso)}-${String(date.getDate()).padStart(2, '0')}`
}

export function hubGroupKey(item: AnnotationHubItem, mode: AnnotationHubGroupMode): string {
  switch (mode) {
    case 'book':
      return String(item.bookId)
    case 'color':
      return item.color
    case 'source':
      return item.origin
    default:
      return monthKey(item.createdAt)
  }
}

/**
 * Walks the rows in the order the server returned them and opens a group whenever the key
 * changes. That is only correct because the view spec sorts by the same key: bucketing here
 * instead would reorder rows the next page then contradicts.
 */
export function buildHubGroups(items: AnnotationHubItem[], mode: AnnotationHubGroupMode): HubGroup[] {
  const groups: HubGroup[] = []
  let current: HubGroup | null = null
  for (const item of items) {
    const key = hubGroupKey(item, mode)
    if (!current || current.key !== key) {
      current = { key, mode, lead: item, items: [] }
      groups.push(current)
    }
    current.items.push(item)
  }
  return groups
}
