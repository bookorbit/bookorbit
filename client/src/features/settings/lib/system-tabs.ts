export const SYSTEM_TABS = ['file-naming', 'book-dock', 'requests', 'maintenance', 'audit-log'] as const

export type SystemTab = (typeof SYSTEM_TABS)[number]

export function normalizeSystemTab(value: unknown): SystemTab {
  if (typeof value === 'string' && SYSTEM_TABS.includes(value as SystemTab)) {
    return value as SystemTab
  }
  return 'file-naming'
}
