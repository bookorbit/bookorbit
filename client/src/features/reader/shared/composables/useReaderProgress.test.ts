import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

vi.mock('@/lib/api', () => ({ api: vi.fn<(...args: unknown[]) => unknown>() }))

import { api } from '@/lib/api'
import { formatTimeRemaining, useReaderProgress } from './useReaderProgress'

const mockApi = vi.mocked(api)

function makeOkResponse(data: Record<string, unknown>) {
  return { ok: true, json: async () => data } as Response
}

function makeErrorResponse() {
  return { ok: false } as Response
}

function postedProgressBody(callIndex = 0): Record<string, unknown> {
  const [, opts] = mockApi.mock.calls[callIndex]!
  return JSON.parse((opts as RequestInit).body as string) as Record<string, unknown>
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

      expect(mockApi).toHaveBeenCalledWith('/api/v1/books/files/42/progress')
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
      expect(mockApi).toHaveBeenCalledWith('/api/v1/books/files/42/progress', expect.objectContaining({ method: 'POST' }))
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
    it('calls api POST with all progress fields', async () => {
      mockApi.mockResolvedValue(makeOkResponse({}))
      const elapsedMinutes = ref(0)
      const { save } = useReaderProgress(1, 42, elapsedMinutes)

      await save()

      expect(mockApi).toHaveBeenCalledWith(
        '/api/v1/books/files/42/progress',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"cfi"'),
        }),
      )
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
