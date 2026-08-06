import { computed, effectScope, nextTick, ref, type EffectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFailureFingerprint, useMetadataCardDismissal, type MetadataCardFailureState, type MetadataCardScope } from './useMetadataCardDismissal'

type CardState = MetadataCardFailureState & { queued: number; processing: number }

function makeStatus(overrides: Partial<CardState> = {}): CardState {
  return {
    queued: 0,
    processing: 0,
    failed: 0,
    latestFailureAt: null,
    ...overrides,
  }
}

describe('useMetadataCardDismissal', () => {
  const scopes: EffectScope[] = []

  function mount(status = ref(makeStatus()), userId = ref<number | null>(1), scope: MetadataCardScope = 'authors') {
    const effects = effectScope()
    const result = effects.run(() => {
      const hasWork = computed(() => status.value.queued + status.value.processing > 0)
      return useMetadataCardDismissal(
        scope,
        status,
        hasWork,
        computed(() => userId.value),
      )
    })!
    scopes.push(effects)
    return result
  }

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    scopes.splice(0).forEach((scope) => scope.stop())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('fingerprints terminal failures by count and latest failure time', () => {
    expect(getFailureFingerprint(makeStatus())).toBeNull()
    expect(getFailureFingerprint(makeStatus({ failed: 2 }))).toBeNull()
    expect(getFailureFingerprint(makeStatus({ failed: 2, latestFailureAt: '2026-08-05T10:00:00.000Z' }))).toBe('2:2026-08-05T10:00:00.000Z')
  })

  it.each(['authors', 'books'] as const)('restores a terminal failure dismissal after the %s composable is recreated', (scope) => {
    const status = ref(makeStatus({ failed: 2, latestFailureAt: '2026-08-05T10:00:00.000Z' }))
    const first = mount(status, ref<number | null>(1), scope)

    first.dismiss()

    expect(first.dismissed.value).toBe(true)
    expect(mount(status, ref<number | null>(1), scope).dismissed.value).toBe(true)
  })

  it('does not share dismissal state between the book and author cards', () => {
    const status = ref(makeStatus({ failed: 2, latestFailureAt: '2026-08-05T10:00:00.000Z' }))
    mount(status, ref<number | null>(1), 'books').dismiss()

    expect(mount(status, ref<number | null>(1), 'authors').dismissed.value).toBe(false)
  })

  it('restores a dismissal when the retained socket snapshot arrives after a refresh', async () => {
    const retained = makeStatus({ failed: 2, latestFailureAt: '2026-08-05T10:00:00.000Z' })
    const status = ref(retained)
    mount(status).dismiss()

    status.value = makeStatus()
    const refreshed = mount(status)
    expect(refreshed.dismissed.value).toBe(false)

    status.value = retained
    await nextTick()

    expect(refreshed.dismissed.value).toBe(true)
  })

  it('shows a new failure even when its count matches the dismissed failure set', async () => {
    const status = ref(makeStatus({ failed: 2, latestFailureAt: '2026-08-05T10:00:00.000Z' }))
    const dismissal = mount(status)
    dismissal.dismiss()

    status.value = makeStatus({ failed: 2, latestFailureAt: '2026-08-05T11:00:00.000Z' })
    await nextTick()

    expect(dismissal.dismissed.value).toBe(false)
  })

  it('does not share dismissal state between users', async () => {
    const status = ref(makeStatus({ failed: 1, latestFailureAt: '2026-08-05T10:00:00.000Z' }))
    const userId = ref<number | null>(1)
    const dismissal = mount(status, userId)
    dismissal.dismiss()

    userId.value = 2
    await nextTick()

    expect(dismissal.dismissed.value).toBe(false)
  })

  it('keeps an active-run dismissal hidden through completion and persists its final failures', async () => {
    const status = ref(makeStatus({ queued: 2 }))
    const dismissal = mount(status)
    dismissal.dismiss()

    status.value = makeStatus({ processing: 1 })
    await nextTick()
    expect(dismissal.dismissed.value).toBe(true)

    status.value = makeStatus({ failed: 1, latestFailureAt: '2026-08-05T10:00:00.000Z' })
    await nextTick()

    expect(dismissal.dismissed.value).toBe(true)
    expect(mount(status).dismissed.value).toBe(true)
  })

  it('shows later active work after a terminal status was dismissed', async () => {
    const status = ref(makeStatus({ failed: 1, latestFailureAt: '2026-08-05T10:00:00.000Z' }))
    const dismissal = mount(status)
    dismissal.dismiss()

    status.value = makeStatus({ queued: 1 })
    await nextTick()

    expect(dismissal.dismissed.value).toBe(false)
  })

  it('keeps current-page dismissal working when local storage is unavailable', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('unavailable')
      },
    })
    const status = ref(makeStatus({ failed: 1, latestFailureAt: '2026-08-05T10:00:00.000Z' }))
    const dismissal = mount(status)

    expect(() => dismissal.dismiss()).not.toThrow()
    expect(dismissal.dismissed.value).toBe(true)
  })
})
