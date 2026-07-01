export const ADMIN_TABS = ['users', 'oidc', 'magic-links'] as const

export type AdminTab = (typeof ADMIN_TABS)[number]

type AdminTabInfo = {
  permission: string | null
}

export const ADMIN_TAB_INFO: Record<AdminTab, AdminTabInfo> = {
  users: {
    permission: 'manage_users',
  },
  'magic-links': {
    permission: null,
  },
  oidc: {
    permission: 'manage_app_settings',
  },
}

export function normalizeAdminTab(value: unknown): AdminTab {
  if (typeof value === 'string' && ADMIN_TABS.includes(value as AdminTab)) {
    return value as AdminTab
  }
  return 'users'
}
