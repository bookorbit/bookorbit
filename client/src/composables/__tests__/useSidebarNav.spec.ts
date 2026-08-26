import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Permission, type BrowseCounts } from '@bookorbit/types'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { SIDEBAR_NAV_REGISTRY, isNavEntryAllowed, resolveNavEntry, useSidebarNav } from '../useSidebarNav'

const mocks = vi.hoisted(() => ({ permissions: new Set<string>() }))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { count?: number }) => {
      const count = params?.count ?? 0
      if (key === 'components.sidebar.requestBadge.allActive') return `${count} active requests across all users`
      if (key === 'components.sidebar.requestBadge.mineActive') return `${count} active requests of yours`
      return key
    },
  }),
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRoute: () => ({ name: 'dashboard', params: {}, query: {} }),
  }
})

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => mocks.permissions.has(name) }),
}))

function makeContext(
  overrides: Partial<{
    permissions: string[]
    bookDockTotal: number
    outstandingRequestTotal: number
    outstandingRequestLabel: string
    browseCounts: BrowseCounts | null
  }> = {},
) {
  const permissions = overrides.permissions ?? []
  return {
    hasPermission: (name: string) => permissions.includes(name),
    bookDockTotal: overrides.bookDockTotal ?? 0,
    outstandingRequestTotal: overrides.outstandingRequestTotal ?? 0,
    outstandingRequestLabel: overrides.outstandingRequestLabel ?? '',
    browseCounts: overrides.browseCounts ?? null,
  }
}

function makeRoute(name: string, params: Record<string, string> = {}): RouteLocationNormalizedLoaded {
  return { name, params, query: {} } as unknown as RouteLocationNormalizedLoaded
}

