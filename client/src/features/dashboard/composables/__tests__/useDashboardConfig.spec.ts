import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScrollerConfig } from '@bookorbit/types'

const STORAGE_KEY = 'bookorbit:dashboard:config'

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
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value).toEqual([
      {
        id: '99',
        type: 'smart-scope',
        label: 'Unread Favorites',
        enabled: false,
        order: 1,
        limit: 12,
        smartScopeId: 42,
      },
    ])
  })

  it('clones the default config before applying mutations', async () => {
    const { DEFAULT_SCROLLERS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, addScroller } = useDashboardConfig()

    expect(scrollers.value).toEqual(DEFAULT_SCROLLERS)
    expect(scrollers.value).not.toBe(DEFAULT_SCROLLERS)

    addScroller('smart-scope')

    expect(scrollers.value).toHaveLength(5)
    expect(DEFAULT_SCROLLERS).toHaveLength(4)
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
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 },
      { id: '3', type: 'smart-scope', label: 'Favorites', enabled: true, order: 2, limit: 20, smartScopeId: 42 },
    ])

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual(scrollers.value)
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
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 },
      { id: '17', type: 'smart-scope', label: 'Smart Scope', enabled: true, order: 2, limit: 20, smartScopeId: 23 },
    ])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual(scrollers.value)

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
      },
    ])
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
      { id: '1', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 },
      { id: '2', type: 'smart-scope', label: 'Unread', enabled: true, order: 2, limit: 20, smartScopeId: 42 },
    ])
    expect(setItemSpy).not.toHaveBeenCalled()

    setItemSpy.mockRestore()
  })
})
