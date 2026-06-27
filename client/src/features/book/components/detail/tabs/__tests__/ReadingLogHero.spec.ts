import { flushPromises, mount } from '@vue/test-utils'
import type { Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDetail, BookReadingSessionStats, UserBookStatus } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  setStatus: vi.fn<(bookId: number, status: string) => Promise<UserBookStatus>>(),
  updateStatus: vi.fn<(bookId: number, patch: Record<string, string | null>) => Promise<UserBookStatus>>(),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

vi.mock('@/features/book/composables/useBookStatus', () => {
  const MockIcon = { template: '<span />' }
  return {
    STATUS_COLORS: {
      unread: '',
      want_to_read: '',
      reading: '',
      on_hold: '',
      rereading: '',
      read: '',
      skimmed: '',
      abandoned: '',
    },
    STATUS_ICONS: {
      unread: MockIcon,
      want_to_read: MockIcon,
      reading: MockIcon,
      on_hold: MockIcon,
      rereading: MockIcon,
      read: MockIcon,
      skimmed: MockIcon,
      abandoned: MockIcon,
    },
    STATUS_OPTIONS: [
      { value: 'reading', label: 'Reading' },
      { value: 'read', label: 'Read' },
    ],
    useBookStatus: () => ({
      setStatus: mocks.setStatus,
      updateStatus: mocks.updateStatus,
    }),
  }
})

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: { template: '<div><slot /></div>' },
  DropdownMenuContent: { template: '<div><slot /></div>' },
  DropdownMenuItem: { template: '<button type="button"><slot /></button>' },
  DropdownMenuTrigger: { template: '<div><slot /></div>' },
}))

vi.mock('@/features/achievements/components/AchievementProgressRing.vue', () => ({
  default: { template: '<div />' },
}))

import ReadingLogHero from '../ReadingLogHero.vue'

function makeReadStatus(overrides: Partial<UserBookStatus> = {}): UserBookStatus {
  return {
    status: 'reading',
    source: 'manual',
    startedAt: '2026-04-01',
    finishedAt: '2026-04-20',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  }
}

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
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
    coverSource: null,
    providerIds: {},
    authors: [],
    genres: [],
    tags: [],
    files: [],
    lastWrittenAt: null,
    metadataScore: null,
    hardcoverEditionId: null,
    communityRatings: [],
    readStatus: makeReadStatus(),
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    customMetadata: [],
    lockedFields: [],
    collections: [],
    ...overrides,
  }
}

function makeStats(overrides: Partial<BookReadingSessionStats> = {}): BookReadingSessionStats {
  return {
    totalSessions: 1,
    totalSeconds: 1800,
    avgDurationSeconds: 1800,
    firstSessionAt: '2026-04-15T10:00:00.000Z',
    lastSessionAt: '2026-04-16T10:00:00.000Z',
    dailySummary: [],
    paceProgressDelta: 0,
    paceDurationSeconds: 0,
    progressSummary: [],
    bySource: [],
    ...overrides,
  }
}

function mountHero(book = makeBook(), stats = makeStats()) {
  return mount(ReadingLogHero as Component, {
    props: { book, stats, loading: false },
  })
}

function makeResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response
}

