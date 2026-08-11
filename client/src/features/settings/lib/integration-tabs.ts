import { Permission } from '@bookorbit/types'

export const INTEGRATION_TABS = ['hardcover', 'readwise', 'storygraph'] as const

export type IntegrationTab = (typeof INTEGRATION_TABS)[number]

type IntegrationTabInfo = {
  labelKey: string
  titleKey: string
  permission: Permission
}

export const INTEGRATION_TAB_INFO: Record<IntegrationTab, IntegrationTabInfo> = {
  hardcover: {
    labelKey: 'settings.integrations.tabs.hardcover',
    titleKey: 'settings.integrations.tabs.hardcover',
    permission: Permission.HardcoverSync,
  },
  readwise: {
    labelKey: 'settings.integrations.tabs.readwise',
    titleKey: 'settings.integrations.tabs.readwise',
    permission: Permission.ReadwiseSync,
  },
  storygraph: {
    labelKey: 'settings.integrations.tabs.storygraph',
    titleKey: 'settings.integrations.tabs.storygraph',
    permission: Permission.StorygraphSync,
  },
}

export function normalizeIntegrationTab(value: unknown): IntegrationTab {
  if (typeof value === 'string' && INTEGRATION_TABS.includes(value as IntegrationTab)) {
    return value as IntegrationTab
  }
  return 'hardcover'
}
