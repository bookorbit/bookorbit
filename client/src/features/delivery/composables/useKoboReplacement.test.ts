import { describe, it, expect, vi, afterEach } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { api } from '@/lib/api'
import { useKoboReplacement } from './useKoboReplacement'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof api>() }))
const record = (state: string, id = 'delivery') => ({ id, state, options: { replacement: true }, metadata: { format: 'epub', sizeBytes: 100 } })
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

describe('guided Kobo replacement lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })
  it('recovers an existing pending replacement and polls after offering it', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const device = ref<number | null>(null)
    const book = ref<number | null>(null)
    const state = scope.run(() => useKoboReplacement(device, book))!
    vi.mocked(api).mockResolvedValueOnce(response(record('prepared')))
    device.value = 1
    book.value = 2
    await nextTick()
    await flushPromises()
    expect(state.replacement.value?.state).toBe('prepared')
    vi.mocked(api).mockResolvedValueOnce(response(record('offered')))
    await state.transition('offer')
    vi.mocked(api).mockResolvedValueOnce(response(record('transfer_observed')))
    await vi.advanceTimersByTimeAsync(3000)
    expect(state.replacement.value?.state).toBe('transfer_observed')
    scope.stop()
    const calls = vi.mocked(api).mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    expect(api).toHaveBeenCalledTimes(calls)
  })

  it('says the device already has the copy when preparing answers with the current delivery', async () => {
    const scope = effectScope()
    const device = ref<number | null>(null)
    const book = ref<number | null>(null)
    const state = scope.run(() => useKoboReplacement(device, book))!
    vi.mocked(api).mockResolvedValueOnce(response(null))
    device.value = 1
    book.value = 2
    await nextTick()
    await flushPromises()
    vi.mocked(api).mockResolvedValueOnce(response({ ...record('transfer_observed'), options: { replacement: false } }))
    await state.prepare('audioless_epub')
    expect(state.replacement.value).toBeNull()
    expect(state.alreadyOnDevice.value).toBe(true)
    vi.mocked(api).mockResolvedValueOnce(response(null))
    book.value = 3
    await nextTick()
    expect(state.alreadyOnDevice.value).toBe(false)
    vi.mocked(api).mockResolvedValueOnce(response(record('prepared')))
    await state.prepare('audioless_epub')
    expect(state.alreadyOnDevice.value).toBe(false)
    scope.stop()
  })

  it('discards stale status responses when the selected book changes', async () => {
    const scope = effectScope()
    const device = ref<number | null>(null)
    const book = ref<number | null>(null)
    const state = scope.run(() => useKoboReplacement(device, book))!
    let resolveOld!: (value: Response) => void
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    device.value = 1
    book.value = 2
    await nextTick()
    const signal = vi.mocked(api).mock.calls[0]?.[1]?.signal
    vi.mocked(api).mockResolvedValueOnce(response(record('user_confirmed', 'new')))
    book.value = 3
    await nextTick()
    await flushPromises()
    resolveOld(response(record('prepared', 'old')))
    await flushPromises()
    expect(signal?.aborted).toBe(true)
    expect(state.replacement.value?.id).toBe('new')
    scope.stop()
  })

  it('suspends a scheduled status poll while a replacement action is pending', async () => {
    vi.useFakeTimers()
    const scope = effectScope()
    const device = ref<number | null>(null)
    const book = ref<number | null>(null)
    const state = scope.run(() => useKoboReplacement(device, book))!
    vi.mocked(api).mockResolvedValueOnce(response(record('offered')))
    device.value = 1
    book.value = 2
    await nextTick()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2999)

    let resolveCancel!: (value: Response) => void
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve
        }),
    )
    const cancelling = state.transition('cancel')
    const signal = vi.mocked(api).mock.calls[1]?.[1]?.signal
    await vi.advanceTimersByTimeAsync(3000)
    expect(api).toHaveBeenCalledTimes(2)
    expect(signal?.aborted).toBe(false)
    expect(state.busy.value).toBe(true)
    resolveCancel(response(record('cancelled')))
    await cancelling
    expect(state.replacement.value?.state).toBe('cancelled')
    await vi.advanceTimersByTimeAsync(6000)
    expect(api).toHaveBeenCalledTimes(2)
    scope.stop()
  })
})
