import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

vi.mock('@/lib/api', () => ({ api: vi.fn<(...args: unknown[]) => unknown>() }))

import { api } from '@/lib/api'
import { formatTimeRemaining, useReaderProgress, type NewerPosition } from './useReaderProgress'

const mockApi = vi.mocked(api)

/** A `GET /reading-progress` answer for file 42, built from the flat field names the reader works in. */
function makeOkResponse(data: Record<string, unknown>) {
  const entry = {
    fileId: 42,
    percentage: data.percentage,
    updatedAt: data.updatedAt ?? null,
    text: { cfi: data.cfi, page: data.pageNumber, updatedAt: data.textUpdatedAt },
    narration: {
      seconds: data.positionSeconds,
      fragment: data.mediaOverlayFragment,
      sectionIndex: data.mediaOverlaySectionIndex,
      percentage: data.narrationPercentage,
      updatedAt: data.narrationUpdatedAt,
    },
    kobo: {
      source: data.koboLocationSource,
      type: data.koboLocationType,
      value: data.koboLocationValue,
      contentPercent: data.koboContentSourceProgressPercent,
    },
    koreader: data.koreaderProgress,
  }
  return { ok: true, json: async () => ({ items: [entry] }) } as Response
}

type SentWrite = {
  kind?: string
  percentage?: number
  text?: { cfi?: unknown; page?: unknown }
  narration?: { seconds?: unknown; fragment?: unknown; sectionIndex?: unknown }
  kobo?: { source?: unknown; type?: unknown; value?: unknown; contentPercent?: unknown }
  koreader?: unknown
}

function sentWrite(callIndex = 0): SentWrite {
  const [, opts] = mockApi.mock.calls[callIndex]!
  const { writes } = JSON.parse((opts as RequestInit).body as string) as { writes: SentWrite[] }
  return writes[0]!
}

function makeErrorResponse() {
  return { ok: false } as Response
}

/** The write a save sent, read back under the flat field names the reader works in. */
function postedProgressBody(callIndex = 0): Record<string, unknown> {
  const write = sentWrite(callIndex)
  return {
    cfi: write.text?.cfi,
    pageNumber: write.text?.page,
    percentage: write.percentage,
    koboLocationSource: write.kobo?.source,
    koboLocationType: write.kobo?.type,
    koboLocationValue: write.kobo?.value,
    koboContentSourceProgressPercent: write.kobo?.contentPercent,
    koreaderProgress: write.koreader,
    ...(write.narration
      ? {
          positionSeconds: write.narration.seconds,
          mediaOverlayFragment: write.narration.fragment,
          mediaOverlaySectionIndex: write.narration.sectionIndex,
        }
      : {}),
    source: write.kind,
  }
}

describe('formatTimeRemaining', () => {
  it('returns empty string for negative values', () => {
    expect(formatTimeRemaining(-1)).toBe('')
    expect(formatTimeRemaining(-0.001)).toBe('')
  })

  it('returns empty string for non-finite values', () => {
    expect(formatTimeRemaining(Infinity)).toBe('')
    expect(formatTimeRemaining(-Infinity)).toBe('')
    expect(formatTimeRemaining(NaN)).toBe('')
  })

  it('returns "< 1 min" for 0', () => {
    expect(formatTimeRemaining(0)).toBe('< 1 min')
  })

  it('returns "< 1 min" for 0.5', () => {
    expect(formatTimeRemaining(0.5)).toBe('< 1 min')
  })

  it('returns "1 min" for 1', () => {
    expect(formatTimeRemaining(1)).toBe('1 min')
  })

  it('returns "59 min" for 59', () => {
    expect(formatTimeRemaining(59)).toBe('59 min')
  })

  it('returns "1 hr" for 60', () => {
    expect(formatTimeRemaining(60)).toBe('1 hr')
  })

  it('returns "1 hr 1 min" for 61', () => {
    expect(formatTimeRemaining(61)).toBe('1 hr 1 min')
  })

  it('returns "1 hr 30 min" for 90', () => {
    expect(formatTimeRemaining(90)).toBe('1 hr 30 min')
  })

  it('returns "2 hr" for 120', () => {
    expect(formatTimeRemaining(120)).toBe('2 hr')
  })
})

