import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Permission, type BrowseCounts, type JobsSummary } from '@bookorbit/types'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { SIDEBAR_NAV_REGISTRY, isNavEntryAllowed, resolveNavEntry, useSidebarNav } from '../useSidebarNav'

const mocks = vi.hoisted(() => ({ permissions: new Set<string>(), jobsSummary: { value: null as JobsSummary | null } }))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { count?: number; types?: string }) => {
      const count = params?.count ?? 0
      if (key === 'components.sidebar.requestBadge.allActive') return `${count} active requests across all users`
      if (key === 'components.sidebar.requestBadge.mineActive') return `${count} active requests of yours`
      if (key === 'components.sidebar.jobs.running') return `${count} running`
      if (key === 'components.sidebar.jobs.waiting') return `${count} waiting`
      if (key === 'components.sidebar.jobs.needsYou') return `${count} need you`
      if (key === 'components.sidebar.jobs.failed') return `${count} failed`
      if (key === 'components.sidebar.jobs.background') return `Also running: ${params?.types}`
      if (key === 'jobsArea.types.library-scan.label') return 'Library scan'
      return key
    },
    te: (key: string) => key === 'jobsArea.types.library-scan.label',
  }),
}))

vi.mock('@/features/jobs/composables/useJobsSummary', () => ({ useJobsSummary: () => ({ summary: mocks.jobsSummary }) }))

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
    showBookRequests: boolean
    achievementsEnabled: boolean
    bookDockTotal: number
    outstandingRequestTotal: number
    outstandingRequestLabel: string
    browseCounts: BrowseCounts | null
    storyGuidesBuilding: boolean
  }> = {},
) {
  const permissions = overrides.permissions ?? []
  return {
    hasPermission: (name: string) => permissions.includes(name),
    showBookRequests: overrides.showBookRequests,
    achievementsEnabled: overrides.achievementsEnabled,
    bookDockTotal: overrides.bookDockTotal ?? 0,
    outstandingRequestTotal: overrides.outstandingRequestTotal ?? 0,
    outstandingRequestLabel: overrides.outstandingRequestLabel ?? '',
    browseCounts: overrides.browseCounts ?? null,
    storyGuidesBuilding: overrides.storyGuidesBuilding,
  }
}

