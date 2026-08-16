export type AudiobookshelfConnectionMode = 'api' | 'backup'

export interface MigrationSourceDraft {
  type: string
  name: string
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: boolean
  mediaRootPath: string
  audiobookshelfMode: AudiobookshelfConnectionMode
  baseUrl: string
  apiToken: string
  allowPrivateNetwork: boolean
  backupPath: string
  cwaAppDatabasePath: string
  cwaMetadataDatabasePath: string
}

export type MigrationSourceValidationError =
  | 'nameRequired'
  | 'databaseFieldsRequired'
  | 'apiFieldsRequired'
  | 'baseUrlInvalid'
  | 'backupPathRequired'
  | 'backupPathAbsolute'
  | 'cwaAppDatabasePathRequired'
  | 'cwaAppDatabasePathAbsolute'
  | 'cwaMetadataDatabasePathRequired'
  | 'cwaMetadataDatabasePathAbsolute'

export function createMigrationSourceDraft(type = 'booklore'): MigrationSourceDraft {
  return {
    type,
    name: defaultMigrationSourceName(type),
    host: '',
    port: 3306,
    user: '',
    password: '',
    database: '',
    ssl: false,
    mediaRootPath: '',
    audiobookshelfMode: 'api',
    baseUrl: '',
    apiToken: '',
    allowPrivateNetwork: false,
    backupPath: '',
    cwaAppDatabasePath: '',
    cwaMetadataDatabasePath: '',
  }
}

export function defaultMigrationSourceName(type: string): string {
  if (type === 'audiobookshelf') return 'Audiobookshelf'
  if (type === 'calibre_web_automated') return 'Calibre-Web Automated'
  if (type === 'grimmory') return 'Grimmory'
  return 'Booklore'
}

export function hydrateMigrationSourceDraft(draft: MigrationSourceDraft, source: { type: string; name: string; connectionConfig: unknown }): void {
  const hydrated = createMigrationSourceDraft(source.type)
  hydrated.name = source.name || hydrated.name
  const config = asRecord(source.connectionConfig)

  if (source.type === 'audiobookshelf') {
    hydrated.audiobookshelfMode = config.mode === 'backup' ? 'backup' : 'api'
    hydrated.baseUrl = asString(config.baseUrl) ?? ''
    hydrated.apiToken = asString(config.apiToken) ?? ''
    hydrated.allowPrivateNetwork = config.allowPrivateNetwork === true
    hydrated.backupPath = asString(config.backupPath) ?? ''
  } else if (source.type === 'calibre_web_automated') {
    hydrated.cwaAppDatabasePath = asString(config.appDatabasePath) ?? ''
    hydrated.cwaMetadataDatabasePath = asString(config.metadataDatabasePath) ?? ''
  } else {
    hydrated.host = asString(config.host) ?? ''
    hydrated.port = asNumber(config.port) ?? hydrated.port
    hydrated.user = asString(config.user) ?? ''
    hydrated.password = asString(config.password) ?? ''
    hydrated.database = asString(config.database) ?? ''
    hydrated.ssl = config.ssl === true
    hydrated.mediaRootPath = asString(config.mediaRootPath) ?? ''
  }

  Object.assign(draft, hydrated)
}

export function buildMigrationSourceConnectionConfig(draft: MigrationSourceDraft): Record<string, unknown> {
  if (draft.type === 'calibre_web_automated') {
    return {
      mode: 'snapshot',
      appDatabasePath: draft.cwaAppDatabasePath.trim(),
      metadataDatabasePath: draft.cwaMetadataDatabasePath.trim(),
    }
  }

  if (draft.type === 'audiobookshelf') {
    if (draft.audiobookshelfMode === 'backup') {
      return {
        mode: 'backup',
        backupPath: draft.backupPath.trim(),
      }
    }

    return {
      mode: 'api',
      baseUrl: normalizeBaseUrl(draft.baseUrl),
      apiToken: draft.apiToken,
      allowPrivateNetwork: draft.allowPrivateNetwork,
    }
  }

  return {
    host: draft.host.trim(),
    port: draft.port,
    user: draft.user.trim(),
    password: draft.password,
    database: draft.database.trim(),
    ssl: draft.ssl,
    mediaRootPath: draft.mediaRootPath.trim(),
  }
}

export function validateMigrationSourceDraft(draft: MigrationSourceDraft): MigrationSourceValidationError | null {
  if (!draft.name.trim()) return 'nameRequired'

  if (draft.type === 'calibre_web_automated') {
    const appDatabasePath = draft.cwaAppDatabasePath.trim()
    const metadataDatabasePath = draft.cwaMetadataDatabasePath.trim()
    if (!appDatabasePath) return 'cwaAppDatabasePathRequired'
    if (!appDatabasePath.startsWith('/')) return 'cwaAppDatabasePathAbsolute'
    if (!metadataDatabasePath) return 'cwaMetadataDatabasePathRequired'
    return metadataDatabasePath.startsWith('/') ? null : 'cwaMetadataDatabasePathAbsolute'
  }

  if (draft.type !== 'audiobookshelf') {
    return draft.host.trim() && draft.user.trim() && draft.database.trim() ? null : 'databaseFieldsRequired'
  }

  if (draft.audiobookshelfMode === 'backup') {
    const backupPath = draft.backupPath.trim()
    if (!backupPath) return 'backupPathRequired'
    return backupPath.startsWith('/') ? null : 'backupPathAbsolute'
  }

  if (!draft.baseUrl.trim() || !draft.apiToken.trim()) return 'apiFieldsRequired'
  return isValidBaseUrl(draft.baseUrl) ? null : 'baseUrlInvalid'
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  try {
    return new URL(trimmed).origin
  } catch {
    return trimmed
  }
}

function isValidBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim())
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === ''
    )
  } catch {
    return false
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
