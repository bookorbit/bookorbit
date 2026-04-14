import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'projectx:dashboard:config'

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
            type: 'lens',
            label: 'Unread Favorites',
            enabled: 'false',
            order: 7,
            limit: '12',
            lensId: '42',
          },
        ],
      }),
    )

    const { useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers } = useDashboardConfig()

    expect(scrollers.value).toEqual([
      {
        id: '99',
        type: 'lens',
        label: 'Unread Favorites',
        enabled: false,
        order: 1,
        limit: 12,
        lensId: 42,
      },
    ])
  })

  it('clones the default config before applying mutations', async () => {
    const { DEFAULT_SCROLLERS, useDashboardConfig } = await import('../useDashboardConfig')
    const { scrollers, addScroller } = useDashboardConfig()

    expect(scrollers.value).toEqual(DEFAULT_SCROLLERS)
    expect(scrollers.value).not.toBe(DEFAULT_SCROLLERS)

    addScroller('lens')

    expect(scrollers.value).toHaveLength(4)
    expect(DEFAULT_SCROLLERS).toHaveLength(3)
  })
})
