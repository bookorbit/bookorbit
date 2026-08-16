import { describe, expect, it } from 'vitest'
import {
  buildMigrationSourceConnectionConfig,
  createMigrationSourceDraft,
  hydrateMigrationSourceDraft,
  validateMigrationSourceDraft,
} from './migration-source-config'

describe('migration source configuration', () => {
  it('builds a normalized Audiobookshelf API configuration and preserves a redacted token', () => {
    const draft = createMigrationSourceDraft('audiobookshelf')
    draft.name = 'Saved Audiobookshelf'
    draft.baseUrl = ' https://abs.example.test/ '
    draft.apiToken = '********'
    draft.allowPrivateNetwork = true

    expect(validateMigrationSourceDraft(draft)).toBeNull()
    expect(buildMigrationSourceConnectionConfig(draft)).toEqual({
      mode: 'api',
      baseUrl: 'https://abs.example.test',
      apiToken: '********',
      allowPrivateNetwork: true,
    })
  })

  it('hydrates API and backup configurations without mixing mode-specific fields', () => {
    const draft = createMigrationSourceDraft()

    hydrateMigrationSourceDraft(draft, {
      type: 'audiobookshelf',
      name: 'Live server',
      connectionConfig: {
        mode: 'api',
        baseUrl: 'http://abs.local:13378',
        apiToken: '********',
        allowPrivateNetwork: true,
      },
    })
    expect(draft).toMatchObject({
      audiobookshelfMode: 'api',
      baseUrl: 'http://abs.local:13378',
      apiToken: '********',
      allowPrivateNetwork: true,
      backupPath: '',
    })

    hydrateMigrationSourceDraft(draft, {
      type: 'audiobookshelf',
      name: 'Backup archive',
      connectionConfig: { mode: 'backup', backupPath: '/imports/abs.audiobookshelf' },
    })
    expect(draft).toMatchObject({
      audiobookshelfMode: 'backup',
      baseUrl: '',
      apiToken: '',
      allowPrivateNetwork: false,
      backupPath: '/imports/abs.audiobookshelf',
    })
    expect(buildMigrationSourceConnectionConfig(draft)).toEqual({
      mode: 'backup',
      backupPath: '/imports/abs.audiobookshelf',
    })
  })

  it('validates source-specific required fields and safe URL and path shapes', () => {
    const draft = createMigrationSourceDraft('audiobookshelf')
    expect(validateMigrationSourceDraft(draft)).toBe('apiFieldsRequired')

    draft.baseUrl = 'https://abs.example.test/api'
    draft.apiToken = 'token'
    expect(validateMigrationSourceDraft(draft)).toBe('baseUrlInvalid')

    draft.audiobookshelfMode = 'backup'
    draft.backupPath = 'relative/backup.audiobookshelf'
    expect(validateMigrationSourceDraft(draft)).toBe('backupPathAbsolute')

    draft.backupPath = '/imports/backup.audiobookshelf'
    expect(validateMigrationSourceDraft(draft)).toBeNull()
  })

  it('builds exactly the two CWA snapshot paths and fixed mode', () => {
    const draft = createMigrationSourceDraft('calibre_web_automated')
    draft.cwaAppDatabasePath = ' /imports/cwa/app.db '
    draft.cwaMetadataDatabasePath = ' /imports/cwa/metadata.db '
    draft.host = 'must-not-leak'
    draft.apiToken = 'must-not-leak'

    expect(draft.name).toBe('Calibre-Web Automated')
    expect(validateMigrationSourceDraft(draft)).toBeNull()
    expect(buildMigrationSourceConnectionConfig(draft)).toEqual({
      mode: 'snapshot',
      appDatabasePath: '/imports/cwa/app.db',
      metadataDatabasePath: '/imports/cwa/metadata.db',
    })
  })

  it('hydrates saved CWA paths without treating them as database connection fields', () => {
    const draft = createMigrationSourceDraft('booklore')
    draft.host = 'old-database-host'

    hydrateMigrationSourceDraft(draft, {
      type: 'calibre_web_automated',
      name: 'Stopped CWA',
      connectionConfig: {
        mode: 'snapshot',
        appDatabasePath: '/imports/cwa/app.db',
        metadataDatabasePath: '/imports/cwa/metadata.db',
      },
    })

    expect(draft).toMatchObject({
      type: 'calibre_web_automated',
      name: 'Stopped CWA',
      cwaAppDatabasePath: '/imports/cwa/app.db',
      cwaMetadataDatabasePath: '/imports/cwa/metadata.db',
      host: '',
      database: '',
      backupPath: '',
    })
  })

  it('validates each CWA path and stops returning CWA errors after the type changes', () => {
    const draft = createMigrationSourceDraft('calibre_web_automated')
    expect(validateMigrationSourceDraft(draft)).toBe('cwaAppDatabasePathRequired')

    draft.cwaAppDatabasePath = 'relative/app.db'
    expect(validateMigrationSourceDraft(draft)).toBe('cwaAppDatabasePathAbsolute')

    draft.cwaAppDatabasePath = '/imports/cwa/app.db'
    expect(validateMigrationSourceDraft(draft)).toBe('cwaMetadataDatabasePathRequired')

    draft.cwaMetadataDatabasePath = 'relative/metadata.db'
    expect(validateMigrationSourceDraft(draft)).toBe('cwaMetadataDatabasePathAbsolute')

    draft.type = 'booklore'
    expect(validateMigrationSourceDraft(draft)).toBe('databaseFieldsRequired')
    expect(draft.port).toBe(3306)
  })
})
