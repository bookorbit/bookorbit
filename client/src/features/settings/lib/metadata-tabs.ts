export const METADATA_TABS = ['providers', 'score', 'auto-fetch', 'authors', 'file-sync'] as const

export type MetadataTab = (typeof METADATA_TABS)[number]

type MetadataTabInfo = {
  navLabel: string
  titleLabel: string
  subtitle: string
}

export const METADATA_TAB_INFO: Record<MetadataTab, MetadataTabInfo> = {
  providers: {
    navLabel: 'Providers',
    titleLabel: 'Source & Priority',
    subtitle: 'Define how book information is collected from external services and prioritized across your libraries.',
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
  'file-sync': {
    navLabel: 'File Sync',
    titleLabel: 'File Write-Back',
    subtitle: 'Configure which metadata fields are saved directly into your book files on disk.',
  },
}

export function normalizeMetadataTab(value: unknown): MetadataTab {
  if (typeof value === 'string' && METADATA_TABS.includes(value as MetadataTab)) {
    return value as MetadataTab
  }
  return 'providers'
}
