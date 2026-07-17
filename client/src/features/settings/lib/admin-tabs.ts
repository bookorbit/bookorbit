export const ADMIN_TABS = ['users', 'account-activity', 'oidc', 'magic-links'] as const

export type AdminTab = (typeof ADMIN_TABS)[number]

type AdminTabInfo = {
  permission: string | null
  titleKey: string
}

export const ADMIN_TAB_INFO: Record<AdminTab, AdminTabInfo> = {
  users: {
    permission: 'manage_users',
    titleKey: 'titles.admin.users',
  },
  'account-activity': {
    permission: 'view_user_activity',
    titleKey: 'titles.admin.account-activity',
  },
  'magic-links': {
    permission: null,
    titleKey: 'titles.admin.magic-links',
  },
  oidc: {
    permission: 'manage_app_settings',
    titleKey: 'titles.admin.oidc',
  },
}

export function normalizeAdminTab(value: unknown): AdminTab {
  if (typeof value === 'string' && ADMIN_TABS.includes(value as AdminTab)) {
    return value as AdminTab
  }
  return 'users'
}
