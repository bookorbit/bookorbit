export const APPEARANCE_TABS = ['theme', 'book-covers', 'icons', 'layout', 'behavior'] as const

export type AppearanceTab = (typeof APPEARANCE_TABS)[number]

export function normalizeAppearanceTab(value: unknown): AppearanceTab {
  if (typeof value === 'string' && APPEARANCE_TABS.includes(value as AppearanceTab)) {
    return value as AppearanceTab
  }
  return 'theme'
}
