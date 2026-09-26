import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'

import { APP_FEATURES } from '@bookorbit/types'
import { routes } from '@/router'

function flattenRoutes(entries: readonly RouteRecordRaw[]): RouteRecordRaw[] {
  return entries.flatMap((entry) => [entry, ...flattenRoutes(entry.children ?? [])])
}

describe('podcast feature flag', () => {
  it('is hardcoded off and removes every podcast route', () => {
    const flattened = flattenRoutes(routes)

    expect(APP_FEATURES.podcasts).toBe(false)
    expect(Object.isFrozen(APP_FEATURES)).toBe(true)
    expect(flattened.map((route) => route.name).filter((name) => String(name).startsWith('podcast-'))).toEqual([])
    expect(flattened.map((route) => route.path).filter((path) => path.startsWith('/podcasts') || path.startsWith('/listen/podcast'))).toEqual([])
    expect(flattened.map((route) => route.name)).not.toContain('settings-podcasts')
  })
})
