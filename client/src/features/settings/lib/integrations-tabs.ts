export const INTEGRATIONS_TABS = ['kobo', 'koreader', 'hardcover'] as const

export type IntegrationsTab = (typeof INTEGRATIONS_TABS)[number]

type IntegrationsTabInfo = {
  navLabel: string
  titleLabel: string
  subtitle: string
}

export const INTEGRATIONS_TAB_INFO: Record<IntegrationsTab, IntegrationsTabInfo> = {
  kobo: {
    navLabel: 'Kobo',
    titleLabel: 'Kobo Sync',
    subtitle: 'Pair your Kobo device to sync your library.',
  },
  koreader: {
    navLabel: 'KOReader',
    titleLabel: 'KOReader Sync',
    subtitle: 'Sync reading progress between KOReader devices and BookOrbit.',
  },
  hardcover: {
    navLabel: 'Hardcover',
    titleLabel: 'Hardcover',
    subtitle: 'Sync your reading progress, status, and ratings to Hardcover.',
  },
}

export function normalizeIntegrationsTab(value: unknown): IntegrationsTab {
  if (typeof value === 'string' && INTEGRATIONS_TABS.includes(value as IntegrationsTab)) {
    return value as IntegrationsTab
  }
  return 'kobo'
}
