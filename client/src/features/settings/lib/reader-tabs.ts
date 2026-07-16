export const READER_TABS = ['general', 'ebook', 'pdf', 'comics', 'audio', 'fonts'] as const

export type ReaderTab = (typeof READER_TABS)[number]

export function normalizeReaderTab(value: unknown): ReaderTab {
  if (typeof value === 'string' && READER_TABS.includes(value as ReaderTab)) {
    return value as ReaderTab
  }
  return 'ebook'
}
