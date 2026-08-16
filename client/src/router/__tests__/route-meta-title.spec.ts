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
  it('redirects the legacy Integrations tab URL to the Readwise page', () => {
    const route = findRoute(routes, 'settings-integrations')
    expect(route?.redirect).toBeTypeOf('function')

    const redirect = route!.redirect as (to: { query: Record<string, unknown> }) => unknown
    expect(redirect({ query: { tab: 'readwise' } })).toEqual({ name: 'settings-readwise', query: {} })
  })

  it('redirects the legacy Integrations tab URL to the standalone Kobo page', () => {
    const route = findRoute(routes, 'settings-integrations')
    const redirect = route!.redirect as (to: { query: Record<string, unknown> }) => unknown
    expect(redirect({ query: { tab: 'kobo' } })).toEqual({ name: 'settings-kobo', query: {} })
  })

  it('maps every legacy settings tab query to its own route', () => {
    const cases: { name: string; tab: string; expected: string }[] = [
      { name: 'settings-admin', tab: 'oidc', expected: 'settings-admin-oidc' },
      { name: 'settings-admin', tab: 'magic-links', expected: 'settings-admin-magic-links' },
      { name: 'settings-system', tab: 'audit-log', expected: 'settings-admin-audit-log' },
      { name: 'settings-system', tab: 'file-naming', expected: 'settings-file-naming' },
      { name: 'settings-admin-metadata', tab: 'auto-fetch', expected: 'settings-metadata-auto-fetch' },
      { name: 'settings-appearance', tab: 'layout', expected: 'settings-appearance-layout' },
      { name: 'settings-reader', tab: 'comics', expected: 'settings-reader-comics' },
      { name: 'settings-account', tab: 'notifications', expected: 'settings-notifications' },
    ]

    for (const { name, tab, expected } of cases) {
      const route = findRoute(routes, name)
      const redirect = route!.redirect as (to: { query: Record<string, unknown> }) => { name: string }
      expect(redirect({ query: { tab } }).name).toBe(expected)
    }
  })

  it('keeps unrelated query parameters when dropping the legacy tab parameter', () => {
    const route = findRoute(routes, 'settings-admin')
    const redirect = route!.redirect as (to: { query: Record<string, unknown> }) => { query: Record<string, unknown> }
    expect(redirect({ query: { tab: 'users', page: '2' } }).query).toEqual({ page: '2' })
  })
})
