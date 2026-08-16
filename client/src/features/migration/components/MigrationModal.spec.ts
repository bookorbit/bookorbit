import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import MigrationModal from './MigrationModal.vue'

const migrationApiMocks = vi.hoisted(() => ({
  cancelRun: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  createDryRunPlan: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  createProfile: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  createSource: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  exportRunReport: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getRunProgress: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getRunReport: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getWorkflowState: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listSourcePathPrefixes: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listSupportedSourceTypes: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listTargetLibraryFolders: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listTargetUsers: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  resetSource: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  resolveDuplicateMatches: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  retryRun: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  startLiveRun: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  suggestUserMappings: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  testSource: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  validatePathMappings: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  validateSourceById: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}))

const toastMocks = vi.hoisted(() => ({
  error: vi.fn<(message: string) => void>(),
  success: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
}))

vi.mock('@/features/migration/lib/migration-api', () => migrationApiMocks)

vi.mock('vue-sonner', () => ({
  toast: toastMocks,
}))

vi.mock('@/features/migration/composables/useMigrationProgress', () => ({
  useMigrationProgress: () => ({
    subscribeRun: vi.fn<(runId: number) => void>(),
    unsubscribeRun: vi.fn<(runId: number) => void>(),
    getProgress: vi.fn<(runId: number) => unknown>(),
    progressMap: ref(new Map()),
  }),
}))

vi.mock('@/features/migration/composables/useMigrationPolling', () => ({
  useMigrationPolling: () => ({
    pollingError: ref(null),
    retry: vi.fn<() => void>(),
  }),
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<(...args: unknown[]) => Promise<Response>>(),
}))

function sourceState(overrides: Record<string, unknown> = {}) {
  return {
    active: {
      source: {
        id: 5,
        type: 'booklore',
        name: 'Saved Import',
        connectionConfig: {
          host: 'db.local',
          port: 3306,
          user: 'booklore',
          password: '********',
          database: 'booklore',
          ssl: false,
          mediaRootPath: '',
        },
        capabilities: {
          ok: true,
          sourceType: 'booklore',
          sourceVersion: '2.2.2',
          warnings: [],
          counts: {},
          missingTables: [],
        },
        lastValidatedAt: '2026-06-17T00:00:00.000Z',
        createdAt: '2026-06-17T00:00:00.000Z',
        updatedAt: '2026-06-17T00:00:00.000Z',
      },
      profile: null,
      plan: null,
      run: null,
      ...overrides,
    },
    hasActiveRun: false,
  }
}

function setupDefaults() {
  migrationApiMocks.listSupportedSourceTypes.mockResolvedValue(['booklore', 'grimmory', 'audiobookshelf', 'calibre_web_automated'])
  migrationApiMocks.listTargetUsers.mockResolvedValue([{ id: 1, username: 'neon', name: 'Neon', email: null }])
  migrationApiMocks.listTargetLibraryFolders.mockResolvedValue([])
  migrationApiMocks.suggestUserMappings.mockResolvedValue({ sourceId: 5, generatedAt: '2026-06-17T00:00:00.000Z', suggestions: [] })
  migrationApiMocks.listSourcePathPrefixes.mockResolvedValue({ prefixes: [] })
  migrationApiMocks.resetSource.mockResolvedValue(undefined)
}

function mountModal() {
  return mount(MigrationModal, {
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })
}

function findButton(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().replace(/\s+/g, ' ').includes(label))
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}

