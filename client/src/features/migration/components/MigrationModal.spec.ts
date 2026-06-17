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
  migrationApiMocks.listSupportedSourceTypes.mockResolvedValue(['booklore', 'grimmory'])
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
})
