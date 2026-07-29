import { Permission } from '@bookorbit/types'

export const INTEGRATION_TABS = ['hardcover', 'readwise', 'storygraph', 'shelfmark'] as const

export type IntegrationTab = (typeof INTEGRATION_TABS)[number]

type IntegrationTabInfo = {
  navLabel: string
  titleLabel: string
  permission?: Permission
}

export const INTEGRATION_TAB_INFO: Record<IntegrationTab, IntegrationTabInfo> = {
  hardcover: {
    navLabel: 'Hardcover',
    titleLabel: 'Hardcover',
    permission: Permission.HardcoverSync,
  },
  readwise: {
    navLabel: 'Readwise',
    titleLabel: 'Readwise',
    permission: Permission.ReadwiseSync,
  },
  storygraph: {
    navLabel: 'StoryGraph',
    titleLabel: 'StoryGraph',
    permission: Permission.StorygraphSync,
  },
  shelfmark: {
    navLabel: 'Shelfmark',
    titleLabel: 'Shelfmark',
  },
}

export function normalizeIntegrationTab(value: unknown): IntegrationTab {
  if (typeof value === 'string' && INTEGRATION_TABS.includes(value as IntegrationTab)) {
    return value as IntegrationTab
  }
  return 'hardcover'
}
