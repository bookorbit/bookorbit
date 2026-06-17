import { ref, type Ref } from 'vue'
import { resetSource } from '@/features/migration/lib/migration-api'

export const MIGRATION_SETUP_RESET_CONFIRM_MESSAGE = 'Reset import setup? Saved source connection, mappings, and dry-run data will be cleared.'

interface UseMigrationSetupResetOptions {
  sourceId: Ref<number | null>
  canResetSetup: Ref<boolean>
  resetLocalState: () => void
  refreshWorkflowState: () => Promise<void>
  notifySuccess: (message: string) => void
  notifyError: (message: string) => void
  getErrorMessage: (error: unknown, fallback: string) => string
  confirmReset?: (message: string) => boolean
}

export function useMigrationSetupReset(options: UseMigrationSetupResetOptions) {
  const resettingSource = ref(false)

  async function resetSetup() {
    const id = options.sourceId.value
    if (!id || !options.canResetSetup.value) return

    const confirmed =
      options.confirmReset?.(MIGRATION_SETUP_RESET_CONFIRM_MESSAGE) ??
      (typeof globalThis.confirm === 'function' ? globalThis.confirm(MIGRATION_SETUP_RESET_CONFIRM_MESSAGE) : false)
    if (!confirmed) return

    resettingSource.value = true
    try {
      await resetSource(id)
      options.resetLocalState()
      await options.refreshWorkflowState()
      options.notifySuccess('Import setup reset')
    } catch (error) {
      options.notifyError(options.getErrorMessage(error, 'Failed to reset migration setup'))
    } finally {
      resettingSource.value = false
    }
  }

  return {
    resettingSource,
    resetSetup,
  }
}
