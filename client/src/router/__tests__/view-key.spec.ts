import { describe, expect, it } from 'vitest'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { routes } from '@/router'
import { resolveRouteViewKey } from '@/router/view-key'

function route(path: string, matchedPath: string, meta: Record<string, unknown> = {}): RouteLocationNormalizedLoaded {
  return { path, matched: [{ path: matchedPath }], meta } as unknown as RouteLocationNormalizedLoaded
}

describe('resolveRouteViewKey', () => {
  it('keeps one key per matched route so param changes reuse the view', () => {
    const first = resolveRouteViewKey(route('/books/1', '/books/:bookId'))
    const second = resolveRouteViewKey(route('/books/2', '/books/:bookId'))

    expect(first).toBe(second)
  })

  it('keys per params where the route opts into remounting', () => {
    const first = resolveRouteViewKey(route('/read/1/10', '/read/:bookId/:fileId', { remountOnParamChange: true }))
    const second = resolveRouteViewKey(route('/read/2/20', '/read/:bookId/:fileId', { remountOnParamChange: true }))

    expect(first).not.toBe(second)
  })

  it('falls back to the path when nothing matched', () => {
    expect(resolveRouteViewKey({ path: '/nowhere', matched: [], meta: {} } as unknown as RouteLocationNormalizedLoaded)).toBe('/nowhere')
  })

  it('marks the reader route for remounting, since it reads its book and file once at setup', () => {
    const reader = routes.find((record) => record.name === 'reader')

    expect(reader?.meta?.remountOnParamChange).toBe(true)
  })
})
