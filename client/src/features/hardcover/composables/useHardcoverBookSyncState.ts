import { computed, ref, watch, type Ref } from 'vue'
import type { HardcoverBookSyncEffectiveReason, HardcoverBookSyncState } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { fetchHardcoverBookSyncState, startHardcoverBookSync, updateHardcoverBookSyncState } from '../api/hardcover.api'
import { useHardcoverSettings } from './useHardcoverSettings'

function formatDateTime(iso: string): string {
  return formatDate(new Date(iso), { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function resolveReasonLabel(reason: HardcoverBookSyncEffectiveReason | null | undefined): string | null {
  switch (reason) {
    case 'excluded':
    case 'not_selected':
      return 'Excluded'
    case 'unread':
      return null
    case 'unsupported_status':
      return 'Unsupported'
    case 'missing_token':
    case 'permission_denied':
    case 'user_disabled':
    case 'global_disabled':
      return 'Unavailable'
    default:
      return null
  }
}

export function useHardcoverBookSyncState(bookId: Ref<number>) {
  const { hasPermission } = usePermissions()
  const { settings, fetchSettings } = useHardcoverSettings()

  const state = ref<HardcoverBookSyncState | null>(null)
  const settingsLoaded = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const syncing = ref(false)
  const error = ref<string | null>(null)
  let settingsRequestId = 0
  let stateRequestId = 0
  let syncRequestId = 0

  const canUseHardcoverSync = computed(() => hasPermission('hardcover_sync'))
  const visible = computed(() => canUseHardcoverSync.value && settingsLoaded.value && settings.value?.effectiveEnabled === true)
  const syncEnabled = computed(() => {
    if (state.value?.syncEnabled) return true
    if (state.value?.effectiveReason === 'unread') {
      const bookSyncMode = settings.value?.bookSyncMode ?? 'all_eligible'
      return bookSyncMode === 'all_eligible' ? state.value.syncOverride !== 'excluded' : state.value.syncOverride === 'included'
    }
    return false
  })
  const canSyncNow = computed(() => state.value?.canSyncNow === true)
  const statusText = computed(() => {
    if (error.value) return error.value
    if (syncing.value) return 'Syncing...'
    if (saving.value) return 'Saving...'
    if (loading.value) return 'Loading...'
    if (state.value?.syncError) return `Error: ${state.value.syncError}`
    if (state.value?.effectiveReason === 'unread' && syncEnabled.value) return 'Will sync when reading starts'
    if (!syncEnabled.value) return resolveReasonLabel(state.value?.effectiveReason) ?? 'Excluded'
    if (canSyncNow.value) return 'Pending sync'
    if (state.value?.lastSyncedAt) return `Synced ${formatDateTime(state.value.lastSyncedAt)}`
    return 'Included'
  })
  const statusClass = computed(() => (error.value || state.value?.syncError ? 'text-destructive' : 'text-muted-foreground'))
  const disabled = computed(() => loading.value || saving.value || syncing.value)

  watch(
    canUseHardcoverSync,
    async (allowed) => {
      const requestId = ++settingsRequestId
      settingsLoaded.value = false
      if (!allowed) return

      await fetchSettings()
      if (requestId === settingsRequestId) settingsLoaded.value = true
    },
    { immediate: true },
  )

  watch(
    [bookId, visible],
    async ([currentBookId, isVisible]) => {
      const requestId = ++stateRequestId
      state.value = null
      error.value = null

      if (!isVisible) {
        loading.value = false
        return
      }

      loading.value = true
      try {
        const nextState = await fetchHardcoverBookSyncState(currentBookId)
        if (requestId === stateRequestId) state.value = nextState
      } catch {
        if (requestId === stateRequestId) error.value = 'Unable to load Hardcover sync state.'
      } finally {
        if (requestId === stateRequestId) loading.value = false
      }
    },
    { immediate: true },
  )

  async function setSyncEnabled(syncEnabledValue: boolean): Promise<void> {
    if (!visible.value || saving.value) return

    const targetBookId = bookId.value
    const previous = state.value
    const bookSyncMode = settings.value?.bookSyncMode ?? 'all_eligible'
    const effectiveReason = syncEnabledValue ? null : bookSyncMode === 'selected_only' ? 'not_selected' : 'excluded'
    state.value = {
      bookId: targetBookId,
      syncOverride: syncEnabledValue ? (bookSyncMode === 'selected_only' ? 'included' : null) : bookSyncMode === 'selected_only' ? null : 'excluded',
      syncEnabled: syncEnabledValue,
      canSyncNow: syncEnabledValue,
      effectiveReason,
      lastSyncedAt: previous?.lastSyncedAt ?? null,
      syncError: previous?.syncError ?? null,
    }
    error.value = null
    saving.value = true

    try {
      const nextState = await updateHardcoverBookSyncState(targetBookId, { syncEnabled: syncEnabledValue })
      if (bookId.value === targetBookId) state.value = nextState
    } catch {
      if (bookId.value === targetBookId) {
        state.value = previous
        error.value = 'Failed to save Hardcover sync setting.'
      }
    } finally {
      saving.value = false
    }
  }

  async function syncNow(): Promise<void> {
    if (!visible.value || syncing.value || !canSyncNow.value) return

    const targetBookId = bookId.value
    const requestId = ++syncRequestId
    syncing.value = true
    error.value = null

    try {
      const result = await startHardcoverBookSync(targetBookId)
      if (requestId === syncRequestId && bookId.value === targetBookId) {
        state.value = result.state
      }
    } catch {
      if (requestId === syncRequestId && bookId.value === targetBookId) {
        error.value = 'Failed to sync Hardcover book.'
      }
    } finally {
      if (requestId === syncRequestId) syncing.value = false
    }
  }

  return {
    visible,
    syncEnabled,
    canSyncNow,
    statusText,
    statusClass,
    disabled,
    syncNow,
    setSyncEnabled,
  }
}
