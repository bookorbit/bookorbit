export const BOOK_DETAIL_TABS = ['details', 'edit', 'files'] as const

export type BookDetailTab = (typeof BOOK_DETAIL_TABS)[number]

export function normalizeBookDetailTab(value: unknown): BookDetailTab {
  if (typeof value === 'string' && BOOK_DETAIL_TABS.includes(value as BookDetailTab)) {
    return value as BookDetailTab
  }
  return 'details'
}
