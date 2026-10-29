import { describe, expect, it } from 'vitest'
import type { ReadingHistoryItem } from '@bookorbit/types'
import { filtersFromQuery, queryFromFilters } from '../composables/useReadingHistoryFilters'
import { canvasToBlob, exportFileName, toCsv, toMarkdown } from '../lib/history-export'
import { readSpanDays } from '../lib/history-format'
import { historyRouteForChartClick } from '../lib/chart-month-link'
import { fitTiles, withAlpha } from '../lib/share-poster'

const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}(${JSON.stringify(values)})` : key)

function item(overrides: Partial<ReadingHistoryItem> = {}): ReadingHistoryItem {
  return {
    id: 1,
    bookId: 10,
    title: 'Ghost Story',
    authors: ['Peter Straub'],
    seriesName: null,
    seriesIndex: null,
    format: 'epub',
    pageCount: 567,
    coverVersion: null,
    startedOn: '2026-10-14',
    endedOn: '2026-10-19',
    outcome: 'completed',
    readNumber: 1,
    completedReads: 1,
    progressPercent: null,
    sessions: 4,
    seconds: 240,
    sources: ['web', 'koreader'],
    rating: null,
    highlightCount: 0,
    journalCount: 0,
    removedAt: null,
    ...overrides,
  }
}

describe('reading history filters in the URL', () => {
  it('reads defaults from an empty query: this year, finished reads, newest first', () => {
    expect(filtersFromQuery({}, 2026)).toMatchObject({ year: 2026, quarter: null, outcomes: ['completed'], sort: 'newest', bookId: null, search: '' })
  })

  it('round-trips every filter and leaves defaults out of the URL', () => {
    const filters = filtersFromQuery(
      { year: '2024', q: '3', outcomes: 'completed,abandoned', sort: 'oldest', book: '42', search: 'harry', view: 'covers' },
      2026,
    )
    expect(filters).toMatchObject({
      year: 2024,
      quarter: 3,
      outcomes: ['completed', 'abandoned'],
      sort: 'oldest',
      bookId: 42,
      search: 'harry',
      view: 'covers',
    })
    expect(queryFromFilters(filters, 2026)).toEqual({
      year: '2024',
      q: '3',
      outcomes: 'completed,abandoned',
      sort: 'oldest',
      book: '42',
      search: 'harry',
      view: 'covers',
    })
    expect(
      queryFromFilters(
        { ...filters, year: 2026, quarter: null, outcomes: ['completed'], sort: 'newest', bookId: null, search: '', view: 'list' },
        2026,
      ),
    ).toEqual({})
  })

  it('ignores malformed values instead of failing the page', () => {
    expect(filtersFromQuery({ year: 'abc', q: '9', outcomes: 'bogus', sort: 'sideways', book: '-1' }, 2026)).toMatchObject({
      year: 2026,
      quarter: null,
      outcomes: ['completed'],
      sort: 'newest',
      bookId: null,
    })
    expect(filtersFromQuery({ year: 'all', q: '2' }, 2026)).toMatchObject({ year: null, quarter: null })
  })
})

describe('reading history export', () => {
  it('writes Markdown grouped by month, marking rereads and outcomes', () => {
    const md = toMarkdown(
      [
        item(),
        item({ id: 2, title: 'A *bold* title', readNumber: 2, completedReads: 2, endedOn: '2026-10-02', startedOn: '2026-10-02' }),
        item({ id: 3, endedOn: '2026-09-30', outcome: 'abandoned', readNumber: null }),
      ],
      'Reading history, 2026',
      t,
    )
    const lines = md.split('\n')
    expect(lines[0]).toBe('# Reading history, 2026')
    expect(lines.filter((line) => line.startsWith('## '))).toHaveLength(2)
    expect(md).toContain('**A \\*bold\\* title**')
    expect(md).toContain('readingHistory.row.readNumber({"n":2})')
    expect(md).toContain('readingHistory.row.abandoned')
  })

  it('writes CSV with stable English headers and quoted values', () => {
    const csv = toCsv([item({ title: 'Commas, "quotes"', authors: ['Vaillant, John'], rating: 4 })])
      .trim()
      .split('\n')
    expect(csv[0]).toBe(
      'finished_on,started_on,title,authors,read_number,outcome,format,pages,minutes_read,sessions,rating,where,highlights,journal_entries,book_id,removed_from_library',
    )
    expect(csv[1]).toBe('2026-10-19,2026-10-14,"Commas, ""quotes""","Vaillant, John",1,completed,epub,567,4,4,4,BookOrbit; KOReader,0,0,10,')
  })

  it('names the file after the period, safe on every platform', () => {
    expect(exportFileName('Q3 2026', 'md')).toBe('reading-history-q3-2026.md')
    expect(exportFileName('All time', 'csv')).toBe('reading-history-all-time.csv')
  })

  it('waits for the canvas export callback when toBlob returns undefined', async () => {
    const blob = new Blob(['poster'], { type: 'image/png' })
    const canvas = {
      toBlob(callback: BlobCallback) {
        queueMicrotask(() => callback(blob))
      },
    } as HTMLCanvasElement

    await expect(canvasToBlob(canvas, 'image/png')).resolves.toBe(blob)
  })

  it('rejects when the canvas is unavailable or produces no data', async () => {
    const canvas = { toBlob: (callback: BlobCallback) => callback(null) } as HTMLCanvasElement

    await expect(canvasToBlob(null, 'image/png')).rejects.toThrow('Canvas is unavailable')
    await expect(canvasToBlob(canvas, 'image/png')).rejects.toThrow('Canvas export returned no data')
  })
})

describe('reading history helpers', () => {
  it('counts both the first and last day of a read', () => {
    expect(readSpanDays({ startedOn: '2026-10-14', endedOn: '2026-10-19' })).toBe(6)
    expect(readSpanDays({ startedOn: '2026-10-19', endedOn: '2026-10-19' })).toBe(1)
    expect(readSpanDays({ startedOn: null, endedOn: '2026-10-19' })).toBeNull()
  })

  it('opens History on the month under the pointer, and nothing outside the plot', () => {
    const points = [
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
    ]
    const chart = { containPixel: () => true, convertFromPixel: () => [1.2, 0] }
    expect(historyRouteForChartClick(chart, { offsetX: 1, offsetY: 1 }, points)).toEqual({
      name: 'reading-history',
      query: { year: '2026', month: '2026-10' },
    })
    expect(historyRouteForChartClick({ ...chart, containPixel: () => false }, { offsetX: 1, offsetY: 1 }, points)).toBeNull()
    expect(historyRouteForChartClick({ ...chart, convertFromPixel: () => [7, 0] }, { offsetX: 1, offsetY: 1 }, points)).toBeNull()
  })

  it('applies opacity to the accent whatever form it arrives in', () => {
    expect(withAlpha('#0fb', 0.5)).toBe('rgba(0, 255, 187, 0.5)')
    expect(withAlpha('#14b8a6', 0.2)).toBe('rgba(20, 184, 166, 0.2)')
    expect(withAlpha('rgb(20 184 166)', 0.2)).toBe('rgba(20, 184, 166, 0.2)')
  })

  it('fits every cover when it can, and folds the rest into one tile when it cannot', () => {
    const few = fitTiles(12, 936, 500, 12)
    expect(few.shown).toBe(12)
    expect(few.tile * 1.5 * Math.ceil(12 / few.columns)).toBeLessThanOrEqual(500)
    const many = fitTiles(2000, 936, 400, 12)
    expect(many.tile).toBe(40)
    expect(many.shown).toBeLessThan(2000)
  })
})
