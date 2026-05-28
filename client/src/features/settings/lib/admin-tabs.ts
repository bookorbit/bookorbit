export const ADMIN_TABS = ['users', 'magic-links', 'oidc'] as const

export type AdminTab = (typeof ADMIN_TABS)[number]

type AdminTabInfo = {
  navLabel: string
  titleLabel: string
  subtitle: string
  permission: string | null
}

export const ADMIN_TAB_INFO: Record<AdminTab, AdminTabInfo> = {
  users: {
    navLabel: 'Users',
    titleLabel: 'Users',
    subtitle: 'Manage user accounts and permission assignments.',
    permission: 'manage_users',
  },
  'magic-links': {
    navLabel: 'Magic Links',
    titleLabel: 'Magic Links',
    subtitle: 'Create shareable login links for shared accounts.',
    permission: null,
  },
  oidc: {
    navLabel: 'OIDC / SSO',
    titleLabel: 'OIDC / SSO',
    subtitle: 'Manage OpenID Connect providers for single sign-on.',
    permission: 'manage_app_settings',
  },
}

export function normalizeAdminTab(value: unknown): AdminTab {
  if (typeof value === 'string' && ADMIN_TABS.includes(value as AdminTab)) {
    return value as AdminTab
  }
  return 'users'
}
