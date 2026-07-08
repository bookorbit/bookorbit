import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'
import { routes } from '@/router'

type MissingRoute = {
  name: string
  path: string
}

function walkRoutes(records: RouteRecordRaw[], visit: (route: RouteRecordRaw, fullPath: string) => void, parentPath = '') {
  for (const record of records) {
    const segment = record.path ?? ''
    const fullPath = segment.startsWith('/') ? segment : `${parentPath.replace(/\/$/, '')}/${segment}`.replace(/\/+/g, '/')
    visit(record, fullPath || '/')
    if (record.children?.length) {
      walkRoutes(record.children, visit, fullPath || '/')
    }
  }
}

function findRoute(records: RouteRecordRaw[], name: string): RouteRecordRaw | undefined {
  for (const record of records) {
    if (record.name === name) return record
    const child = record.children ? findRoute(record.children, name) : undefined
    if (child) return child
  }
  return undefined
}

describe('router title metadata', () => {
  it('requires meta.title on all named non-redirect routes', () => {
    const missing: MissingRoute[] = []

    walkRoutes(routes, (route, fullPath) => {
      if (!route.name || route.redirect) return
      const title = route.meta?.title
      const hasTitle = typeof title === 'string' || typeof title === 'function'
      if (!hasTitle) {
        missing.push({ name: String(route.name), path: fullPath })
      }
    })

    expect(missing).toEqual([])
  })
})

describe('router redirects', () => {
  it('redirects legacy integrations readwise tab to the Readwise settings route', () => {
    const route = findRoute(routes, 'settings-integrations')
    expect(route?.redirect).toBeTypeOf('function')

    const redirect = route!.redirect as (to: { query: Record<string, unknown> }) => unknown
    expect(redirect({ query: { tab: 'readwise' } })).toEqual({ name: 'settings-readwise' })
  })
})