function makeRoute(name: string, params: Record<string, string> = {}, query: Record<string, string> = {}): RouteLocationNormalizedLoaded {
  return { name, params, query } as unknown as RouteLocationNormalizedLoaded
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
    mocks.jobsSummary.value = null
  })

  it('shows only ungated destinations to a user with no permissions', () => {
    expect(allowedIds(makeContext())).toEqual([
      'dashboard',
      'statistics',
      'reading-history',
      'achievements',
      'authors',
      'series',
      'genres',
      'annotations',
    ])
  })

  it('places Dashboard, Book Dock, Requests, Tools and Jobs in the primary zone, above the entity sections', () => {
    const primary = SIDEBAR_NAV_REGISTRY.filter((candidate) => candidate.zone === 'primary').map((candidate) => candidate.id)

    expect(primary).toEqual(['dashboard', 'book-dock', 'book-requests', 'tools', 'jobs'])
  })

  it('shows Jobs to anyone holding a permission that sees jobs, whatever the story-guide switches', () => {
    for (const permission of [
      'manage_app_settings',
      'library_generate_read_aloud',
      'library_merge_books',
      'library_edit_metadata',
      'manage_libraries',
    ]) {
      expect(allowedIds(makeContext({ permissions: [permission] }))).toContain('jobs')
      expect(allowedIds(makeContext({ permissions: [permission], storyGuidesBuilding: false }))).toContain('jobs')
    }
  })

  it('shows Jobs to builders only while the server builds story guides', () => {
    const builder = ['library_generate_story_guide']

    expect(allowedIds(makeContext({ permissions: builder }))).not.toContain('jobs')
    expect(allowedIds(makeContext({ permissions: builder, storyGuidesBuilding: true }))).toContain('jobs')
  })

  it('never shows Jobs without a permission that sees jobs, and keeps it lit on every Jobs route', () => {
    expect(allowedIds(makeContext({ storyGuidesBuilding: true }))).not.toContain('jobs')
    expect(entry('jobs').isActive(makeRoute('jobs-activity'))).toBe(true)
    expect(entry('jobs').isActive(makeRoute('jobs-story-guides'))).toBe(true)
    expect(entry('jobs').to).toEqual({ name: 'jobs-activity' })
  })

  it('groups Statistics, History, Achievements and Annotations in the Reading zone', () => {
    const reading = SIDEBAR_NAV_REGISTRY.filter((candidate) => candidate.zone === 'reading').map((candidate) => candidate.id)

    expect(reading).toEqual(['statistics', 'reading-history', 'achievements', 'annotations'])
  })

  it('hides Achievements when the user has turned achievements off', () => {
    expect(allowedIds(makeContext({ achievementsEnabled: false }))).not.toContain('achievements')
    expect(allowedIds(makeContext({ achievementsEnabled: true }))).toContain('achievements')
  })

  it('marks Statistics active on the statistics route and anchors the tour step there', () => {
    expect(entry('statistics').isActive(makeRoute('statistics'))).toBe(true)
    expect(entry('statistics').tourId).toBe('statistics-btn')
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

  it('hides Requests without changing permission when the user turns visibility off', () => {
    const context = makeContext({ permissions: ['book_request_access'], showBookRequests: false })
    expect(allowedIds(context)).not.toContain('book-requests')
    expect(context.hasPermission('book_request_access')).toBe(true)
  })

  it.each(['book-requests', 'book-request-detail', 'book-request-releases'])('keeps Requests active on %s', (routeName) => {
    const resolved = resolveNavEntry(entry('book-requests'), makeContext({ permissions: ['book_request_access'] }), makeRoute(routeName), 'Requests')

    expect(resolved.isActive).toBe(true)
  })

  it.each(['manage_libraries', 'library_delete_books', 'library_merge_books', 'library_edit_metadata'])(
    'shows Tools for the any-of permission %s',
    (permission) => {
      expect(allowedIds(makeContext({ permissions: [permission] }))).toContain('tools')
    },
  )

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

  it('resolves Tools to duplicate books when the user can only merge books', () => {
    const context = makeContext({ permissions: ['library_merge_books', 'library_edit_metadata'] })

    const resolved = resolveNavEntry(entry('tools'), context, makeRoute('dashboard'), 'Tools')

    expect(resolved.to).toEqual({ name: 'tools-duplicate-books' })
  })

  it('resolves Tools to chapter health when the user can only edit metadata', () => {
    const context = makeContext({ permissions: ['library_edit_metadata'] })

    const resolved = resolveNavEntry(entry('tools'), context, makeRoute('dashboard'), 'Tools')

    expect(resolved.to).toEqual({ name: 'tools-chapter-health' })
  })

  it('prefers duplicate books over chapter health when the user can delete books too', () => {
    const context = makeContext({ permissions: ['library_delete_books', 'library_edit_metadata'] })

    const resolved = resolveNavEntry(entry('tools'), context, makeRoute('dashboard'), 'Tools')

    expect(resolved.to).toEqual({ name: 'tools-duplicate-books' })
  })

  it('marks Tools active on any tools- route', () => {
    expect(entry('tools').isActive(makeRoute('tools-bulk-rename'))).toBe(true)
    expect(entry('tools').isActive(makeRoute('tools-chapter-health'))).toBe(true)
    expect(entry('tools').isActive(makeRoute('dashboard'))).toBe(false)
  })

  it('marks Authors active on the author detail route', () => {
    expect(entry('authors').isActive(makeRoute('author-detail', { id: '4' }))).toBe(true)
  })

  it('keeps Genres lit on the genre and tag indexes and pages, which share one row', () => {
    for (const name of ['genres', 'genre-detail', 'tags', 'tag-detail']) {
      expect(entry('genres').isActive(makeRoute(name, { id: '31' }))).toBe(true)
    }
    expect(entry('genres').isActive(makeRoute('series'))).toBe(false)
    expect(entry('genres').zone).toBe('browse')
  })

  it('exposes the Book Dock badge only when items are queued', () => {
    const context = makeContext({ permissions: ['book_dock_access'], bookDockTotal: 3 })

    expect(resolveNavEntry(entry('book-dock'), context, makeRoute('dashboard'), 'Book Dock').badge).toEqual({ value: 3, tone: 'accent' })
    expect(resolveNavEntry(entry('book-dock'), makeContext(), makeRoute('dashboard'), 'Book Dock').badge).toBeNull()
  })

  it('marks only the rows that count work waiting on the user as returning when hidden', () => {
    expect(SIDEBAR_NAV_REGISTRY.filter((candidate) => candidate.returnsWithWork).map((candidate) => candidate.id)).toEqual([
      'book-dock',
      'book-requests',
      'jobs',
    ])
    expect(resolveNavEntry(entry('book-dock'), makeContext(), makeRoute('dashboard'), 'Book Dock').returnsWithWork).toBe(true)
    expect(resolveNavEntry(entry('series'), makeContext(), makeRoute('dashboard'), 'Series').returnsWithWork).toBe(false)
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
      tone: 'accent',
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

    expect(requests?.badge).toEqual({ value: 2, label: expectedLabel, tone: 'accent' })
  })

  it.each([
    ['authors', 1234],
    ['series', 312],
    ['genres', 603],
    ['annotations', 18000],
  ])('badges %s with its browse count', (id, expected) => {
    const context = makeContext({ browseCounts: { authors: 1234, series: 312, genres: 603, annotations: 18000 } })

    expect(resolveNavEntry(entry(id), context, makeRoute('dashboard'), id).badge).toEqual({ value: expected })
  })

  it('leaves the browse rows unbadged before the counts load and while they are zero', () => {
    const zeroed = makeContext({ browseCounts: { authors: 0, series: 0, genres: 0, annotations: 0 } })
    const olderServer = makeContext({ browseCounts: { authors: 4, series: 2, annotations: 1 } })

    expect(resolveNavEntry(entry('genres'), olderServer, makeRoute('dashboard'), 'genres').badge).toBeNull()
    for (const id of ['authors', 'series', 'genres', 'annotations']) {
      expect(resolveNavEntry(entry(id), makeContext(), makeRoute('dashboard'), id).badge).toBeNull()
      expect(resolveNavEntry(entry(id), zeroed, makeRoute('dashboard'), id).badge).toBeNull()
    }
  })

  function jobsEntry() {
    const { zones, jobsAllowed } = useSidebarNav()
    return { jobs: zones.value.flatMap((zone) => zone.entries).find((candidate) => candidate.id === 'jobs'), jobsAllowed: jobsAllowed.value }
  }

  it("lights the Jobs entry from the viewer's own jobs and counts what needs them", () => {
    mocks.permissions.add(Permission.LibraryEditMetadata)
    mocks.jobsSummary.value = { running: 2, waiting: 3, needsYou: 1, failed: 2, background: ['library-scan'] }

    const { jobs, jobsAllowed } = jobsEntry()

    expect(jobsAllowed).toBe(true)
    expect(jobs?.badge).toEqual({ value: 1, label: '1 need you', tone: 'accent' })
    expect(jobs?.returnsWithWork).toBe(true)
    expect(jobs?.signal).toMatchObject({
      activity: 'running',
      failed: true,
      attention: true,
      details: ['2 running', '3 waiting', '1 need you', '2 failed', 'Also running: Library scan'],
    })
    expect(jobs?.signal?.description).toContain('2 running')
  })

  it('holds a still tint while jobs only wait, and names background work without lighting the icon', () => {
    mocks.permissions.add(Permission.ManageAppSettings)
    mocks.jobsSummary.value = { running: 0, waiting: 1, needsYou: 0, failed: 0, background: [] }
    expect(jobsEntry().jobs?.signal).toMatchObject({ activity: 'waiting', failed: false, attention: false })

    mocks.jobsSummary.value = { running: 0, waiting: 0, needsYou: 0, failed: 0, background: ['library-scan'] }
    const { jobs } = jobsEntry()
    expect(jobs?.signal).toMatchObject({ activity: null, failed: false, details: ['Also running: Library scan'] })
    expect(jobs?.badge).toBeNull()
  })

  it('leaves the Jobs entry plain while nothing is going on or the summary has not loaded', () => {
    mocks.permissions.add(Permission.ManageAppSettings)
    expect(jobsEntry().jobs).toMatchObject({ signal: null, badge: null })

    mocks.jobsSummary.value = { running: 0, waiting: 0, needsYou: 0, failed: 0, background: [] }
    expect(jobsEntry().jobs).toMatchObject({ signal: null, badge: null })
  })

  it('follows no jobs for a viewer without the Jobs entry', () => {
    expect(jobsEntry()).toEqual({ jobs: undefined, jobsAllowed: false })
  })

  it('gives every entry a zone and a unique id', () => {
    const ids = SIDEBAR_NAV_REGISTRY.map((candidate) => candidate.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const candidate of SIDEBAR_NAV_REGISTRY) {
      expect(['primary', 'browse', 'reading']).toContain(candidate.zone)
    }
  })
})
