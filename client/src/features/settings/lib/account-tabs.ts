export const ACCOUNT_TABS = ['profile', 'notifications', 'restrictions'] as const

export type AccountTab = (typeof ACCOUNT_TABS)[number]

type AccountTabInfo = {
  navLabel: string
  titleLabel: string
  subtitle: string
}

export const ACCOUNT_TAB_INFO: Record<AccountTab, AccountTabInfo> = {
  profile: {
    navLabel: 'Profile',
    titleLabel: 'Account',
    subtitle: 'Manage your personal profile settings.',
  },
  notifications: {
    navLabel: 'Notifications',
    titleLabel: 'Notifications',
    subtitle: 'Choose which notification categories you want to receive.',
  },
  restrictions: {
    navLabel: 'Restrictions',
    titleLabel: 'Content Restrictions',
    subtitle: 'View content restrictions applied to your account.',
  },
}

export function normalizeAccountTab(value: unknown): AccountTab {
  if (typeof value === 'string' && ACCOUNT_TABS.includes(value as AccountTab)) {
    return value as AccountTab
  }
  return 'profile'
}
