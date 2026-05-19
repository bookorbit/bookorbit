export const SYSTEM_TABS = ['file-naming', 'book-dock', 'maintenance', 'audit-log'] as const

export type SystemTab = (typeof SYSTEM_TABS)[number]

type SystemTabInfo = {
  navLabel: string
  titleLabel: string
  subtitle: string
  permission: string | null
}

export const SYSTEM_TAB_INFO: Record<SystemTab, SystemTabInfo> = {
  'file-naming': {
    navLabel: 'File Naming',
    titleLabel: 'File Naming',
    subtitle: 'Control how files are organized on disk when uploaded and how they are named when downloaded using placeholder tokens.',
    permission: 'manage_app_settings',
  },
  'book-dock': {
    navLabel: 'Book Dock',
    titleLabel: 'Book Dock',
    subtitle: 'Configure how files are processed when they enter Book Dock.',
    permission: 'book_dock_access',
  },
  maintenance: {
    navLabel: 'Maintenance',
    titleLabel: 'Maintenance',
    subtitle: 'Manage background tasks, system indices, and maintenance operations.',
    permission: 'manage_app_settings',
  },
  'audit-log': {
    navLabel: 'Audit Log',
    titleLabel: 'Audit Log',
    subtitle: 'A record of admin-significant actions performed across the system.',
    permission: null,
  },
}

export function normalizeSystemTab(value: unknown): SystemTab {
  if (typeof value === 'string' && SYSTEM_TABS.includes(value as SystemTab)) {
    return value as SystemTab
  }
  return 'file-naming'
}
