import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

vi.mock('vue-echarts', () => ({
  default: { name: 'VChart', template: '<div />' },
}))

import ReadingLogTab from '../ReadingLogTab.vue'

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
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    communityRatings: [],
    coverSource: null,
    hardcoverEditionId: null,
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

function makeListResponse(items = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      items,
      total: items.length,
      page: 1,
      pageSize: 25,
      stats: {
        totalSessions: items.length,
        totalSeconds: 0,
        avgDurationSeconds: 0,
        firstSessionAt: null,
        lastSessionAt: null,
        dailySummary: [],
        paceProgressDelta: 0,
        paceDurationSeconds: 0,
        progressSummary: [],
      },
    }),
  } as Response
}

describe('ReadingLogTab', () => {
  beforeEach(() => {
    mocks.api.mockReset()
    mocks.api.mockResolvedValue(makeListResponse())
  })

  it('renders quick filter buttons', async () => {
    const wrapper = mount(ReadingLogTab, { props: { book: makeBook() }, global: { plugins: [createPinia()] } })
    await flushPromises()

    expect(wrapper.text()).toContain('All time')
    expect(wrapper.text()).toContain('Last 30 days')
    expect(wrapper.text()).toContain('Last 90 days')
    expect(wrapper.text()).toContain('This year')
  })

  it('renders the hero and chart empty states when there is no data', async () => {
    const wrapper = mount(ReadingLogTab, { props: { book: makeBook() }, global: { plugins: [createPinia()] } })
    await flushPromises()

    expect(wrapper.text()).toContain('Add session')
    expect(wrapper.text()).toContain('No progress data in this window.')
    expect(wrapper.text()).toContain('No reading activity in this window.')
  })

  it('calls setFilters with dateFrom when "Last 30 days" is clicked', async () => {
    const wrapper = mount(ReadingLogTab, { props: { book: makeBook() }, global: { plugins: [createPinia()] } })
    await flushPromises()

    mocks.api.mockClear()
    mocks.api.mockResolvedValue(makeListResponse())

    const buttons = wrapper.findAll('button')
    const last30Btn = buttons.find((b) => b.text() === 'Last 30 days')
    expect(last30Btn).toBeDefined()
    await last30Btn!.trigger('click')
    await flushPromises()

    const calls = mocks.api.mock.calls
    const lastCall = calls[calls.length - 1]?.[0] as string
    expect(lastCall).toContain('dateFrom=')
  })

  it('calls API without dateFrom when "All time" is clicked', async () => {
    const wrapper = mount(ReadingLogTab, { props: { book: makeBook() }, global: { plugins: [createPinia()] } })
    await flushPromises()

    mocks.api.mockClear()
    mocks.api.mockResolvedValue(makeListResponse())

    const buttons = wrapper.findAll('button')
    const allTimeBtn = buttons.find((b) => b.text() === 'All time')
    await allTimeBtn!.trigger('click')
    await flushPromises()

    const calls = mocks.api.mock.calls
    const lastCall = calls[calls.length - 1]?.[0] as string
    expect(lastCall).not.toContain('dateFrom=')
  })

  it('calls API with dateFrom when "This year" is clicked', async () => {
    const wrapper = mount(ReadingLogTab, { props: { book: makeBook() }, global: { plugins: [createPinia()] } })
    await flushPromises()

    mocks.api.mockClear()
    mocks.api.mockResolvedValue(makeListResponse())

    const buttons = wrapper.findAll('button')
    const thisYearBtn = buttons.find((b) => b.text() === 'This year')
    await thisYearBtn!.trigger('click')
    await flushPromises()

    const calls = mocks.api.mock.calls
    const lastCall = calls[calls.length - 1]?.[0] as string
    expect(lastCall).toContain('dateFrom=')
  })

  it('calls API with dateFrom when "Last 90 days" is clicked', async () => {
    const wrapper = mount(ReadingLogTab, { props: { book: makeBook() }, global: { plugins: [createPinia()] } })
    await flushPromises()

    mocks.api.mockClear()
    mocks.api.mockResolvedValue(makeListResponse())

    const buttons = wrapper.findAll('button')
    const last90Btn = buttons.find((b) => b.text() === 'Last 90 days')
    await last90Btn!.trigger('click')
    await flushPromises()

    const calls = mocks.api.mock.calls
    const lastCall = calls[calls.length - 1]?.[0] as string
    expect(lastCall).toContain('dateFrom=')
  })

  it('does not show format select when book has one or fewer formats', async () => {
    const bookWithOneFile = makeBook({
      files: [{ id: 1, format: 'epub', bookId: 10, filePath: '/test.epub', fileName: 'test.epub', fileSize: 1000, lastModified: null }],
    })
    const wrapper = mount(ReadingLogTab, { props: { book: bookWithOneFile }, global: { plugins: [createPinia()] } })
    await flushPromises()

    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('shows format select when book has multiple formats', async () => {
    const bookWithMultipleFiles = makeBook({
      files: [
        { id: 1, format: 'epub', bookId: 10, filePath: '/test.epub', fileName: 'test.epub', fileSize: 1000, lastModified: null },
        { id: 2, format: 'pdf', bookId: 10, filePath: '/test.pdf', fileName: 'test.pdf', fileSize: 2000, lastModified: null },
      ],
    })
    const wrapper = mount(ReadingLogTab, { props: { book: bookWithMultipleFiles }, global: { plugins: [createPinia()] } })
    await flushPromises()

    expect(wrapper.find('select').exists()).toBe(true)
  })

  it('active quick filter button has primary styling', async () => {
    const wrapper = mount(ReadingLogTab, { props: { book: makeBook() }, global: { plugins: [createPinia()] } })
    await flushPromises()

    const allTimeBtn = wrapper.findAll('button').find((b) => b.text() === 'All time')
    expect(allTimeBtn?.classes()).toContain('bg-primary')
  })

  it('inactive quick filter buttons do not have primary styling', async () => {
    const wrapper = mount(ReadingLogTab, { props: { book: makeBook() }, global: { plugins: [createPinia()] } })
    await flushPromises()

    const last30Btn = wrapper.findAll('button').find((b) => b.text() === 'Last 30 days')
    expect(last30Btn?.classes()).not.toContain('bg-primary')
  })
})