function entry(id: string) {
  const found = SIDEBAR_NAV_REGISTRY.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Expected a registry entry for ${id}`)
  return found
}

function allowedIds(context: ReturnType<typeof makeContext>) {
  return SIDEBAR_NAV_REGISTRY.filter((candidate) => isNavEntryAllowed(candidate, context)).map((candidate) => candidate.id)
}

describe('sidebar nav registry', () => {
  beforeEach(() => {
    mocks.permissions.clear()
  })

  it('shows only ungated destinations to a user with no permissions', () => {
    expect(allowedIds(makeContext())).toEqual(['dashboard', 'authors', 'series', 'annotations'])
  })

  it('places Dashboard, Book Dock, Requests and Tools in the primary zone, above the entity sections', () => {
    const primary = SIDEBAR_NAV_REGISTRY.filter((candidate) => candidate.zone === 'primary').map((candidate) => candidate.id)

    expect(primary).toEqual(['dashboard', 'book-dock', 'book-requests', 'tools'])
  })

  it('leaves Statistics and Achievements to the header', () => {
    const ids = SIDEBAR_NAV_REGISTRY.map((candidate) => candidate.id)

    expect(ids).not.toContain('statistics')
    expect(ids).not.toContain('achievements')
  })

  it('shows Book Dock once the user holds book_dock_access', () => {
    expect(allowedIds(makeContext({ permissions: ['book_dock_access'] }))).toContain('book-dock')
  })

  it('shows Requests once the user holds book_request_access', () => {
    expect(allowedIds(makeContext({ permissions: ['book_request_access'] }))).toContain('book-requests')
  })

  it('hides Requests from a user without book_request_access', () => {
    expect(allowedIds(makeContext())).not.toContain('book-requests')
  })

  it.each(['book-requests', 'book-request-detail', 'book-request-releases'])('keeps Requests active on %s', (routeName) => {
    const resolved = resolveNavEntry(entry('book-requests'), makeContext({ permissions: ['book_request_access'] }), makeRoute(routeName), 'Requests')

    expect(resolved.isActive).toBe(true)
  })

  it.each(['manage_libraries', 'library_delete_books'])('shows Tools for the any-of permission %s', (permission) => {
    expect(allowedIds(makeContext({ permissions: [permission] }))).toContain('tools')
  })

  it('resolves Tools to the entity manager when the user can manage libraries', () => {
    const context = makeContext({ permissions: ['manage_libraries'] })

    const resolved = resolveNavEntry(entry('tools'), context, makeRoute('dashboard'), 'Tools')

    expect(resolved.to).toEqual({ name: 'tools-entity-manager' })
  })

  it('resolves Tools to duplicate books when the user can only delete books', () => {
    const context = makeContext({ permissions: ['library_delete_books'] })

    const resolved = resolveNavEntry(entry('tools'), context, makeRoute('dashboard'), 'Tools')

    expect(resolved.to).toEqual({ name: 'tools-duplicate-books' })
  })

  it('marks Tools active on any tools- route', () => {
    expect(entry('tools').isActive(makeRoute('tools-bulk-rename'))).toBe(true)
    expect(entry('tools').isActive(makeRoute('dashboard'))).toBe(false)
  })

  it('marks Authors active on the author detail route', () => {
    expect(entry('authors').isActive(makeRoute('author-detail', { id: '4' }))).toBe(true)
  })

  it('exposes the Book Dock badge only when items are queued', () => {
    const context = makeContext({ permissions: ['book_dock_access'], bookDockTotal: 3 })

    expect(resolveNavEntry(entry('book-dock'), context, makeRoute('dashboard'), 'Book Dock').badge).toEqual({ value: 3 })
    expect(resolveNavEntry(entry('book-dock'), makeContext(), makeRoute('dashboard'), 'Book Dock').badge).toBeNull()
  })

  it('exposes the Requests badge only when requests are outstanding', () => {
    const context = makeContext({
      permissions: ['book_request_access'],
      outstandingRequestTotal: 6,
      outstandingRequestLabel: '6 active requests of yours',
    })

    expect(resolveNavEntry(entry('book-requests'), context, makeRoute('dashboard'), 'Requests').badge).toEqual({
      value: 6,
      label: '6 active requests of yours',
    })
    expect(resolveNavEntry(entry('book-requests'), makeContext(), makeRoute('dashboard'), 'Requests').badge).toBeNull()
  })

  it.each([
    ['a requester', [], '2 active requests of yours'],
    ['a request manager', [Permission.ManageBookRequests], '2 active requests across all users'],
  ])('describes the Requests badge scope for %s', (_role, permissions, expectedLabel) => {
    mocks.permissions.add(Permission.BookRequestAccess)
    for (const permission of permissions) mocks.permissions.add(permission)

    const { zones } = useSidebarNav(() => 2)
    const requests = zones.value.flatMap((zone) => zone.entries).find((candidate) => candidate.id === 'book-requests')

    expect(requests?.badge).toEqual({ value: 2, label: expectedLabel })
  })

  it.each([
    ['authors', 1234],
    ['series', 312],
    ['annotations', 18000],
  ])('badges %s with its browse count', (id, expected) => {
    const context = makeContext({ browseCounts: { authors: 1234, series: 312, annotations: 18000 } })

    expect(resolveNavEntry(entry(id), context, makeRoute('dashboard'), id).badge).toEqual({ value: expected })
  })

  it('leaves the browse rows unbadged before the counts load and while they are zero', () => {
    const zeroed = makeContext({ browseCounts: { authors: 0, series: 0, annotations: 0 } })

    for (const id of ['authors', 'series', 'annotations']) {
      expect(resolveNavEntry(entry(id), makeContext(), makeRoute('dashboard'), id).badge).toBeNull()
      expect(resolveNavEntry(entry(id), zeroed, makeRoute('dashboard'), id).badge).toBeNull()
    }
  })

  it('gives every entry a zone and a unique id', () => {
    const ids = SIDEBAR_NAV_REGISTRY.map((candidate) => candidate.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const candidate of SIDEBAR_NAV_REGISTRY) {
      expect(['primary', 'browse']).toContain(candidate.zone)
    }
  })
})
