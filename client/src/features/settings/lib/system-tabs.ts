import { Permission } from '@bookorbit/types'

export const SYSTEM_TABS = ['file-naming', 'book-dock', 'maintenance', 'audit-log'] as const

export type SystemTab = (typeof SYSTEM_TABS)[number]

type SystemTabInfo = {
  permission: Permission | null
}

export const SYSTEM_TAB_INFO: Record<SystemTab, SystemTabInfo> = {
  'file-naming': {
    permission: Permission.ManageAppSettings,
  },
  'book-dock': {
    permission: Permission.ManageBookDock,
  },
  maintenance: {
    permission: Permission.ManageAppSettings,
  },
  'audit-log': {
    permission: null,
  },
}

export function normalizeSystemTab(value: unknown): SystemTab {
  if (typeof value === 'string' && SYSTEM_TABS.includes(value as SystemTab)) {
    return value as SystemTab
  }
  return 'file-naming'
}
