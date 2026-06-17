import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { resetSource } from '@/features/migration/lib/migration-api'
import { MIGRATION_SETUP_RESET_CONFIRM_MESSAGE, useMigrationSetupReset } from './useMigrationSetupReset'

vi.mock('@/features/migration/lib/migration-api', () => ({
  resetSource: vi.fn<(sourceId: number) => Promise<void>>(),
}))

const resetSourceMock = vi.mocked(resetSource)

function buildReset(options: { sourceId?: number | null; canResetSetup?: boolean; confirmed?: boolean } = {}) {
  const resetLocalState = vi.fn<() => void>()
  const refreshWorkflowState = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const notifySuccess = vi.fn<(message: string) => void>()
  const notifyError = vi.fn<(message: string) => void>()
  const getErrorMessage = vi.fn<(error: unknown, fallback: string) => string>((error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  )
  const confirmReset = vi.fn<(message: string) => boolean>(() => options.confirmed ?? true)

  const result = useMigrationSetupReset({
    sourceId: ref('sourceId' in options ? (options.sourceId ?? null) : 5),
    canResetSetup: ref(options.canResetSetup ?? true),
    resetLocalState,
    refreshWorkflowState,
    notifySuccess,
    notifyError,
    getErrorMessage,
    confirmReset,
  })

  return {
    ...result,
    confirmReset,
    getErrorMessage,
    notifyError,
    notifySuccess,
    refreshWorkflowState,
    resetLocalState,
  }
}

describe('useMigrationSetupReset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSourceMock.mockResolvedValue(undefined)
  })

  it('confirms, deletes the source, clears local state, refreshes workflow state, and notifies success', async () => {
    const reset = buildReset()

    await reset.resetSetup()

    expect(reset.confirmReset).toHaveBeenCalledWith(MIGRATION_SETUP_RESET_CONFIRM_MESSAGE)
    expect(resetSourceMock).toHaveBeenCalledWith(5)
    expect(reset.resetLocalState).toHaveBeenCalled()
    expect(reset.refreshWorkflowState).toHaveBeenCalled()
    expect(reset.notifySuccess).toHaveBeenCalledWith('Import setup reset')
    expect(reset.resettingSource.value).toBe(false)
  })

  it('does nothing without a source id', async () => {
    const reset = buildReset({ sourceId: null })

    await reset.resetSetup()

    expect(reset.confirmReset).not.toHaveBeenCalled()
    expect(resetSourceMock).not.toHaveBeenCalled()
  })

  it('does nothing when setup cannot be reset', async () => {
    const reset = buildReset({ canResetSetup: false })

    await reset.resetSetup()

    expect(reset.confirmReset).not.toHaveBeenCalled()
    expect(resetSourceMock).not.toHaveBeenCalled()
  })

  it('does nothing when the user cancels confirmation', async () => {
    const reset = buildReset({ confirmed: false })

    await reset.resetSetup()

    expect(reset.confirmReset).toHaveBeenCalled()
    expect(resetSourceMock).not.toHaveBeenCalled()
    expect(reset.resetLocalState).not.toHaveBeenCalled()
  })

  it('reports backend reset failures and leaves local state untouched', async () => {
    resetSourceMock.mockRejectedValue(new Error('Cannot reset migration setup after a migration run has been created'))
    const reset = buildReset()

    await reset.resetSetup()

    expect(reset.notifyError).toHaveBeenCalledWith('Cannot reset migration setup after a migration run has been created')
    expect(reset.resetLocalState).not.toHaveBeenCalled()
    expect(reset.refreshWorkflowState).not.toHaveBeenCalled()
    expect(reset.resettingSource.value).toBe(false)
  })
})
