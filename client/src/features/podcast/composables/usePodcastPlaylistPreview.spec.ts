// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { api } from '@/lib/api'
import { normalizePlaylistRules } from '../lib/podcast-playlist-rules'
import { usePodcastPlaylistPreview } from './usePodcastPlaylistPreview'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key, te: () => false } } }))

const apiMock = vi.mocked(api)

function page(total: number, totalDurationSeconds = 0) {
  return new Response(JSON.stringify({ items: [], total, totalDurationSeconds, page: 0, size: 1 }), { status: 200 })
}

let scope: EffectScope

function preview(rules = normalizePlaylistRules({ filter: 'unplayed' }), open = true) {
  const active = ref(open)
  const ruleRef = ref(rules)
  const libraryId = ref(7)
  scope = effectScope()
  const result = scope.run(() => usePodcastPlaylistPreview({ libraryId, rules: ruleRef, active }))!
  return { ...result, active, rules: ruleRef, libraryId }
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue(page(0))
  vi.useFakeTimers()
})

afterEach(() => {
  scope?.stop()
  vi.useRealTimers()
})

describe('usePodcastPlaylistPreview', () => {
  it('counts the matching episodes and their total runtime once the edits settle', async () => {
    apiMock.mockResolvedValue(page(142, 220_800))
    const { count, durationSeconds, loading } = preview()

    expect(loading.value).toBe(true)
    expect(apiMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(400)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-libraries/7/episodes?page=0&size=1&filter=unplayed&sort=newest&followedOnly=false',
      undefined,
    )
    expect(count.value).toBe(142)
    expect(durationSeconds.value).toBe(220_800)
    expect(loading.value).toBe(false)
  })

  it('spends one count on a burst of edits rather than one per edit', async () => {
    const { rules, count } = preview()

    await vi.advanceTimersByTimeAsync(200)
    rules.value = { ...rules.value, publishedWithinDays: 7 }
    await vi.advanceTimersByTimeAsync(200)
    rules.value = { ...rules.value, publishedWithinDays: 14 }
    await vi.advanceTimersByTimeAsync(400)

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('publishedWithinDays=14'), undefined)
    expect(count.value).toBe(0)
  })

  it('leaves the count alone when only the playback order changes', async () => {
    const { rules } = preview()
    await vi.advanceTimersByTimeAsync(400)
    expect(apiMock).toHaveBeenCalledTimes(1)

    rules.value = { ...rules.value, sort: 'longest' }
    await vi.advanceTimersByTimeAsync(400)

    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the answer to the newest rules when an older count resolves late', async () => {
    const settle: Array<() => void> = []
    apiMock.mockImplementation(
      (url) =>
        new Promise<Response>((resolve) => {
          settle.push(() => resolve(page(String(url).includes('followedOnly=true') ? 4 : 900)))
        }),
    )
    const { rules, count } = preview()

    await vi.advanceTimersByTimeAsync(400)
    rules.value = { ...rules.value, followedOnly: true }
    await vi.advanceTimersByTimeAsync(400)

    // Newest first, then the superseded request, which must not overwrite it.
    settle[1]!()
    settle[0]!()
    await vi.advanceTimersByTimeAsync(0)

    expect(count.value).toBe(4)
  })

  it('reports a failed count instead of showing the previous rules answer as current', async () => {
    const { count, failed, loading, rules } = preview()
    await vi.advanceTimersByTimeAsync(400)
    expect(count.value).toBe(0)

    apiMock.mockResolvedValue(new Response(null, { status: 500 }))
    rules.value = { ...rules.value, followedOnly: true }
    await vi.advanceTimersByTimeAsync(400)

    expect(count.value).toBeNull()
    expect(failed.value).toBe(true)
    expect(loading.value).toBe(false)
  })

  it('costs nothing while the editor is closed and drops the stale count on close', async () => {
    const { active, count, loading } = preview(normalizePlaylistRules({}), false)

    expect(loading.value).toBe(false)
    await vi.advanceTimersByTimeAsync(400)
    expect(apiMock).not.toHaveBeenCalled()

    active.value = true
    await vi.advanceTimersByTimeAsync(400)
    expect(apiMock).toHaveBeenCalledTimes(1)

    active.value = false
    await nextTick()

    expect(count.value).toBeNull()
    await vi.advanceTimersByTimeAsync(400)
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('drops a pending count when the editor it belongs to goes away', async () => {
    preview()
    scope.stop()

    await vi.advanceTimersByTimeAsync(400)

    expect(apiMock).not.toHaveBeenCalled()
  })
})
