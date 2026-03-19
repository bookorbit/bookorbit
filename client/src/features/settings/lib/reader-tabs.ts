export const READER_TABS = ['general', 'ebook', 'pdf', 'comics'] as const

export type ReaderTab = (typeof READER_TABS)[number]

export const READER_TAB_LABELS: Record<ReaderTab, string> = {
  general: 'General',
  ebook: 'eBook',
  pdf: 'PDF',
  comics: 'Comics',
}

export const READER_TAB_TITLE_LABELS: Record<ReaderTab, string> = {
  general: 'Reader Settings',
  ebook: 'eBook Reader',
  pdf: 'PDF Reader',
  comics: 'Comics Reader',
}

export function normalizeReaderTab(value: unknown): ReaderTab {
  if (typeof value === 'string' && READER_TABS.includes(value as ReaderTab)) {
    return value as ReaderTab
  }
  return 'ebook'
}
