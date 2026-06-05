import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { formatTimeRemaining, useReaderProgress } from '../useReaderProgress'
import type { RelocateDetail } from '../../../epub/composables/useFoliate'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

describe('formatTimeRemaining', () => {
  it('returns empty string for NaN', () => {
    expect(formatTimeRemaining(NaN)).toBe('')
  })

  it('returns empty string for negative values', () => {
    expect(formatTimeRemaining(-5)).toBe('')
  })

  it('returns empty string for Infinity', () => {
    expect(formatTimeRemaining(Infinity)).toBe('')
  })

  it('returns "< 1 min" for values less than 1', () => {
    expect(formatTimeRemaining(0)).toBe('< 1 min')
    expect(formatTimeRemaining(0.5)).toBe('< 1 min')
    expect(formatTimeRemaining(0.99)).toBe('< 1 min')
  })

  it('returns minutes for values less than 60', () => {
    expect(formatTimeRemaining(1)).toBe('1 min')
    expect(formatTimeRemaining(15)).toBe('15 min')
    expect(formatTimeRemaining(59.4)).toBe('59 min')
  })

  it('returns hours only when remainder is 0', () => {
    expect(formatTimeRemaining(60)).toBe('1 hr')
    expect(formatTimeRemaining(120)).toBe('2 hr')
  })

  it('returns hours and minutes for larger values', () => {
    expect(formatTimeRemaining(90)).toBe('1 hr 30 min')
    expect(formatTimeRemaining(150)).toBe('2 hr 30 min')
  })
})

