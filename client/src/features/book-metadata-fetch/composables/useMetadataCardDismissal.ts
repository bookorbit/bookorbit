import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

const STORAGE_KEY_PREFIX = 'bookorbit:metadata-card-dismissed'

export type MetadataCardScope = 'books' | 'authors'

export type MetadataCardFailureState = {
  failed: number
  latestFailureAt: string | null
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function storageKey(scope: MetadataCardScope, userId: number): string {
  return `${STORAGE_KEY_PREFIX}:${scope}:${userId}`
}

function readDismissedFingerprint(scope: MetadataCardScope, userId: number): string | null {
  try {
    return getStorage()?.getItem(storageKey(scope, userId)) ?? null
  } catch {
    return null
  }
}

function writeDismissedFingerprint(scope: MetadataCardScope, userId: number, fingerprint: string): void {
  try {
    getStorage()?.setItem(storageKey(scope, userId), fingerprint)
  } catch {
    // Local storage can be unavailable in private windows.
  }
}

export function getFailureFingerprint(status: MetadataCardFailureState): string | null {
  if (status.failed <= 0 || !status.latestFailureAt) return null
  return `${status.failed}:${status.latestFailureAt}`
}

export function useMetadataCardDismissal<T extends MetadataCardFailureState>(
  scope: MetadataCardScope,
  status: Ref<T>,
  hasWork: ComputedRef<boolean>,
  userId: ComputedRef<number | null>,
) {
  const dismissed = ref(false)
  const failureFingerprint = computed(() => getFailureFingerprint(status.value))
  let dismissedDuringActiveRun = false

  function persistCurrentFailure(): void {
    const currentUserId = userId.value
    const fingerprint = failureFingerprint.value
    if (currentUserId === null || fingerprint === null) return
    writeDismissedFingerprint(scope, currentUserId, fingerprint)
  }

  watch(
    [hasWork, failureFingerprint, userId],
    ([active, fingerprint, currentUserId], previous) => {
      const wasActive = previous?.[0] ?? false

      if (active) {
        if (!wasActive) {
          dismissed.value = false
          dismissedDuringActiveRun = false
        }
        return
      }

      if (wasActive && dismissedDuringActiveRun) {
        dismissedDuringActiveRun = false
        persistCurrentFailure()
        dismissed.value = true
        return
      }

      dismissed.value = currentUserId !== null && fingerprint !== null && readDismissedFingerprint(scope, currentUserId) === fingerprint
    },
    { immediate: true },
  )

  function dismiss(): void {
    dismissed.value = true
    if (hasWork.value) {
      dismissedDuringActiveRun = true
      return
    }
    persistCurrentFailure()
  }

  return { dismissed, dismiss }
}
