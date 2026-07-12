import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationMatched, RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { i18n, setI18nLocale } from '@/i18n'
import { registerRouteTitleHook, resolveRouteTitle } from '@/router/title-resolver'

function routeWithMeta(title: string | ((route: RouteLocationNormalizedLoaded) => string) | undefined): RouteLocationNormalizedLoaded {
  return {
    fullPath: '/test',
    name: 'test',
    matched: [{ meta: { title } } as RouteLocationMatched],
  } as RouteLocationNormalizedLoaded
}

describe('resolveRouteTitle', () => {
  afterEach(async () => {
    await setI18nLocale('en')
  })

  it('uses string route title', () => {
    expect(resolveRouteTitle(routeWithMeta('Authors'))).toBe('Authors · BookOrbit')
  })

  it('uses function route title', () => {
    const route = routeWithMeta(() => 'Audit Log')
    expect(resolveRouteTitle(route)).toBe('Audit Log · BookOrbit')
  })

  it('falls back to app title when route title is missing', () => {
    expect(resolveRouteTitle(routeWithMeta(undefined))).toBe('BookOrbit')
  })

  it('refreshes the current route title when the locale changes', async () => {
    const route = routeWithMeta(() => i18n.global.t('titles.authors'))
    let afterEachHook: ((route: RouteLocationNormalizedLoaded) => void) | undefined
    const router = {
      currentRoute: ref(route),
      afterEach: vi.fn<(hook: (route: RouteLocationNormalizedLoaded) => void) => void>((hook) => {
        afterEachHook = hook
      }),
    } as unknown as Router

    registerRouteTitleHook(router)
    afterEachHook?.(route)
    expect(document.title).toBe('Authors · BookOrbit')

    await setI18nLocale('nl')
    await nextTick()
    expect(document.title).toBe('Auteurs · BookOrbit')
  })
})
