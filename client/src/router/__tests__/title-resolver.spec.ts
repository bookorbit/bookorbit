import { describe, expect, it } from 'vitest'
import type { RouteLocationMatched, RouteLocationNormalizedLoaded } from 'vue-router'
import { resolveRouteTitle } from '@/router/title-resolver'

function routeWithMeta(title: string | ((route: RouteLocationNormalizedLoaded) => string) | undefined): RouteLocationNormalizedLoaded {
  return {
    fullPath: '/test',
    name: 'test',
    matched: [{ meta: { title } } as RouteLocationMatched],
  } as RouteLocationNormalizedLoaded
}

describe('resolveRouteTitle', () => {
  it('uses string route title', () => {
    expect(resolveRouteTitle(routeWithMeta('Authors'))).toBe('Authors · Projectx')
  })

  it('uses function route title', () => {
    const route = routeWithMeta(() => 'Audit Log')
    expect(resolveRouteTitle(route)).toBe('Audit Log · Projectx')
  })

  it('falls back to app title when route title is missing', () => {
    expect(resolveRouteTitle(routeWithMeta(undefined))).toBe('Projectx')
  })
})
