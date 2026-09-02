// @vitest-environment node
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookRequestItem, ReleaseCandidateItem, ReleaseFileInspection } from '@bookorbit/types'

const { toastMock } = vi.hoisted(() => ({
  toastMock: { error: vi.fn<(title: string, options?: unknown) => void>(), success: vi.fn<(title: string) => void>() },
}))
vi.mock('vue-sonner', () => ({ toast: toastMock }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn<() => void>() }) }))

import { useReleaseGrab, type ReleaseGrabOutcome } from '../composables/useReleaseGrab'

const request = { id: 7, status: 'approved' } as BookRequestItem

function release(overrides: Partial<ReleaseCandidateItem> = {}): ReleaseCandidateItem {
  return { indexerId: 9, guid: 'g1', vipOnly: false, ...overrides } as ReleaseCandidateItem
}

const inspection = { status: 'ready' } as ReleaseFileInspection

function deferred<T>() {
  let release: (value: T) => void = () => {}
  const pending = new Promise<T>((resolve) => (release = resolve))
  return { pending, release: (value: T) => release(value) }
}

function makeGrab(
  overrides: {
    grab?: ReturnType<typeof vi.fn>
    inspectRelease?: ReturnType<typeof vi.fn>
  } = {},
) {
  const grab = overrides.grab ?? vi.fn<() => Promise<ReleaseGrabOutcome>>().mockResolvedValue({ item: request, reason: null, errorCode: null })
  const inspectRelease = overrides.inspectRelease ?? vi.fn<() => Promise<ReleaseFileInspection | null>>().mockResolvedValue(inspection)
  const setRequest = vi.fn<(value: BookRequestItem) => void>()
  const setFilesExpanded = vi.fn<(release: ReleaseCandidateItem, expanded: boolean) => void>()

  return {
    ...useReleaseGrab({
      request: ref(request),
      requestId: ref(7),
      grab: grab as never,
      setRequest,
      inspectRelease: inspectRelease as never,
      setFilesExpanded,
      seedsBack: () => true,
    }),
    grab,
    inspectRelease,
    setRequest,
    setFilesExpanded,
  }
}

describe('useReleaseGrab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inspects a release and sends it', async () => {
    const picker = makeGrab()

    await picker.handleGrab(release())

    expect(picker.grab).toHaveBeenCalledWith(7, { indexerId: 9, releaseGuid: 'g1' })
    expect(picker.setRequest).toHaveBeenCalledWith(request)
  })

  /**
   * Inspecting a release is a tracker round trip of up to twenty-five seconds, and only the
   * inspecting row was disabled for it. A second Send inside that window ran its own inspection
   * and went on to its own grab, so two releases were sent for one request.
   */
  it('refuses a second release while the first is still being inspected', async () => {
    const slow = deferred<ReleaseFileInspection>()
    const picker = makeGrab({
      inspectRelease: vi.fn<() => Promise<ReleaseFileInspection | null>>().mockReturnValueOnce(slow.pending).mockResolvedValue(inspection),
    })

    const first = picker.handleGrab(release())
    await picker.handleGrab(release({ guid: 'g2' }))

    expect(picker.inspectRelease).toHaveBeenCalledTimes(1)
    slow.release(inspection)
    await first
    expect(picker.grab).toHaveBeenCalledTimes(1)
    expect(picker.grab).toHaveBeenCalledWith(7, { indexerId: 9, releaseGuid: 'g1' })
  })

  it('refuses a second release while the first is on its way to the client', async () => {
    const slow = deferred<ReleaseGrabOutcome>()
    const grab = vi.fn<() => Promise<ReleaseGrabOutcome>>().mockReturnValueOnce(slow.pending)
    const picker = makeGrab({ grab })

    const first = picker.handleGrab(release())
    await Promise.resolve()
    await picker.handleGrab(release({ guid: 'g2' }))

    expect(grab).toHaveBeenCalledTimes(1)
    slow.release({ item: request, reason: null, errorCode: null })
    await first
  })

  /** The manual magnet dialog reaches the same guard, so it cannot race a picked release either. */
  it('refuses a hand-pasted magnet while a picked release is in flight', async () => {
    const slow = deferred<ReleaseGrabOutcome>()
    const grab = vi.fn<() => Promise<ReleaseGrabOutcome>>().mockReturnValueOnce(slow.pending)
    const picker = makeGrab({ grab })

    const first = picker.handleGrab(release())
    await Promise.resolve()
    await picker.submitGrab({ magnet: 'magnet:?xt=urn:btih:abc' })

    expect(grab).toHaveBeenCalledTimes(1)
    slow.release({ item: request, reason: null, errorCode: null })
    await first
  })

  it('lets the next release be sent once the first has settled', async () => {
    const picker = makeGrab({
      grab: vi.fn<() => Promise<ReleaseGrabOutcome>>().mockResolvedValue({ item: null, reason: 'the tracker answered 406', errorCode: null }),
    })

    await picker.handleGrab(release())
    await picker.handleGrab(release({ guid: 'g2' }))

    expect(picker.grab).toHaveBeenCalledTimes(2)
    expect(picker.grabbing.value).toBe(false)
  })

  /** A blocked inspection opens the row's file list instead, and frees the picker for another try. */
  it('releases the flag when the inspection blocks the grab', async () => {
    const picker = makeGrab({ inspectRelease: vi.fn<() => Promise<ReleaseFileInspection | null>>().mockResolvedValue(null) })

    await picker.handleGrab(release())

    expect(picker.grab).not.toHaveBeenCalled()
    expect(picker.setFilesExpanded).toHaveBeenCalledWith(expect.objectContaining({ guid: 'g1' }), true)
    expect(picker.grabbing.value).toBe(false)
  })

  /** The refusal comes back with the call, so it can never describe some other release's grab. */
  it('remembers a source-wide refusal from the outcome it arrived on', async () => {
    const picker = makeGrab({
      grab: vi
        .fn<() => Promise<ReleaseGrabOutcome>>()
        .mockResolvedValue({ item: null, reason: 'the tracker answered 406', errorCode: 'GRAB_SOURCE_REFUSED' }),
    })

    await picker.handleGrab(release())

    expect(picker.isRefused(release({ guid: 'g2' }))).toBe(true)
    expect(toastMock.error).toHaveBeenCalledWith('bookRequests.errors.grabFailed', { description: 'the tracker answered 406' })
  })
})