describe('useReaderProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('load()', () => {
    it('does not call api when trackingEnabled is false', async () => {
      const elapsedMinutes = ref(0)
      const { load } = useReaderProgress(1, 42, elapsedMinutes, 0, {
        trackingEnabled: ref(false),
      })

      await load()

      expect(mockApi).not.toHaveBeenCalled()
    })

    it('calls api with correct url', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { load } = useReaderProgress(1, 42, elapsedMinutes)

      await load()

      expect(mockApi).toHaveBeenCalledWith('/api/v1/reading-progress?fileId=42')
    })

    it('sets state from response data on ok response', async () => {
      const data = {
        cfi: 'epubcfi(/6/4[c01]!/4/2/1:0)',
        pageNumber: 5,
        percentage: 42,
        koboLocationSource: 'KoboSpan',
        koboLocationType: 'KoboSpan',
        koboLocationValue: 'kobo.1.1',
        koboContentSourceProgressPercent: 0.42,
        koreaderProgress: '/body/DocFragment[1]/body/p[1]',
        positionSeconds: 123.5,
        mediaOverlayFragment: 'OPS/ch1.xhtml#s12',
        mediaOverlaySectionIndex: 2,
      }
      mockApi.mockResolvedValue(makeOkResponse(data))
      const elapsedMinutes = ref(0)
      const {
        load,
        cfi,
        pageNumber,
        percentage,
        koboLocationSource,
        koboLocationType,
        koboLocationValue,
        koboContentSourceProgressPercent,
        koreaderProgress,
        positionSeconds,
        mediaOverlayFragment,
        mediaOverlaySectionIndex,
        hasMediaOverlayProgress,
      } = useReaderProgress(1, 42, elapsedMinutes)

      await load()

      expect(cfi.value).toBe(data.cfi)
      expect(pageNumber.value).toBe(data.pageNumber)
      expect(percentage.value).toBe(data.percentage)
      expect(koboLocationSource.value).toBe(data.koboLocationSource)
      expect(koboLocationType.value).toBe(data.koboLocationType)
      expect(koboLocationValue.value).toBe(data.koboLocationValue)
      expect(koboContentSourceProgressPercent.value).toBe(data.koboContentSourceProgressPercent)
      expect(koreaderProgress.value).toBe(data.koreaderProgress)
      expect(positionSeconds.value).toBe(data.positionSeconds)
      expect(mediaOverlayFragment.value).toBe(data.mediaOverlayFragment)
      expect(mediaOverlaySectionIndex.value).toBe(data.mediaOverlaySectionIndex)
      expect(hasMediaOverlayProgress.value).toBe(true)
    })

    it('treats position-only EPUB3 narration rows as media-overlay progress', async () => {
      mockApi.mockResolvedValue(makeOkResponse({ positionSeconds: 900, mediaOverlayFragment: null, mediaOverlaySectionIndex: null }))
      const elapsedMinutes = ref(0)
      const { load, hasMediaOverlayProgress } = useReaderProgress(1, 42, elapsedMinutes)

      await load()

      expect(hasMediaOverlayProgress.value).toBe(true)
    })

    it('leaves state unchanged on non-ok response', async () => {
      mockApi.mockResolvedValue(makeErrorResponse())
      const elapsedMinutes = ref(0)
      const { load, cfi, percentage } = useReaderProgress(1, 42, elapsedMinutes)

      await load()

      expect(cfi.value).toBeNull()
      expect(percentage.value).toBe(0)
    })

    it('sets null/0 defaults when response fields are null or undefined', async () => {
      mockApi.mockResolvedValue(makeOkResponse({ cfi: null, pageNumber: null, percentage: null }))
      const elapsedMinutes = ref(0)
      const { load, cfi, pageNumber, percentage } = useReaderProgress(1, 42, elapsedMinutes)

      await load()

      expect(cfi.value).toBeNull()
      expect(pageNumber.value).toBeNull()
      expect(percentage.value).toBe(0)
    })
  })

  describe('onRelocate()', () => {
    it('updates cfi, fraction, and percentage from detail', () => {
      const elapsedMinutes = ref(0)
      const { onRelocate, cfi, fraction, percentage } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: 'epubcfi(/6/4)',
        fraction: 0.5,
        source: null,
        koboLocationValue: null,
        koboLocationType: null,
        contentSourceProgressPercent: null,
        koreaderProgress: null,
        tocItem: null,
        section: null,
        index: 0,
        total: 0,
        location: null,
        time: null,
      } as never)

      expect(cfi.value).toBe('epubcfi(/6/4)')
      expect(fraction.value).toBe(0.5)
      expect(percentage.value).toBe(50)
    })

    it('clamps out-of-range relocate progress values', () => {
      const elapsedMinutes = ref(0)
      const { onRelocate, fraction, percentage, koboContentSourceProgressPercent } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: 'epubcfi(/6/4)',
        fraction: 1.5,
        contentSourceProgressPercent: 125,
      } as never)

      expect(fraction.value).toBe(1)
      expect(percentage.value).toBe(100)
      expect(koboContentSourceProgressPercent.value).toBe(100)
    })

    it('preserves last valid progress when relocate fraction is non-finite', () => {
      const elapsedMinutes = ref(0)
      const { onRelocate, cfi, fraction, percentage, koboContentSourceProgressPercent } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: 'epubcfi(/6/4)',
        fraction: 0.42,
        contentSourceProgressPercent: 40,
      } as never)
      onRelocate({
        cfi: 'epubcfi(/6/10)',
        fraction: Number.NaN,
        contentSourceProgressPercent: Number.NaN,
      } as never)

      expect(cfi.value).toBe('epubcfi(/6/10)')
      expect(fraction.value).toBe(0.42)
      expect(percentage.value).toBe(42)
      expect(koboContentSourceProgressPercent.value).toBeNull()
    })

    it('does not schedule save when relocate has no usable location', () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { onRelocate } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: null,
        fraction: Number.NaN,
        koboLocationValue: null,
        koreaderProgress: null,
      } as never)

      vi.advanceTimersByTime(2500)
      expect(mockApi).not.toHaveBeenCalled()
    })

    describe('positions it did not move to (#1136)', () => {
      function postCount() {
        return mockApi.mock.calls.filter(([, opts]) => (opts as RequestInit | undefined)?.method === 'PUT').length
      }

      async function openWith(saved: Record<string, unknown>) {
        mockApi.mockResolvedValue(makeOkResponse(saved))
        const progress = useReaderProgress(1, 42, ref(0))
        await progress.load()
        return progress
      }

      it('does not save the page it opens on over a position a device saved', async () => {
        const { onRelocate } = await openWith({ cfi: 'epubcfi(/6/34!/4/4/58/3:150)', percentage: 23.93 })

        onRelocate({ cfi: 'epubcfi(/6/34!/4/4/2/3:0)', fraction: 0.237, reason: 'navigation', restoring: true } as never)
        vi.advanceTimersByTime(2500)

        expect(postCount()).toBe(0)
      })

      it('does not save a reflow of the same page', async () => {
        const { onRelocate } = await openWith({ cfi: 'epubcfi(/6/34!/4/4/58/3:150)', percentage: 23.93 })

        onRelocate({ cfi: 'epubcfi(/6/34!/4/4/2/3:0)', fraction: 0.237, reason: 'anchor' } as never)
        vi.advanceTimersByTime(2500)

        expect(postCount()).toBe(0)
      })

      it('does not restamp a paused narration when its page reflows', async () => {
        const { onRelocate } = await openWith({
          cfi: 'epubcfi(/6/34!/4/4/58/3:150)',
          percentage: 23.93,
          mediaOverlayFragment: 'chapter.xhtml#s12',
          mediaOverlaySectionIndex: 16,
        })

        onRelocate({ cfi: 'epubcfi(/6/34!/4/4/2/3:0)', fraction: 0.237, reason: 'anchor' } as never, 'narration')
        vi.advanceTimersByTime(2500)

        expect(postCount()).toBe(0)
      })

      it('saves a page the reader turned to', async () => {
        const { onRelocate } = await openWith({ cfi: 'epubcfi(/6/34!/4/4/58/3:150)', percentage: 23.93 })

        onRelocate({ cfi: 'epubcfi(/6/34!/4/4/84/1:405)', fraction: 0.249, reason: 'page' } as never)
        vi.advanceTimersByTime(2500)

        expect(postCount()).toBe(1)
        expect(postedProgressBody(1).cfi).toBe('epubcfi(/6/34!/4/4/84/1:405)')
      })

      it('still saves where a book with no saved position first opens', async () => {
        const { onRelocate } = await openWith({ cfi: null, percentage: 0 })

        onRelocate({ cfi: 'epubcfi(/6/2!/4/2/1:0)', fraction: 0, reason: 'navigation', restoring: true } as never)
        vi.advanceTimersByTime(2500)

        expect(postCount()).toBe(1)
      })
    })

    describe('a position another device moved on to', () => {
      const OPENED = '2026-10-17T06:40:00.000Z'
      const LATER = '2026-10-17T06:45:00.000Z'

      function getCount() {
        return mockApi.mock.calls.filter(([, opts]) => (opts as RequestInit | undefined)?.method === undefined).length
      }

      async function openAt(cfi: string) {
        mockApi.mockResolvedValueOnce(
          makeOkResponse({ cfi, percentage: 20, mediaOverlayFragment: 'c.xhtml#s1', mediaOverlaySectionIndex: 3, textUpdatedAt: OPENED }),
        )
        const progress = useReaderProgress(1, 42, ref(0))
        await progress.load()
        return progress
      }

      it('offers a position saved elsewhere since the reader opened', async () => {
        const progress = await openAt('epubcfi(/6/4!/4/2/1:0)')
        mockApi.mockResolvedValueOnce(
          makeOkResponse({ cfi: 'epubcfi(/6/4!/4/90/1:0)', percentage: 31.6, mediaOverlayFragment: 'c.xhtml#s40', textUpdatedAt: LATER }),
        )

        const newer = await progress.checkForNewerPosition()

        expect(newer?.percentage).toBe(31.6)
      })

      it('does not offer the position this reader saved itself', async () => {
        const progress = await openAt('epubcfi(/6/4!/4/2/1:0)')
        mockApi.mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
          headers: new Headers({ Date: new Date(LATER).toUTCString() }),
        } as Response)
        progress.onRelocate({ cfi: 'epubcfi(/6/4!/4/8/1:0)', fraction: 0.21, reason: 'page' } as never)
        await vi.advanceTimersByTimeAsync(2500)
        // The server can move what this reader wrote, as a narration write moves the page.
        mockApi.mockResolvedValueOnce(makeOkResponse({ cfi: 'epubcfi(/6/4!/4/10/1:0)', percentage: 21, textUpdatedAt: '2026-10-17T06:45:00.600Z' }))

        expect(await progress.checkForNewerPosition()).toBeNull()
      })

      it('does not ask while a save is waiting', async () => {
        const progress = await openAt('epubcfi(/6/4!/4/2/1:0)')
        progress.onRelocate({ cfi: 'epubcfi(/6/4!/4/8/1:0)', fraction: 0.21, reason: 'page' } as never)

        expect(await progress.checkForNewerPosition()).toBeNull()
        expect(getCount()).toBe(1)
      })

      it('takes both positions and does not save the page it lands on', async () => {
        const progress = await openAt('epubcfi(/6/4!/4/2/1:0)')
        mockApi.mockResolvedValueOnce(
          makeOkResponse({
            cfi: 'epubcfi(/6/4!/4/90/1:0)',
            percentage: 31.6,
            mediaOverlayFragment: 'c.xhtml#s40',
            mediaOverlaySectionIndex: 3,
            textUpdatedAt: LATER,
          }),
        )
        const newer = (await progress.checkForNewerPosition())!

        await progress.adoptNewerPosition(newer, async () => {
          progress.onRelocate({ cfi: 'epubcfi(/6/4!/4/88/1:0)', fraction: 0.31, reason: 'navigation' } as never)
        })
        await vi.advanceTimersByTimeAsync(2500)

        expect(progress.mediaOverlayFragment.value).toBe('c.xhtml#s40')
        expect(mockApi.mock.calls.some(([, opts]) => (opts as RequestInit | undefined)?.method === 'PUT')).toBe(false)
      })

      it('saves its own page as reading when it stays, and does not offer the other again', async () => {
        const progress = await openAt('epubcfi(/6/4!/4/2/1:0)')
        const elsewhere = makeOkResponse({ cfi: 'epubcfi(/6/4!/4/90/1:0)', percentage: 31.6, textUpdatedAt: LATER })
        mockApi.mockResolvedValueOnce(elsewhere)
        const newer = (await progress.checkForNewerPosition())!
        mockApi.mockResolvedValueOnce(makeOkResponse({}))

        await progress.keepCurrentPosition(newer)

        const posts = mockApi.mock.calls.filter(([, opts]) => (opts as RequestInit | undefined)?.method === 'PUT')
        expect(posts).toHaveLength(1)
        expect(JSON.parse((posts[0]![1] as RequestInit).body as string).writes[0]).toMatchObject({
          text: { cfi: 'epubcfi(/6/4!/4/2/1:0)' },
          kind: 'text',
        })
        mockApi.mockResolvedValueOnce(elsewhere)
        expect(await progress.checkForNewerPosition()).toBeNull()
      })
    })

    describe('narration saved while another device sent it back', () => {
      const OPENED = '2026-10-17T06:40:00.000Z'
      const RESET = '2026-10-17T06:45:00.000Z'
      const SECONDS: Record<string, number> = { 'c.xhtml#s0': 0, 'c.xhtml#s5': 900, 'c.xhtml#s9': 930, 'c.xhtml#s40': 2000 }
      const resetRow = {
        percentage: 0,
        mediaOverlayFragment: 'c.xhtml#s0',
        mediaOverlaySectionIndex: 3,
        narrationUpdatedAt: RESET,
        textUpdatedAt: RESET,
      }

      function posts() {
        return mockApi.mock.calls.filter(([, opts]) => (opts as RequestInit | undefined)?.method === 'PUT')
      }

      async function narrating(movedBack = vi.fn<(position: NewerPosition) => void>()) {
        mockApi.mockResolvedValueOnce(
          makeOkResponse({
            cfi: 'epubcfi(/6/4!/4/2/1:0)',
            percentage: 40,
            mediaOverlayFragment: 'c.xhtml#s5',
            mediaOverlaySectionIndex: 3,
            narrationUpdatedAt: OPENED,
          }),
        )
        const progress = useReaderProgress(1, 42, ref(0), 0, {
          narrationSeconds: async (fragment) => SECONDS[fragment] ?? null,
          onNarrationMovedBack: movedBack,
        })
        await progress.load()
        return { progress, movedBack }
      }

      // Read-aloud saves every few sentences, so a reset made on another device while it played was
      // overwritten by the next save and nobody was asked.
      it('holds the save and asks when another device sent narration well behind it', async () => {
        const { progress, movedBack } = await narrating()
        mockApi.mockResolvedValueOnce(makeOkResponse(resetRow))

        progress.setMediaOverlayProgress('c.xhtml#s9', 3)
        await vi.advanceTimersByTimeAsync(2500)

        expect(posts()).toHaveLength(0)
        expect(movedBack).toHaveBeenCalledWith(expect.objectContaining({ percentage: 0 }))
      })

      it('saves over another device that moved ahead', async () => {
        const { progress, movedBack } = await narrating()
        mockApi.mockResolvedValueOnce(
          makeOkResponse({ percentage: 84, mediaOverlayFragment: 'c.xhtml#s40', mediaOverlaySectionIndex: 3, narrationUpdatedAt: RESET }),
        )
        mockApi.mockResolvedValueOnce(makeOkResponse({}))

        progress.setMediaOverlayProgress('c.xhtml#s9', 3)
        await vi.advanceTimersByTimeAsync(2500)

        expect(posts()).toHaveLength(1)
        expect(movedBack).not.toHaveBeenCalled()
      })

      it('saves over the narration it last read or wrote without asking', async () => {
        const { progress, movedBack } = await narrating()
        mockApi.mockResolvedValueOnce(
          makeOkResponse({ percentage: 40, mediaOverlayFragment: 'c.xhtml#s5', mediaOverlaySectionIndex: 3, narrationUpdatedAt: OPENED }),
        )
        mockApi.mockResolvedValueOnce(makeOkResponse({}))

        progress.setMediaOverlayProgress('c.xhtml#s9', 3)
        await vi.advanceTimersByTimeAsync(2500)

        expect(posts()).toHaveLength(1)
        expect(movedBack).not.toHaveBeenCalled()
      })

      it('saves its own narration after staying', async () => {
        const { progress, movedBack } = await narrating()
        mockApi.mockResolvedValueOnce(makeOkResponse(resetRow))
        progress.setMediaOverlayProgress('c.xhtml#s9', 3)
        await vi.advanceTimersByTimeAsync(2500)
        const newer = movedBack.mock.calls[0]![0]
        mockApi.mockResolvedValueOnce(makeOkResponse(resetRow))
        mockApi.mockResolvedValueOnce(makeOkResponse({}))

        await progress.keepCurrentPosition(newer, 'narration')

        expect(posts()).toHaveLength(1)
        expect(JSON.parse((posts()[0]![1] as RequestInit).body as string).writes[0]).toMatchObject({
          narration: { fragment: 'c.xhtml#s9' },
          kind: 'narration',
        })
      })

      async function savedAt(progress: ReturnType<typeof useReaderProgress>, fragment: string, date: string) {
        mockApi.mockResolvedValueOnce(
          makeOkResponse({ percentage: 40, mediaOverlayFragment: 'c.xhtml#s5', mediaOverlaySectionIndex: 3, narrationUpdatedAt: OPENED }),
        )
        mockApi.mockResolvedValueOnce({ ok: true, headers: new Headers({ Date: new Date(date).toUTCString() }), json: async () => ({}) } as Response)
        progress.setMediaOverlayProgress(fragment, 3)
        await vi.advanceTimersByTimeAsync(2500)
      }

      // The response `Date` counts whole seconds, so a reset landing in the same second as this
      // reader's save looked like its own write and the next save went over it.
      it('asks when another device sent narration back in the same second as its own save', async () => {
        const { progress, movedBack } = await narrating()
        await savedAt(progress, 'c.xhtml#s9', RESET)
        mockApi.mockResolvedValueOnce(
          makeOkResponse({ ...resetRow, narrationUpdatedAt: '2026-10-17T06:45:00.400Z', textUpdatedAt: '2026-10-17T06:45:00.400Z' }),
        )

        progress.setMediaOverlayProgress('c.xhtml#s40', 3)
        await vi.advanceTimersByTimeAsync(2500)

        expect(posts()).toHaveLength(1)
        expect(movedBack).toHaveBeenCalledWith(expect.objectContaining({ percentage: 0 }))
      })

      it('saves over its own narration read back in the same second, even after skipping ahead', async () => {
        const { progress, movedBack } = await narrating()
        await savedAt(progress, 'c.xhtml#s9', RESET)
        mockApi.mockResolvedValueOnce(
          makeOkResponse({
            percentage: 41,
            mediaOverlayFragment: 'c.xhtml#s9',
            mediaOverlaySectionIndex: 3,
            narrationUpdatedAt: '2026-10-17T06:45:00.400Z',
          }),
        )
        mockApi.mockResolvedValueOnce(makeOkResponse({}))

        progress.setMediaOverlayProgress('c.xhtml#s40', 3)
        await vi.advanceTimersByTimeAsync(2500)

        expect(posts()).toHaveLength(2)
        expect(movedBack).not.toHaveBeenCalled()
      })
    })

    it('sets koboLocationSource and koboLocationValue from detail', () => {
      const elapsedMinutes = ref(0)
      const { onRelocate, koboLocationSource, koboLocationValue } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: null,
        fraction: 0,
        source: 'KoboSpan',
        koboLocationValue: 'kobo.1.1',
        koboLocationType: 'KoboSpan',
        contentSourceProgressPercent: null,
        koreaderProgress: null,
        tocItem: null,
        section: null,
        index: 0,
        total: 0,
        location: null,
        time: null,
      } as never)

      expect(koboLocationSource.value).toBe('KoboSpan')
      expect(koboLocationValue.value).toBe('kobo.1.1')
    })

    it('sets koboLocationType from detail when koboLocationValue is truthy', () => {
      const elapsedMinutes = ref(0)
      const { onRelocate, koboLocationType } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: null,
        fraction: 0,
        source: null,
        koboLocationValue: 'kobo.1.1',
        koboLocationType: 'CustomType',
        contentSourceProgressPercent: null,
        koreaderProgress: null,
        tocItem: null,
        section: null,
        index: 0,
        total: 0,
        location: null,
        time: null,
      } as never)

      expect(koboLocationType.value).toBe('CustomType')
    })

    it('sets koboLocationType to null when koboLocationValue is falsy', () => {
      const elapsedMinutes = ref(0)
      const { onRelocate, koboLocationType } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: null,
        fraction: 0,
        source: null,
        koboLocationValue: null,
        koboLocationType: 'KoboSpan',
        contentSourceProgressPercent: null,
        koreaderProgress: null,
        tocItem: null,
        section: null,
        index: 0,
        total: 0,
        location: null,
        time: null,
      } as never)

      expect(koboLocationType.value).toBeNull()
    })

    it('sets chapterTitle from tocItem.label', () => {
      const elapsedMinutes = ref(0)
      const { onRelocate, chapterTitle } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: null,
        fraction: 0,
        source: null,
        koboLocationValue: null,
        koboLocationType: null,
        contentSourceProgressPercent: null,
        koreaderProgress: null,
        tocItem: { label: 'Chapter One' },
        section: null,
        index: 0,
        total: 0,
        location: null,
        time: null,
      } as never)

      expect(chapterTitle.value).toBe('Chapter One')
    })

    it('sets sectionIndex and totalSections', () => {
      const elapsedMinutes = ref(0)
      const { onRelocate, sectionIndex, totalSections } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: null,
        fraction: 0,
        source: null,
        koboLocationValue: null,
        koboLocationType: null,
        contentSourceProgressPercent: null,
        koreaderProgress: null,
        tocItem: null,
        section: { current: 3, total: 10 },
        index: 0,
        total: 0,
        location: null,
        time: null,
      } as never)

      expect(sectionIndex.value).toBe(3)
      expect(totalSections.value).toBe(10)
    })

    it('sets location, section, time fields', () => {
      const elapsedMinutes = ref(0)
      const { onRelocate, locationCurrent, locationTotal, sectionCurrent, sectionTotal, timeSection, timeTotal } = useReaderProgress(
        1,
        42,
        elapsedMinutes,
      )

      onRelocate({
        cfi: null,
        fraction: 0,
        source: null,
        koboLocationValue: null,
        koboLocationType: null,
        contentSourceProgressPercent: null,
        koreaderProgress: null,
        tocItem: null,
        section: { current: 2, total: 8 },
        index: 0,
        total: 0,
        location: { current: 100, total: 500 },
        time: { section: 15, total: 200 },
      } as never)

      expect(locationCurrent.value).toBe(100)
      expect(locationTotal.value).toBe(500)
      expect(sectionCurrent.value).toBe(2)
      expect(sectionTotal.value).toBe(8)
      expect(timeSection.value).toBe(15)
      expect(timeTotal.value).toBe(200)
    })

    it('schedules save after 2000ms when trackingEnabled', () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { onRelocate } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({ cfi: null, fraction: 0 } as never)

      expect(mockApi).not.toHaveBeenCalled()
      vi.advanceTimersByTime(2000)
      expect(mockApi).toHaveBeenCalledWith('/api/v1/reading-progress', expect.objectContaining({ method: 'PUT' }))
    })

    it('does not schedule save when trackingEnabled is false', () => {
      const elapsedMinutes = ref(0)
      const { onRelocate } = useReaderProgress(1, 42, elapsedMinutes, 0, {
        trackingEnabled: ref(false),
      })

      onRelocate({ cfi: null, fraction: 0 } as never)

      vi.advanceTimersByTime(5000)
      expect(mockApi).not.toHaveBeenCalled()
    })

    it('clears previous save timer before scheduling new one', () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { onRelocate } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({ cfi: null, fraction: 0 } as never)
      vi.advanceTimersByTime(1000)
      onRelocate({ cfi: 'epubcfi(/6/4)', fraction: 0.1 } as never)
      vi.advanceTimersByTime(1999)

      expect(mockApi).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(mockApi).toHaveBeenCalledTimes(1)
    })
  })

  describe('save()', () => {
    it('puts the write to the progress route', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { save } = useReaderProgress(1, 42, elapsedMinutes)

      await save()

      expect(mockApi).toHaveBeenCalledWith(
        '/api/v1/reading-progress',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"writes"'),
        }),
      )
    })

    it('groups a page turn by position and leaves narration out of it', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { onRelocate, save } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: 'epubcfi(/6/2)',
        fraction: 0.25,
        source: 'OEBPS/c2.xhtml',
        koboLocationValue: 'kobo.2.1',
        koboLocationType: 'KoboSpan',
        contentSourceProgressPercent: 40,
        koreaderProgress: '/body/p[1]',
      } as never)
      vi.clearAllTimers()
      await save()

      expect(sentWrite()).toEqual({
        fileId: 42,
        kind: 'text',
        percentage: 25,
        text: { cfi: 'epubcfi(/6/2)', page: null },
        kobo: { source: 'OEBPS/c2.xhtml', type: 'KoboSpan', value: 'kobo.2.1', contentPercent: 40 },
        koreader: '/body/p[1]',
      })
    })

    it('does not call api when trackingEnabled is false', async () => {
      const elapsedMinutes = ref(0)
      const { save } = useReaderProgress(1, 42, elapsedMinutes, 0, {
        trackingEnabled: ref(false),
      })

      await save()

      expect(mockApi).not.toHaveBeenCalled()
    })

    it('sends all progress fields in body', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { onRelocate, save } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: 'epubcfi(/6/2)',
        fraction: 0.25,
        source: 'KoboSpan',
        koboLocationValue: 'kobo.2.1',
        koboLocationType: 'KoboSpan',
        contentSourceProgressPercent: 0.25,
        koreaderProgress: '/body/p[1]',
        tocItem: null,
        section: null,
        index: 0,
        total: 0,
        location: null,
        time: null,
      } as never)

      vi.clearAllTimers()
      await save()

      const body = postedProgressBody()
      expect(body.cfi).toBe('epubcfi(/6/2)')
      expect(body.percentage).toBe(25)
      expect(body.koboLocationSource).toBe('KoboSpan')
      expect(body.koboLocationValue).toBe('kobo.2.1')
      expect(body.koboLocationType).toBe('KoboSpan')
      expect(body.koboContentSourceProgressPercent).toBe(0.25)
      expect(body.koreaderProgress).toBe('/body/p[1]')
    })

    it('does not send non-string kobo location source from relocate events', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { onRelocate, save } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: 'epubcfi(/6/38!/4,/488/2/1:604,/512/2/1:89)',
        fraction: 0.69604585363819,
        source: 18,
        koboLocationValue: null,
        koboLocationType: null,
        contentSourceProgressPercent: 87.5,
        koreaderProgress: '/body/DocFragment[19]/body/p[222]/font/text().604',
      } as never)

      vi.clearAllTimers()
      await save()

      const body = postedProgressBody()
      expect(body.cfi).toBe('epubcfi(/6/38!/4,/488/2/1:604,/512/2/1:89)')
      expect(body.percentage).toBe(69.604585363819)
      expect(body.koboLocationSource).toBeNull()
      expect(body.koboLocationValue).toBeNull()
      expect(body.koboLocationType).toBeNull()
      expect(body.koboContentSourceProgressPercent).toBe(87.5)
      expect(body.koreaderProgress).toBe('/body/DocFragment[19]/body/p[222]/font/text().604')
    })

    it('serializes finite progress after invalid relocate values', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { onRelocate, save } = useReaderProgress(1, 42, elapsedMinutes)

      onRelocate({
        cfi: 'epubcfi(/6/4)',
        fraction: 0.42,
        contentSourceProgressPercent: 40,
      } as never)
      onRelocate({
        cfi: 'epubcfi(/6/10)',
        fraction: Number.POSITIVE_INFINITY,
        contentSourceProgressPercent: Number.NEGATIVE_INFINITY,
      } as never)

      vi.clearAllTimers()
      await save()

      const body = postedProgressBody()
      expect(body.cfi).toBe('epubcfi(/6/10)')
      expect(body.percentage).toBe(42)
      expect(Number.isFinite(body.percentage)).toBe(true)
      expect(body.koboContentSourceProgressPercent).toBeNull()
    })

    it('falls back to the last valid percentage when exposed state is non-finite', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { percentage, save } = useReaderProgress(1, 42, elapsedMinutes)

      percentage.value = 55
      await save()
      mockApi.mockClear()

      percentage.value = Number.NaN
      await save()

      const body = postedProgressBody()
      expect(body.percentage).toBe(55)
      expect(Number.isFinite(body.percentage)).toBe(true)
      expect(percentage.value).toBe(55)
    })

    it('sends media overlay progress fields in body', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { setMediaOverlayProgress, save } = useReaderProgress(1, 42, elapsedMinutes)

      setMediaOverlayProgress('OPS/ch1.xhtml#s12', 2)
      vi.clearAllTimers()
      await save()

      const body = postedProgressBody()
      expect(body.positionSeconds).toBeNull()
      expect(body.mediaOverlayFragment).toBe('OPS/ch1.xhtml#s12')
      expect(body.mediaOverlaySectionIndex).toBe(2)
    })

    // The two positions share one record, so the server has to be told which one moved: a
    // read-along resuming behind the page must not drag the page back to it.
    it('marks media overlay saves as narration and page moves as text', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { setMediaOverlayProgress, onRelocate, save } = useReaderProgress(1, 42, elapsedMinutes)

      setMediaOverlayProgress('OPS/ch1.xhtml#s12', 2, 44.3)
      vi.clearAllTimers()
      await save()
      expect(postedProgressBody().source).toBe('narration')

      onRelocate({ fraction: 0.32, cfi: 'epubcfi(/6/40)' } as never)
      vi.clearAllTimers()
      await save()
      expect(postedProgressBody(1).source).toBe('text')
    })

    it('saves later reading without sending, so without overwriting, the paused narration position', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const progress = useReaderProgress(1, 42, ref(0))
      progress.onRelocate({ fraction: 0.1, cfi: 'epubcfi(/6/4)' } as never)
      progress.setMediaOverlayProgress('OPS/ch1.xhtml#s12', 2, 44.3)
      await vi.advanceTimersByTimeAsync(2000)
      expect(postedProgressBody()).toMatchObject({ source: 'narration', percentage: 10 })

      progress.onRelocate({ fraction: 0.32, cfi: 'epubcfi(/6/40)' } as never)
      await vi.advanceTimersByTimeAsync(2000)
      const saved = postedProgressBody(1)
      expect(saved).toMatchObject({ source: 'text', percentage: 32, cfi: 'epubcfi(/6/40)' })
      expect(saved).not.toHaveProperty('positionSeconds')
      expect(saved).not.toHaveProperty('mediaOverlayFragment')
      expect(saved).not.toHaveProperty('mediaOverlaySectionIndex')

      // The server keeps the stored marker for a write that leaves it out.
      mockApi.mockResolvedValueOnce(
        makeOkResponse({ ...saved, positionSeconds: 44.3, mediaOverlayFragment: 'OPS/ch1.xhtml#s12', mediaOverlaySectionIndex: 2 }),
      )
      const reopened = useReaderProgress(1, 42, ref(0))
      await reopened.load()
      expect(reopened.cfi.value).toBe('epubcfi(/6/40)')
      expect(reopened.percentage.value).toBe(32)
      expect(reopened.positionSeconds.value).toBe(44.3)
      expect(reopened.mediaOverlayFragment.value).toBe('OPS/ch1.xhtml#s12')
      expect(reopened.mediaOverlaySectionIndex.value).toBe(2)
    })

    it('keeps delayed narration page relocations attributed to narration, then saves manual reading as text', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const progress = useReaderProgress(1, 42, ref(0))
      progress.onRelocate({ fraction: 0.32, cfi: 'epubcfi(/6/40)' })
      await vi.advanceTimersByTimeAsync(2000)
      progress.setMediaOverlayProgress('OPS/ch1.xhtml#s12', 2)
      progress.onRelocate({ fraction: 0.1, cfi: 'epubcfi(/6/4)' }, 'narration')
      await vi.advanceTimersByTimeAsync(2000)
      expect(postedProgressBody(1)).toMatchObject({ source: 'narration', percentage: 10 })

      progress.onRelocate({ fraction: 0.11, cfi: 'epubcfi(/6/4)' }, 'narration')
      await vi.advanceTimersByTimeAsync(2000)
      expect(postedProgressBody(2).source).toBe('narration')

      progress.onRelocate({ fraction: 0.33, cfi: 'epubcfi(/6/42)' })
      await vi.advanceTimersByTimeAsync(2000)
      expect(postedProgressBody(3)).toMatchObject({ source: 'text', percentage: 33 })
      expect(postedProgressBody(3)).not.toHaveProperty('mediaOverlayFragment')
    })
  })

  describe('cycleFooterMode()', () => {
    it('starts at initialFooterMode (default 0)', () => {
      const elapsedMinutes = ref(0)
      const { footerMode } = useReaderProgress(1, 42, elapsedMinutes)

      expect(footerMode.value).toBe(0)
    })

    it('starts at custom initialFooterMode', () => {
      const elapsedMinutes = ref(0)
      const { footerMode } = useReaderProgress(1, 42, elapsedMinutes, 2)

      expect(footerMode.value).toBe(2)
    })

    it('cycles 0 -> 1 -> 2 -> 0', () => {
      const elapsedMinutes = ref(0)
      const { footerMode, cycleFooterMode } = useReaderProgress(1, 42, elapsedMinutes)

      expect(footerMode.value).toBe(0)
      cycleFooterMode()
      expect(footerMode.value).toBe(1)
      cycleFooterMode()
      expect(footerMode.value).toBe(2)
      cycleFooterMode()
      expect(footerMode.value).toBe(0)
    })
  })
})
