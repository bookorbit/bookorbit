export const ACCOUNT_TABS = ['profile', 'notifications', 'restrictions'] as const

export type AccountTab = (typeof ACCOUNT_TABS)[number]

export function normalizeAccountTab(value: unknown): AccountTab {
  if (typeof value === 'string' && ACCOUNT_TABS.includes(value as AccountTab)) {
    return value as AccountTab
  }
  return 'profile'
}
