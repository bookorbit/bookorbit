import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScrollerConfig } from '@bookorbit/types'

const STORAGE_KEY = 'bookorbit:dashboard:config'

function storedConfig(): { scrollers: ScrollerConfig[]; shelfLayout: string } {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { scrollers: ScrollerConfig[]; shelfLayout: string }
}

describe('useDashboardConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })

  it('normalizes legacy object storage into a scroller array', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scrollers: [
          {
            id: 99,
            type: 'smart-scope',
            label: 'Unread Favorites',
            enabled: 'false',
            order: 7,
            limit: '12',
            smartScopeId: '42',
          },
        ],
      }),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, shelfLayout } = useDashboardConfig()

    expect(scrollers.value).toEqual([
      {
        id: '99',
        type: 'smart-scope',
        label: 'Unread Favorites',
        enabled: false,
        order: 1,
        limit: 12,
        rows: 1,
        smartScopeId: 42,
      },
    ])
    expect(shelfLayout.value).toBe('wide')
  })

  it('clones the default config before applying mutations', async () => {
    const { DEFAULT_SCROLLERS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, addScroller } = useDashboardConfig()

    expect(scrollers.value).toEqual(DEFAULT_SCROLLERS)
    expect(scrollers.value).not.toBe(DEFAULT_SCROLLERS)
    expect(DEFAULT_SCROLLERS.map((scroller) => [scroller.type, scroller.label, scroller.enabled, scroller.order])).toEqual([
      ['recently-added', 'Recently Added', true, 1],
      ['random', 'Discover Something New', true, 2],
      ['continue-reading', 'Continue Reading', true, 3],
      ['continue-listening', 'Continue Listening', true, 4],
      ['want-to-read', 'Want to Read', false, 5],
      ['up-next-in-series', 'Up Next in Series', false, 6],
    ])

    addScroller('smart-scope')

    expect(scrollers.value).toHaveLength(7)
    expect(DEFAULT_SCROLLERS).toHaveLength(6)
  })

  it('prunes shelves that reference deleted smart scopes', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 },
        { id: '2', type: 'smart-scope', label: 'Unread', enabled: true, order: 2, limit: 20, smartScopeId: 41 },
        { id: '3', type: 'smart-scope', label: 'Favorites', enabled: true, order: 3, limit: 20, smartScopeId: 42 },
      ]),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, pruneDeletedSmartScopeScrollers } = useDashboardConfig()

    pruneDeletedSmartScopeScrollers([42])

    expect(scrollers.value).toEqual([
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20, rows: 1 },
      { id: '3', type: 'smart-scope', label: 'Favorites', enabled: true, order: 2, limit: 20, rows: 1, smartScopeId: 42 },
    ])

    expect(storedConfig()).toEqual({ scrollers: scrollers.value, shelfLayout: 'wide' })
  })

  it('falls back to defaults when stored JSON is malformed', async () => {
    localStorage.setItem(STORAGE_KEY, '{bad json')

    const { DEFAULT_SCROLLERS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value).toEqual(DEFAULT_SCROLLERS)
  })

  it('normalizes saveScrollers input and reset clears local storage', async () => {
    const { DEFAULT_SCROLLERS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, saveScrollers, reset } = useDashboardConfig()

    const malformedScrollers = [
      {
        id: '  ',
        type: 'recently-added',
        label: '   ',
        enabled: 'sometimes',
        order: 99,
        limit: 'oops',
      },
      {
        id: 17,
        type: 'smart-scope',
        label: '',
        enabled: 'true',
        order: 42,
        limit: 0,
        smartScopeId: 23,
      },
    ] as unknown as ScrollerConfig[]

    saveScrollers(malformedScrollers)

    expect(scrollers.value).toEqual([
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20, rows: 1 },
      { id: '17', type: 'smart-scope', label: 'Smart Scope', enabled: true, order: 2, limit: 20, rows: 1, smartScopeId: 23 },
    ])
    expect(storedConfig()).toEqual({ scrollers: scrollers.value, shelfLayout: 'wide' })

    reset()

    expect(scrollers.value).toEqual(DEFAULT_SCROLLERS)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('uses the default label for up-next-in-series when a custom label is empty', async () => {
    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, saveScrollers } = useDashboardConfig()

    saveScrollers([
      {
        id: '12',
        type: 'up-next-in-series',
        label: '   ',
        enabled: true,
        order: 1,
        limit: 20,
        rows: 1,
      },
    ])

    expect(scrollers.value).toEqual([
      {
        id: '12',
        type: 'up-next-in-series',
        label: 'Up Next in Series',
        enabled: true,
        order: 1,
        limit: 20,
        rows: 1,
      },
    ])
  })

  it('persists the two-column shelf layout with the shelf configuration', async () => {
    const { SHELF_LAYOUT, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, shelfLayout, saveShelfSettings } = useDashboardConfig()

    saveShelfSettings(scrollers.value, SHELF_LAYOUT.TWO_COLUMNS)

    expect(shelfLayout.value).toBe(SHELF_LAYOUT.TWO_COLUMNS)
    expect(storedConfig()).toEqual({ scrollers: scrollers.value, shelfLayout: SHELF_LAYOUT.TWO_COLUMNS })
  })

  it('normalizes an unknown stored shelf layout to wide rows', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scrollers: [{ id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 }],
        shelfLayout: 'unsupported-layout',
      }),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { shelfLayout } = useDashboardConfig()

    expect(shelfLayout.value).toBe('wide')
  })

  it('preserves and normalizes continue-listening and want-to-read shelves', async () => {
    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, saveScrollers } = useDashboardConfig()

    saveScrollers([
      {
        id: '21',
        type: 'continue-listening',
        label: '',
        enabled: 'true',
        order: 10,
        limit: '9',
      },
      {
        id: '22',
        type: 'want-to-read',
        label: 'Reading Queue',
        enabled: 'false',
        order: 11,
        limit: 12,
      },
    ] as unknown as ScrollerConfig[])

    expect(scrollers.value).toEqual([
      {
        id: '21',
        type: 'continue-listening',
        label: 'Continue Listening',
        enabled: true,
        order: 1,
        limit: 9,
        rows: 1,
      },
      {
        id: '22',
        type: 'want-to-read',
        label: 'Reading Queue',
        enabled: false,
        order: 2,
        limit: 12,
        rows: 1,
      },
    ])
  })

  it('defaults every shelf to a single row', async () => {
    const { DEFAULT_SCROLLERS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, addScroller } = useDashboardConfig()

    expect(DEFAULT_SCROLLERS.map((scroller) => scroller.rows)).toEqual([1, 1, 1, 1, 1, 1])

    addScroller('random')

    expect(scrollers.value.at(-1)?.rows).toBe(1)
  })

  it('backfills a single row for configs stored before multi-row shelves', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scrollers: [{ id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 }],
        shelfLayout: 'wide',
      }),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value[0]?.rows).toBe(1)
  })

  it('persists a configured row count and clamps it to the supported range', async () => {
    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, saveScrollers } = useDashboardConfig()

    saveScrollers([
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20, rows: 3 },
      { id: '2', type: 'random', label: 'Discover Something New', enabled: true, order: 2, limit: 20, rows: 9 },
      { id: '3', type: 'continue-reading', label: 'Continue Reading', enabled: true, order: 3, limit: 20, rows: 0 },
    ])

    expect(scrollers.value.map((scroller) => scroller.rows)).toEqual([3, 3, 1])
    expect(storedConfig().scrollers.map((scroller) => scroller.rows)).toEqual([3, 3, 1])
  })

  it('parses a stringified row count the way stored limits are parsed', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20, rows: '2' }]),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value[0]?.rows).toBe(2)
  })

  it('does not rewrite storage when smart scope prune keeps the same scrollers', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 },
        { id: '2', type: 'smart-scope', label: 'Unread', enabled: true, order: 2, limit: 20, smartScopeId: 42 },
      ]),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, pruneDeletedSmartScopeScrollers } = useDashboardConfig()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    pruneDeletedSmartScopeScrollers([42])

    expect(scrollers.value).toEqual([
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20, rows: 1 },
      { id: '2', type: 'smart-scope', label: 'Unread', enabled: true, order: 2, limit: 20, rows: 1, smartScopeId: 42 },
    ])
    expect(setItemSpy).not.toHaveBeenCalled()

    setItemSpy.mockRestore()
  })
})