describe('useReaderProgress', () => {
  const elapsedMinutes = ref(0)

  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    elapsedMinutes.value = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeDetail(overrides?: Partial<RelocateDetail>): RelocateDetail {
    return {
      cfi: 'epubcfi(/6/4)',
      fraction: 0.35,
      index: 2,
      source: 'OEBPS/html/ch3.xhtml',
      koboLocationType: 'KoboSpan',
      koboLocationValue: 'kobo.25.1',
      contentSourceProgressPercent: 25,
      koreaderProgress: '/body/DocFragment[3]/body/p[4]/text()[1].2',
      total: 10,
      tocItem: { label: 'Chapter 3', href: 'ch3.xhtml' },
      section: { current: 2, total: 10 },
      location: { current: 35, next: 36, total: 100 },
      time: { section: 12.5, total: 45.3 },
      ...overrides,
    }
  }

  it('populates all refs from a full relocate detail', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes)
    progress.onRelocate(makeDetail())

    expect(progress.cfi.value).toBe('epubcfi(/6/4)')
    expect(progress.fraction.value).toBe(0.35)
    expect(progress.percentage.value).toBe(35)
    expect(progress.koboLocationSource.value).toBe('OEBPS/html/ch3.xhtml')
    expect(progress.koboLocationType.value).toBe('KoboSpan')
    expect(progress.koboLocationValue.value).toBe('kobo.25.1')
    expect(progress.koboContentSourceProgressPercent.value).toBe(25)
    expect(progress.koreaderProgress.value).toBe('/body/DocFragment[3]/body/p[4]/text()[1].2')
    expect(progress.chapterTitle.value).toBe('Chapter 3')
    expect(progress.sectionIndex.value).toBe(2)
    expect(progress.totalSections.value).toBe(10)
    expect(progress.locationCurrent.value).toBe(35)
    expect(progress.locationTotal.value).toBe(100)
    expect(progress.sectionCurrent.value).toBe(2)
    expect(progress.sectionTotal.value).toBe(10)
    expect(progress.timeSection.value).toBe(12.5)
    expect(progress.timeTotal.value).toBe(45.3)
  })

  it('handles missing location/section/time gracefully', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes)
    progress.onRelocate({
      cfi: 'epubcfi(/6/2)',
      fraction: 0.1,
      index: 1,
      total: 5,
    })

    expect(progress.locationCurrent.value).toBe(0)
    expect(progress.locationTotal.value).toBe(0)
    expect(progress.sectionCurrent.value).toBe(0)
    expect(progress.sectionTotal.value).toBe(0)
    expect(progress.timeSection.value).toBe(0)
    expect(progress.timeTotal.value).toBe(0)
  })

  it('falls back to index/total when section is missing', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes)
    progress.onRelocate({
      cfi: 'epubcfi(/6/2)',
      fraction: 0.1,
      index: 3,
      total: 8,
    })

    expect(progress.sectionIndex.value).toBe(3)
    expect(progress.totalSections.value).toBe(8)
  })

  it('cycles footer mode 0 -> 1 -> 2 -> 0', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes, 0)

    expect(progress.footerMode.value).toBe(0)
    progress.cycleFooterMode()
    expect(progress.footerMode.value).toBe(1)
    progress.cycleFooterMode()
    expect(progress.footerMode.value).toBe(2)
    progress.cycleFooterMode()
    expect(progress.footerMode.value).toBe(0)
  })

  it('initializes footer mode from parameter', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes, 2)
    expect(progress.footerMode.value).toBe(2)
  })

  it('handles null/undefined detail gracefully', () => {
    const progress = useReaderProgress(1, 1, elapsedMinutes)
    progress.onRelocate(undefined as unknown as RelocateDetail)

    expect(progress.cfi.value).toBeNull()
    expect(progress.fraction.value).toBe(0)
    expect(progress.percentage.value).toBe(0)
  })

  describe('buildFooterContent (tested via internal state)', () => {
    it('mode 0: shows page info and percentage', () => {
      const progress = useReaderProgress(1, 1, elapsedMinutes, 0)
      progress.onRelocate(makeDetail({ fraction: 0.35, location: { current: 35, next: 36, total: 100 } }))

      // We can't directly test buildFooterContent since it's private,
      // but we verify the underlying state that feeds it
      expect(progress.locationCurrent.value).toBe(35)
      expect(progress.locationTotal.value).toBe(100)
      expect(progress.footerMode.value).toBe(0)
    })

    it('mode 1: uses elapsed minutes from session', () => {
      elapsedMinutes.value = 15
      const progress = useReaderProgress(1, 1, elapsedMinutes, 1)
      progress.onRelocate(makeDetail({ time: { section: 10, total: 42 } }))

      expect(progress.timeTotal.value).toBe(42)
      expect(progress.footerMode.value).toBe(1)
    })

    it('mode 2: uses section/chapter time', () => {
      const progress = useReaderProgress(1, 1, elapsedMinutes, 2)
      progress.onRelocate(makeDetail({ section: { current: 3, total: 12 }, time: { section: 8, total: 45 } }))

      expect(progress.sectionCurrent.value).toBe(3)
      expect(progress.sectionTotal.value).toBe(12)
      expect(progress.timeSection.value).toBe(8)
    })
  })

  it('debounces save calls on relocate', async () => {
    vi.useFakeTimers()
    const progress = useReaderProgress(1, 1, elapsedMinutes)

    progress.onRelocate(makeDetail({ fraction: 0.1 }))
    progress.onRelocate(makeDetail({ fraction: 0.2 }))
    progress.onRelocate(makeDetail({ fraction: 0.3 }))

    expect(apiMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2500)

    const saveCalls = apiMock.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/progress') && (c[1] as { method?: string })?.method === 'POST',
    )
    expect(saveCalls.length).toBe(1)
    const saveCall = saveCalls[0]
    if (!saveCall) throw new Error('Expected one progress save call')
    const saveBody = JSON.parse((saveCall[1] as { body: string }).body)
    expect(saveBody).toEqual(
      expect.objectContaining({
        percentage: 30,
        koboLocationSource: 'OEBPS/html/ch3.xhtml',
        koboLocationType: 'KoboSpan',
        koboLocationValue: 'kobo.25.1',
        koboContentSourceProgressPercent: 25,
        koreaderProgress: '/body/DocFragment[3]/body/p[4]/text()[1].2',
      }),
    )

    vi.useRealTimers()
  })

  it('keeps relocate state in memory without loading or saving when tracking is disabled', async () => {
    vi.useFakeTimers()
    const trackingEnabled = ref(false)
    const progress = useReaderProgress(1, 1, elapsedMinutes, 0, { trackingEnabled })

    await progress.load()
    progress.onRelocate(makeDetail({ fraction: 0.42 }))
    await progress.save()
    await vi.advanceTimersByTimeAsync(2500)

    expect(progress.percentage.value).toBe(42)
    expect(apiMock).not.toHaveBeenCalled()

    vi.useRealTimers()
  })
})
