import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPinia } from 'pinia'
import { RouterLinkStub } from '@vue/test-utils'
import type { BookReadingSession, BookReadingSessionStats, ReadingAttempt } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  hasPermission: vi.fn<(...args: unknown[]) => boolean>(),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission }),
}))

vi.mock('vue-echarts', () => ({
  default: { name: 'VChart', template: '<div />' },
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: { template: '<div><slot /></div>' },
  DropdownMenuContent: { template: '<div><slot /></div>' },
  DropdownMenuItem: { template: '<button type="button"><slot /></button>' },
  DropdownMenuTrigger: { template: '<div><slot /></div>' },
}))

import ReadingLogTab from '../ReadingLogTab.vue'
import ResetReadingStateDialog from '@/features/book/components/ResetReadingStateDialog.vue'

function makeBook(overrides = {}) {
  return {
    id: 10,
    libraryId: 1,
    libraryName: 'My Library',
    status: 'ok',
    folderPath: '/books',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    title: 'Test Book',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedDate: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    personalNote: null,
    personalNoteUpdatedAt: null,
    communityRatings: [],
    coverSource: null,
    hardcoverEditionId: null,
    mangabakaSeriesId: null,
    providerIds: {},
    authors: [],
    genres: [],
    tags: [],
    files: [],
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    customMetadata: [],
    lockedFields: [],
    collections: [],
    ...overrides,
  }
}

function makeSession(overrides: Partial<BookReadingSession> = {}): BookReadingSession {
  return {
    id: 1,
    bookFileId: 17,
    startedAt: '2026-04-15T10:00:00.000Z',
    endedAt: '2026-04-15T10:30:00.000Z',
    durationSeconds: 1800,
    progressDelta: 5.5,
    endProgress: 42,
    format: 'epub',
    source: 'web',
    attemptId: null,
    ...overrides,
  }
}

