export const APPEARANCE_TABS = ['theme', 'book-covers', 'layout', 'behavior'] as const

export type AppearanceTab = (typeof APPEARANCE_TABS)[number]

export const APPEARANCE_TAB_LABELS: Record<AppearanceTab, string> = {
  theme: 'Theme',
  'book-covers': 'Book Covers',
  layout: 'Layout',
  behavior: 'Behavior',
}

export const APPEARANCE_TAB_TITLE_LABELS: Record<AppearanceTab, string> = {
  theme: 'Display',
  'book-covers': 'Book Covers',
  layout: 'Display Layout',
  behavior: 'Library Behavior',
}

export function normalizeAppearanceTab(value: unknown): AppearanceTab {
  if (typeof value === 'string' && APPEARANCE_TABS.includes(value as AppearanceTab)) {
    return value as AppearanceTab
  }
  return 'theme'
}
