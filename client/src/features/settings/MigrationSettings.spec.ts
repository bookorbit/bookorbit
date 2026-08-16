import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import MigrationSettings from './MigrationSettings.vue'

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
  resolveDuplicateMatches: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  retryRun: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  startLiveRun: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  suggestUserMappings: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  testSource: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  validatePathMappings: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  validateSourceById: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}))

vi.mock('@/features/migration/lib/migration-api', () => migrationApiMocks)
vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(message: string) => void>(),
    success: vi.fn<(message: string) => void>(),
    warning: vi.fn<(message: string) => void>(),
  },
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
  useMigrationPolling: () => ({ pollingError: ref(null), retry: vi.fn<() => void>() }),
}))
vi.mock('@/lib/api', () => ({ api: vi.fn<(...args: unknown[]) => Promise<Response>>() }))

describe('MigrationSettings source configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    migrationApiMocks.listSupportedSourceTypes.mockResolvedValue(['booklore', 'grimmory', 'audiobookshelf', 'calibre_web_automated'])
    migrationApiMocks.listTargetUsers.mockResolvedValue([])
    migrationApiMocks.listTargetLibraryFolders.mockResolvedValue([])
    migrationApiMocks.getWorkflowState.mockResolvedValue({
      active: {
        source: {
          id: 7,
          type: 'audiobookshelf',
          name: 'Nightly backup',
          connectionConfig: { mode: 'backup', backupPath: '/imports/nightly.audiobookshelf' },
          capabilities: null,
          lastValidatedAt: null,
          createdAt: '2026-08-14T00:00:00.000Z',
          updatedAt: '2026-08-14T00:00:00.000Z',
        },
        profile: null,
        plan: null,
        run: null,
      },
      hasActiveRun: false,
    })
  })

  it('hydrates the backup form in the full-page entry point', async () => {
    const wrapper = mount(MigrationSettings, {
      global: {
        stubs: {
          SettingsPageHeader: true,
          MigrationStepper: true,
        },
      },
    })
    await flushPromises()
    wrapper.getComponent({ name: 'MigrationStepper' }).vm.$emit('step-click', 0)
    await flushPromises()

    expect(wrapper.get('input[placeholder="/imports/audiobookshelf/backup.audiobookshelf"]').element).toHaveProperty(
      'value',
      '/imports/nightly.audiobookshelf',
    )
    expect(wrapper.get('[data-testid="migration-source-fields"]').classes()).toEqual(expect.arrayContaining(['md:grid-cols-2', 'xl:grid-cols-4']))
    expect(wrapper.find('input[type="url"]').exists()).toBe(false)
  })

  it('hydrates CWA snapshot paths in the wide full-page entry point', async () => {
    migrationApiMocks.getWorkflowState.mockResolvedValueOnce({
      active: {
        source: {
          id: 9,
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
        profile: null,
        plan: null,
        run: null,
      },
      hasActiveRun: false,
    })

    const wrapper = mount(MigrationSettings, {
      global: {
        stubs: {
          SettingsPageHeader: true,
          MigrationStepper: true,
        },
      },
    })
    await flushPromises()
    wrapper.getComponent({ name: 'MigrationStepper' }).vm.$emit('step-click', 0)
    await flushPromises()

    expect(wrapper.get('input[placeholder="/imports/calibre-web-automated/app.db"]').element).toHaveProperty('value', '/imports/cwa/app.db')
    expect(wrapper.get('input[placeholder="/imports/calibre-web-automated/metadata.db"]').element).toHaveProperty('value', '/imports/cwa/metadata.db')
    expect(wrapper.get('#cwa-snapshot-guidance').classes()).toEqual(expect.arrayContaining(['md:col-span-2', 'xl:col-span-4']))
    expect(wrapper.find('input[placeholder="127.0.0.1"]').exists()).toBe(false)
  })
})
