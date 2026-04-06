export const METADATA_TABS = ['providers', 'field-rules', 'score', 'auto-fetch', 'authors'] as const

export type MetadataTab = (typeof METADATA_TABS)[number]

type MetadataTabInfo = {
  navLabel: string
  titleLabel: string
  subtitle: string
}

export const METADATA_TAB_INFO: Record<MetadataTab, MetadataTabInfo> = {
  providers: {
    navLabel: 'Providers',
    titleLabel: 'Providers',
    subtitle: 'Enable external metadata sources and configure their credentials.',
  },
  'field-rules': {
    navLabel: 'Field Rules',
    titleLabel: 'Field-Level Rules',
    subtitle: 'Control which provider supplies each metadata field and how values are merged across your libraries.',
  },
  score: {
    navLabel: 'Score',
    titleLabel: 'Confidence Score',
    subtitle: 'Assign weights to metadata fields to calculate how much to trust fetched results.',
  },
  'auto-fetch': {
    navLabel: 'Books',
    titleLabel: 'Book Auto-Fetch',
    subtitle: 'Automatically fetch covers, descriptions, and other details when new books are added to your library.',
  },
  authors: {
    navLabel: 'Authors',
    titleLabel: 'Author Auto-Fetch',
    subtitle: 'Automatically fetch biographies and profile photos when new authors appear in your library.',
  },
}

export function normalizeMetadataTab(value: unknown): MetadataTab {
  if (typeof value === 'string' && METADATA_TABS.includes(value as MetadataTab)) {
    return value as MetadataTab
  }
  return 'providers'
}