describe('MigrationModal reset setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaults()
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )
  })

  it('resets saved source setup and clears the form', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValueOnce(sourceState()).mockResolvedValueOnce({ active: null, hasActiveRun: false })

    const wrapper = mountModal()
    await flushPromises()

    expect(findButton(wrapper, 'Reset Setup').exists()).toBe(true)

    await findButton(wrapper, 'Reset Setup').trigger('click')
    await flushPromises()

    expect(window.confirm).toHaveBeenCalledWith('Reset import setup? Saved source connection, mappings, and dry-run data will be cleared.')
    expect(migrationApiMocks.resetSource).toHaveBeenCalledWith(5)
    expect(migrationApiMocks.getWorkflowState).toHaveBeenCalledTimes(2)
    expect(wrapper.find('input[placeholder="127.0.0.1"]').element).toHaveProperty('value', '')
    expect(toastMocks.success).toHaveBeenCalledWith('Import setup reset')
  })

  it('hides reset setup once a migration run exists', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValueOnce(
      sourceState({
        run: {
          id: 9,
          sourceId: 5,
          profileId: 8,
          planArtifactId: 7,
          state: 'failed',
          currentStage: 'cancelled',
          targetKey: 'bookorbit',
          startedAt: '2026-06-17T00:00:00.000Z',
          endedAt: '2026-06-17T00:01:00.000Z',
          errorMessage: 'Migration cancelled by user',
          createdAt: '2026-06-17T00:00:00.000Z',
          updatedAt: '2026-06-17T00:01:00.000Z',
        },
      }),
    )

    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.text()).not.toContain('Reset Setup')
  })

  it('renders ASIN match and unresolved labels in a dry-run plan', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValueOnce(
      sourceState({
        profile: {
          id: 6,
          sourceId: 5,
          name: 'Mappings',
          userMappings: [],
          pathMappings: [],
          scope: {},
          createdAt: '2026-06-18T00:00:00.000Z',
          updatedAt: '2026-06-18T00:00:00.000Z',
        },
        plan: {
          id: 7,
          sourceId: 5,
          profileId: 6,
          plan: {
            duplicateBookMatches: [
              {
                targetBookId: 10,
                sourceBookIds: ['asin-source', 'hash-source'],
                strategies: ['asin', 'file_hash'],
                sourceCandidates: [
                  {
                    sourceBookId: 'asin-source',
                    title: 'ASIN Candidate',
                    author: 'Author One',
                    filePath: null,
                    strategy: 'asin',
                  },
                  {
                    sourceBookId: 'hash-source',
                    title: 'Hash Candidate',
                    author: 'Author Two',
                    filePath: null,
                    strategy: 'file_hash',
                  },
                ],
                reason: 'duplicate_target_match',
              },
            ],
          },
          summary: {
            matchedBooks: 0,
            unresolvedBooks: 1,
            duplicateBookMatches: 1,
            unresolvedByReason: { no_asin_match: 1, ambiguous_asin_match: 1 },
            status: 'blocked',
          },
          createdAt: '2026-06-17T00:00:00.000Z',
          updatedAt: '2026-06-17T00:00:00.000Z',
        },
      }),
    )

    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.text()).toContain('ASIN did not match any book in this library')
    expect(wrapper.text()).toContain('Multiple books matched the same ASIN')
    expect(wrapper.text()).toContain('Matched by ASIN')
    expect(wrapper.text()).toContain('Matched by file hash')
  })

  it('saves an explicitly skipped source user as a null target mapping', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValue(sourceState())
    migrationApiMocks.suggestUserMappings.mockResolvedValue({
      sourceId: 5,
      generatedAt: '2026-06-17T00:00:00.000Z',
      suggestions: [
        {
          sourceUserId: 'maya',
          username: 'maya',
          name: null,
          email: null,
          suggestedTargetUserId: 1,
          confidence: 'high',
          candidates: [],
        },
        {
          sourceUserId: 'lina',
          username: 'lina',
          name: null,
          email: null,
          suggestedTargetUserId: null,
          confidence: null,
          candidates: [],
        },
      ],
    })
    migrationApiMocks.createProfile.mockResolvedValue({})

    const wrapper = mountModal()
    await flushPromises()

    const skipCheckboxes = wrapper.findAll('input[type="checkbox"]')
    expect(skipCheckboxes).toHaveLength(2)
    await skipCheckboxes[1]!.setValue(true)
    await findButton(wrapper, 'Save Mappings').trigger('click')
    await flushPromises()

    expect(migrationApiMocks.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        userMappings: [
          { sourceUserId: 'maya', targetUserId: 1 },
          { sourceUserId: 'lina', targetUserId: null },
        ],
      }),
    )
  })

  it('hydrates a saved Audiobookshelf API source with its redacted token', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValueOnce(
      sourceState({
        source: {
          id: 5,
          type: 'audiobookshelf',
          name: 'Living room server',
          connectionConfig: {
            mode: 'api',
            baseUrl: 'http://abs.local:13378',
            apiToken: '********',
            allowPrivateNetwork: true,
          },
          capabilities: null,
          lastValidatedAt: null,
          createdAt: '2026-06-17T00:00:00.000Z',
          updatedAt: '2026-06-17T00:00:00.000Z',
        },
      }),
    )

    const wrapper = mountModal()
    await flushPromises()
    await findButton(wrapper, 'Source Connection').trigger('click')

    expect(wrapper.get('input[type="url"]').element).toHaveProperty('value', 'http://abs.local:13378')
    expect(wrapper.get('input[data-lpignore="true"]').element).toHaveProperty('value', '********')
    expect(wrapper.get('input[type="checkbox"]').element).toHaveProperty('checked', true)
    expect(wrapper.find('input[placeholder="127.0.0.1"]').exists()).toBe(false)
  })

  it('tests an Audiobookshelf backup using only backup-mode fields', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValueOnce({ active: null, hasActiveRun: false })
    migrationApiMocks.testSource.mockResolvedValueOnce({ ok: true, warnings: [] })

    const wrapper = mountModal()
    await flushPromises()

    await wrapper.get('select').setValue('audiobookshelf')
    await wrapper.get('input[type="radio"][value="backup"]').setValue()
    await wrapper.get('input[placeholder="/imports/audiobookshelf/backup.audiobookshelf"]').setValue('/imports/abs.audiobookshelf')
    await findButton(wrapper, 'Test Connection').trigger('click')
    await flushPromises()

    expect(migrationApiMocks.testSource).toHaveBeenCalledWith({
      type: 'audiobookshelf',
      connectionConfig: {
        mode: 'backup',
        backupPath: '/imports/abs.audiobookshelf',
      },
    })
  })

  it('rejects an Audiobookshelf API URL with a path before making a request', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValueOnce({ active: null, hasActiveRun: false })

    const wrapper = mountModal()
    await flushPromises()

    await wrapper.get('select').setValue('audiobookshelf')
    await wrapper.get('input[type="url"]').setValue('https://abs.example.test/api')
    await wrapper.get('input[data-lpignore="true"]').setValue('admin-token')
    await findButton(wrapper, 'Test Connection').trigger('click')

    expect(migrationApiMocks.testSource).not.toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenCalledWith('Audiobookshelf URL must be a clean HTTP or HTTPS origin without a path')
  })

  it('tests a CWA snapshot using exactly its fixed mode and two paths', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValueOnce({ active: null, hasActiveRun: false })
    migrationApiMocks.testSource.mockResolvedValueOnce({ ok: true, warnings: [] })

    const wrapper = mountModal()
    await flushPromises()

    await wrapper.get('select').setValue('calibre_web_automated')
    await wrapper.get('input[placeholder="/imports/calibre-web-automated/app.db"]').setValue(' /imports/cwa/app.db ')
    await wrapper.get('input[placeholder="/imports/calibre-web-automated/metadata.db"]').setValue(' /imports/cwa/metadata.db ')
    await findButton(wrapper, 'Test Connection').trigger('click')
    await flushPromises()

    expect(migrationApiMocks.testSource).toHaveBeenCalledWith({
      type: 'calibre_web_automated',
      connectionConfig: {
        mode: 'snapshot',
        appDatabasePath: '/imports/cwa/app.db',
        metadataDatabasePath: '/imports/cwa/metadata.db',
      },
    })
  })

  it('validates both CWA snapshot paths before making a request', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValueOnce({ active: null, hasActiveRun: false })

    const wrapper = mountModal()
    await flushPromises()

    await wrapper.get('select').setValue('calibre_web_automated')
    await findButton(wrapper, 'Test Connection').trigger('click')
    expect(toastMocks.error).toHaveBeenLastCalledWith('The Calibre-Web Automated app.db snapshot path is required')

    await wrapper.get('input[placeholder="/imports/calibre-web-automated/app.db"]').setValue('relative/app.db')
    await findButton(wrapper, 'Test Connection').trigger('click')
    expect(toastMocks.error).toHaveBeenLastCalledWith('The Calibre-Web Automated app.db snapshot path must be absolute')

    await wrapper.get('input[placeholder="/imports/calibre-web-automated/app.db"]').setValue('/imports/cwa/app.db')
    await wrapper.get('input[placeholder="/imports/calibre-web-automated/metadata.db"]').setValue('relative/metadata.db')
    await findButton(wrapper, 'Test Connection').trigger('click')

    expect(migrationApiMocks.testSource).not.toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenLastCalledWith('The Calibre metadata.db snapshot path must be absolute')
  })

  it('hydrates a saved CWA source with both snapshot paths', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValueOnce(
      sourceState({
        source: {
          id: 5,
          type: 'calibre_web_automated',
          name: 'Stopped CWA',
          connectionConfig: {
            mode: 'snapshot',
            appDatabasePath: '/imports/cwa/app.db',
            metadataDatabasePath: '/imports/cwa/metadata.db',
          },
          capabilities: null,
          lastValidatedAt: null,
          createdAt: '2026-08-14T00:00:00.000Z',
          updatedAt: '2026-08-14T00:00:00.000Z',
        },
      }),
    )

    const wrapper = mountModal()
    await flushPromises()
    await findButton(wrapper, 'Source Connection').trigger('click')

    expect(wrapper.get('input[placeholder="/imports/calibre-web-automated/app.db"]').element).toHaveProperty('value', '/imports/cwa/app.db')
    expect(wrapper.get('input[placeholder="/imports/calibre-web-automated/metadata.db"]').element).toHaveProperty('value', '/imports/cwa/metadata.db')
    expect(wrapper.find('input[placeholder="127.0.0.1"]').exists()).toBe(false)
  })
})