describe('ReadingLogHero', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-24T12:00:00.000Z'))
    mocks.api.mockReset()
    mocks.api.mockResolvedValue(makeResponse([]))
    mocks.setStatus.mockReset()
    mocks.updateStatus.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders session dates separately from editable lifecycle dates', async () => {
    const wrapper = mountHero()
    await flushPromises()

    expect(wrapper.text()).toContain('First Read')
    expect(wrapper.text()).toContain('Last Read')
    expect(wrapper.text()).toContain('Date Started')
    expect(wrapper.text()).toContain('Apr 1, 2026')
    expect(wrapper.text()).toContain('Date Finished')
    expect(wrapper.text()).toContain('Apr 20, 2026')
  })

  it('keeps lifecycle date editing wired to the read status API', async () => {
    const updated = makeReadStatus({ startedAt: '2026-04-02' })
    mocks.updateStatus.mockResolvedValue(updated)
    const wrapper = mountHero()
    await flushPromises()

    const startButton = wrapper.findAll('button').find((button) => button.text() === 'Apr 1, 2026')
    expect(startButton).toBeDefined()
    await startButton!.trigger('click')

    const input = wrapper.find('input[type="date"]')
    await input.setValue('2026-04-02')
    await input.trigger('blur')
    await flushPromises()

    expect(mocks.updateStatus).toHaveBeenCalledWith(10, { startedAt: '2026-04-02' })
    expect(wrapper.emitted('saved')?.[0]).toEqual([updated])
  })

  it('validates lifecycle dates before saving', async () => {
    const wrapper = mountHero()
    await flushPromises()

    const finishButton = wrapper.findAll('button').find((button) => button.text() === 'Apr 20, 2026')
    expect(finishButton).toBeDefined()
    await finishButton!.trigger('click')

    const input = wrapper.find('input[type="date"]')
    await input.setValue('2026-07-01')
    await input.trigger('blur')
    await flushPromises()

    expect(wrapper.text()).toContain('Finish date cannot be in the future.')
    expect(mocks.updateStatus).not.toHaveBeenCalled()
  })

  it('rejects invalid lifecycle date order and failed date saves', async () => {
    const invalidWrapper = mountHero()
    await flushPromises()

    const invalidFinishButton = invalidWrapper.findAll('button').find((button) => button.text() === 'Apr 20, 2026')
    await invalidFinishButton!.trigger('click')
    await invalidWrapper.find('input[type="date"]').setValue('2026-03-31')
    await invalidWrapper.find('input[type="date"]').trigger('blur')
    await flushPromises()

    expect(invalidWrapper.text()).toContain('Finish date must be on or after the start date.')

    mocks.updateStatus.mockRejectedValue(new Error('save failed'))
    const failedWrapper = mountHero()
    await flushPromises()

    const startButton = failedWrapper.findAll('button').find((button) => button.text() === 'Apr 1, 2026')
    await startButton!.trigger('click')
    await failedWrapper.find('input[type="date"]').setValue('2026-04-02')
    await failedWrapper.find('input[type="date"]').trigger('blur')
    await flushPromises()

    expect(failedWrapper.text()).toContain('Failed to save reading dates.')
  })

  it('closes lifecycle date editing when unchanged or canceled', async () => {
    const wrapper = mountHero()
    await flushPromises()

    const startButton = wrapper.findAll('button').find((button) => button.text() === 'Apr 1, 2026')
    await startButton!.trigger('click')
    await wrapper.find('input[type="date"]').trigger('blur')
    await flushPromises()

    expect(mocks.updateStatus).not.toHaveBeenCalled()
    expect(wrapper.find('input[type="date"]').exists()).toBe(false)

    await startButton!.trigger('click')
    await wrapper.find('input[type="date"]').setValue('2026-04-03')
    await wrapper.find('input[type="date"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(mocks.updateStatus).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Apr 1, 2026')

    const finishButton = wrapper.findAll('button').find((button) => button.text() === 'Apr 20, 2026')
    await finishButton!.trigger('click')
    await wrapper.find('input[type="date"]').setValue('2026-04-21')
    await wrapper.find('input[type="date"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(mocks.updateStatus).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Apr 20, 2026')
  })

  it('updates status through the status menu', async () => {
    const updated = makeReadStatus({ status: 'read' })
    mocks.setStatus.mockResolvedValue(updated)
    const wrapper = mountHero()
    await flushPromises()

    const readButton = wrapper.findAll('button').find((button) => button.text() === 'Read')
    expect(readButton).toBeDefined()
    await readButton!.trigger('click')
    await flushPromises()

    expect(mocks.setStatus).toHaveBeenCalledWith(10, 'read')
    expect(wrapper.emitted('saved')?.[0]).toEqual([updated])
  })

  it('reverts local status when the status update fails', async () => {
    mocks.setStatus.mockRejectedValue(new Error('network failed'))
    const wrapper = mountHero()
    await flushPromises()

    const readButton = wrapper.findAll('button').find((button) => button.text() === 'Read')
    await readButton!.trigger('click')
    await flushPromises()

    expect(mocks.setStatus).toHaveBeenCalledWith(10, 'read')
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.text()).toContain('Reading')
  })

  it('loads progress from ebook and audiobook progress endpoints', async () => {
    mocks.api.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('audio-progress')) return makeResponse({ percentage: 99.6 })
      return makeResponse([{ fileId: 1, percentage: 0.5 }])
    })
    const wrapper = mountHero(
      makeBook({
        files: [
          {
            id: 1,
            format: 'mp3',
            role: 'primary',
            sizeBytes: null,
            absolutePath: '/books/audio.mp3',
            createdAt: '2026-01-01T00:00:00.000Z',
            filename: 'audio.mp3',
            durationSeconds: null,
          },
        ],
      }),
    )
    await flushPromises()

    expect(wrapper.text()).toContain('>99%')
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/10/audio-progress')
  })

  it('ignores non-ok and malformed progress responses', async () => {
    mocks.api.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('audio-progress')) return makeResponse({ percentage: Number.NaN })
      return { ok: false, json: async () => [] } as Response
    })
    const wrapper = mountHero(
      makeBook({
        files: [
          {
            id: 1,
            format: 'm4b',
            role: 'primary',
            sizeBytes: null,
            absolutePath: '/books/audio.m4b',
            createdAt: '2026-01-01T00:00:00.000Z',
            filename: 'audio.m4b',
            durationSeconds: null,
          },
        ],
      }),
    )
    await flushPromises()

    expect(wrapper.text()).toContain('0%')
  })

  it('renders eta and emits add-session actions', async () => {
    mocks.api.mockResolvedValue(makeResponse([{ fileId: 1, percentage: 50 }]))
    const wrapper = mountHero(makeBook(), makeStats({ paceProgressDelta: 50, paceDurationSeconds: 3600 }))
    await flushPromises()

    expect(wrapper.text()).toContain('~1h to finish')
    const addButton = wrapper.findAll('button').find((button) => button.text() === 'Add session')
    await addButton!.trigger('click')

    expect(wrapper.emitted('addSession')).toHaveLength(1)
  })

  it('renders mixed hour and minute eta labels', async () => {
    mocks.api.mockResolvedValue(makeResponse([{ fileId: 1, percentage: 10 }]))
    const wrapper = mountHero(makeBook(), makeStats({ paceProgressDelta: 20, paceDurationSeconds: 3600 }))
    await flushPromises()

    expect(wrapper.text()).toContain('~4h 30m to finish')
  })

  it('renders minute-only, whole-hour, and capped eta labels', async () => {
    mocks.api.mockResolvedValue(makeResponse([{ fileId: 1, percentage: 99 }]))
    const minuteWrapper = mountHero(makeBook(), makeStats({ paceProgressDelta: 50, paceDurationSeconds: 3600 }))
    await flushPromises()
    expect(minuteWrapper.text()).toContain('~5m to finish')

    mocks.api.mockResolvedValue(makeResponse([{ fileId: 1, percentage: 50 }]))
    const hourWrapper = mountHero(makeBook(), makeStats({ paceProgressDelta: 25, paceDurationSeconds: 3600 }))
    await flushPromises()
    expect(hourWrapper.text()).toContain('~2h to finish')

    mocks.api.mockResolvedValue(makeResponse([{ fileId: 1, percentage: 1 }]))
    const cappedWrapper = mountHero(makeBook(), makeStats({ paceProgressDelta: 0.1, paceDurationSeconds: 3600 }))
    await flushPromises()
    expect(cappedWrapper.text()).toContain('99h+ to finish')
  })

  it('hides eta for terminal statuses and invalid pace inputs', async () => {
    mocks.api.mockResolvedValue(makeResponse([{ fileId: 1, percentage: 50 }]))
    const readWrapper = mountHero(
      makeBook({ readStatus: makeReadStatus({ status: 'read' }) }),
      makeStats({ paceProgressDelta: 50, paceDurationSeconds: 3600 }),
    )
    await flushPromises()
    expect(readWrapper.text()).not.toContain('to finish')

    const noPaceWrapper = mountHero(makeBook(), makeStats({ paceProgressDelta: 0, paceDurationSeconds: 3600 }))
    await flushPromises()
    expect(noPaceWrapper.text()).not.toContain('to finish')
  })

  it('falls back to zero progress when progress loading fails', async () => {
    mocks.api.mockRejectedValue(new Error('progress failed'))
    const wrapper = mountHero()
    await flushPromises()

    expect(wrapper.text()).toContain('0%')
  })

  it('falls back to zero progress when progress parsing fails', async () => {
    mocks.api.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('bad json')
      },
    } as unknown as Response)
    const wrapper = mountHero()
    await flushPromises()

    expect(wrapper.text()).toContain('0%')
  })

  it('renders momentum titles for upward, downward, and unchanged trends', async () => {
    const newActivity = mountHero(
      makeBook(),
      makeStats({
        dailySummary: [{ day: '2026-06-24', totalMinutes: 20 }],
      }),
    )
    await flushPromises()
    expect(newActivity.find('[title="New activity this week"]').exists()).toBe(true)

    const upward = mountHero(
      makeBook(),
      makeStats({
        dailySummary: [
          { day: '2026-06-24', totalMinutes: 20 },
          { day: '2026-06-17', totalMinutes: 10 },
        ],
      }),
    )
    await flushPromises()
    expect(upward.find('[title="+100% vs previous 7 days"]').exists()).toBe(true)

    const downward = mountHero(
      makeBook(),
      makeStats({
        dailySummary: [
          { day: '2026-06-24', totalMinutes: 10 },
          { day: '2026-06-17', totalMinutes: 20 },
        ],
      }),
    )
    await flushPromises()
    expect(downward.find('[title="-50% vs previous 7 days"]').exists()).toBe(true)

    const unchanged = mountHero(
      makeBook(),
      makeStats({
        dailySummary: [
          { day: '2026-06-24', totalMinutes: 10 },
          { day: '2026-06-17', totalMinutes: 10 },
        ],
      }),
    )
    await flushPromises()
    expect(unchanged.find('[title="Unchanged vs previous 7 days"]').exists()).toBe(true)
  })

  it('renders empty and loading states without session dates', async () => {
    const emptyWrapper = mountHero(makeBook({ readStatus: null }), makeStats({ firstSessionAt: null, lastSessionAt: null }))
    await flushPromises()

    expect(emptyWrapper.text()).toContain('No sessions')
    expect(emptyWrapper.text()).toContain('Not set')

    const loadingWrapper = mount(ReadingLogHero as Component, {
      props: { book: makeBook(), stats: null, loading: true },
    })
    await flushPromises()

    expect(loadingWrapper.text()).toContain('Add session')
  })

  it('normalizes invalid lifecycle dates to empty display values', async () => {
    const wrapper = mountHero(
      makeBook({
        readStatus: makeReadStatus({ startedAt: 'not-a-date', finishedAt: 'also-not-a-date' }),
      }),
      makeStats({ lastSessionAt: '2024-04-15T10:00:00.000Z' }),
    )
    await flushPromises()

    expect(wrapper.text()).toContain('Not set')
    expect(wrapper.text()).toContain('2 years ago')
  })
})