function makeStats(items: BookReadingSession[]): BookReadingSessionStats {
  return {
    totalSessions: items.length,
    totalSeconds: 0,
    avgDurationSeconds: 0,
    firstSessionAt: null,
    lastSessionAt: null,
    dailySummary: [],
    paceProgressDelta: 0,
    paceDurationSeconds: 0,
    progressSummary: [],
    latestEndProgress: null,
    bySource: [],
    longestSessionSeconds: 0,
    longestSessionAt: null,
    backtrackCount: 0,
  }
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

/** Routes each request the tab makes on mount: sessions, attempts and the two progress reads. */
function routeApi(options: { sessions?: BookReadingSession[]; attempts?: ReadingAttempt[] } = {}) {
  const sessions = options.sessions ?? []
  const attempts = options.attempts ?? []
  return (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/reading-attempts')) return Promise.resolve(jsonResponse({ items: attempts, page: 1, pageSize: 50, total: attempts.length }))
    if (url.includes('/sessions')) {
      return Promise.resolve(jsonResponse({ items: sessions, total: sessions.length, page: 1, pageSize: 25, stats: makeStats(sessions) }))
    }
    if (url.includes('/progress')) return Promise.resolve(jsonResponse([]))
    return Promise.resolve(jsonResponse({}))
  }
}

function mountTab(book = makeBook()) {
  return mount(ReadingLogTab, {
    props: { book },
    global: { plugins: [createPinia()], stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('ReadingLogTab', () => {
  beforeEach(() => {
    mocks.api.mockReset()
    mocks.api.mockImplementation(routeApi())
    mocks.hasPermission.mockReset()
    mocks.hasPermission.mockReturnValue(true)
    localStorage.clear()
  })

  it('shows one explanation instead of four empty panels when nothing is logged', async () => {
    const wrapper = mountTab()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Nothing logged for this book yet')
    expect(text).toContain('Sync KOReader')
    expect(text).not.toContain('No sessions recorded yet')
  })

  it('renders the ledger, attempts and band once the book has sessions', async () => {
    mocks.api.mockImplementation(routeApi({ sessions: [makeSession()] }))
    const wrapper = mountTab()
    await flushPromises()

    const text = wrapper.text()
    expect(text).not.toContain('Nothing logged for this book yet')
    expect(text).toContain('Sessions')
    expect(text).toContain('Attempts')
    expect(text).toContain('Progress over time')
  })

  it('renders the quick filter buttons', async () => {
    mocks.api.mockImplementation(routeApi({ sessions: [makeSession()] }))
    const wrapper = mountTab()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('All time')
    expect(text).toContain('Last 30 days')
    expect(text).toContain('Last 90 days')
    expect(text).toContain('This year')
  })

  it('narrows the session request when a quick filter is chosen', async () => {
    mocks.api.mockImplementation(routeApi({ sessions: [makeSession()] }))
    const wrapper = mountTab()
    await flushPromises()

    mocks.api.mockClear()
    const last30 = wrapper.findAll('button').find((button) => button.text() === 'Last 30 days')
    await last30!.trigger('click')
    await flushPromises()

    const lastCall = mocks.api.mock.calls[mocks.api.mock.calls.length - 1]?.[0] as string
    expect(lastCall).toContain('dateFrom=')
  })

  it('drops the date filter again on all time', async () => {
    mocks.api.mockImplementation(routeApi({ sessions: [makeSession()] }))
    const wrapper = mountTab()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Last 90 days')!
      .trigger('click')
    await flushPromises()
    mocks.api.mockClear()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'All time')!
      .trigger('click')
    await flushPromises()

    const lastCall = mocks.api.mock.calls[mocks.api.mock.calls.length - 1]?.[0] as string
    expect(lastCall).not.toContain('dateFrom=')
  })

  it('offers a format filter only when the book has more than one format', async () => {
    mocks.api.mockImplementation(routeApi({ sessions: [makeSession()] }))
    const single = mountTab(
      makeBook({ files: [{ id: 1, format: 'epub', bookId: 10, filePath: '/a.epub', fileName: 'a.epub', fileSize: 1, lastModified: null }] }),
    )
    await flushPromises()
    expect(single.find('select').exists()).toBe(false)

    const multiple = mountTab(
      makeBook({
        files: [
          { id: 1, format: 'epub', bookId: 10, filePath: '/a.epub', fileName: 'a.epub', fileSize: 1, lastModified: null },
          { id: 2, format: 'pdf', bookId: 10, filePath: '/a.pdf', fileName: 'a.pdf', fileSize: 1, lastModified: null },
        ],
      }),
    )
    await flushPromises()
    expect(multiple.find('select').exists()).toBe(true)
  })

  it('reloads the log and the attempts after a reading state reset', async () => {
    mocks.api.mockImplementation(routeApi({ sessions: [makeSession()] }))
    const wrapper = mountTab()
    await flushPromises()

    const resetButton = wrapper.findAll('button').find((button) => button.text() === 'Reset reading state')
    expect(resetButton).toBeDefined()
    await resetButton!.trigger('click')

    const dialog = wrapper.findComponent(ResetReadingStateDialog)
    expect(dialog.props('open')).toBe(true)

    const readStatus = {
      status: 'unread',
      source: 'manual',
      startedAt: null,
      finishedAt: null,
      updatedAt: '2026-07-09T12:00:00.000Z',
    }
    mocks.api.mockReset()
    mocks.api.mockImplementation((input) => {
      const url = String(input)
      if (url.includes('reset-reading-state')) return Promise.resolve(jsonResponse({ readStatus }))
      return routeApi({ sessions: [makeSession()] })(input)
    })

    dialog.vm.$emit('confirm')
    await flushPromises()

    const urls = mocks.api.mock.calls.map((call) => String(call[0]))
    expect(urls[0]).toBe('/api/v1/books/10/reset-reading-state')
    expect(urls.some((url) => url.includes('/api/v1/books/10/sessions?'))).toBe(true)
    expect(urls.some((url) => url.includes('/api/v1/books/10/reading-attempts'))).toBe(true)
    expect(wrapper.emitted('saved')?.[0]).toEqual([expect.objectContaining({ readStatus })])
  })

  it('hides the reset action without the metadata-edit permission', async () => {
    mocks.hasPermission.mockReturnValue(false)
    mocks.api.mockImplementation(routeApi({ sessions: [makeSession()] }))
    const wrapper = mountTab()
    await flushPromises()

    expect(wrapper.findAll('button').some((button) => button.text() === 'Reset reading state')).toBe(false)
  })
})
