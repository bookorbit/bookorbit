import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookReadingSession, ReadingAttempt } from '@bookorbit/types'
import ReadingLogLedger from '../ReadingLogLedger.vue'

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
    attemptId: 1,
    ...overrides,
  }
}

function makeAttempt(overrides: Partial<ReadingAttempt> = {}): ReadingAttempt {
  return {
    id: 1,
    bookId: 10,
    startedOn: '2026-04-01',
    endedOn: null,
    outcome: null,
    origin: 'bookorbit',
    externalProvider: null,
    externalId: null,
    totalSessions: 1,
    totalSeconds: 1800,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  }
}

function mountLedger(props: Record<string, unknown> = {}) {
  return mount(ReadingLogLedger, {
    props: {
      bookId: 10,
      sessions: [makeSession()],
      total: 1,
      sortBy: 'startedAt',
      sortDir: 'desc' as const,
      loading: false,
      loadingMore: false,
      hasMore: false,
      attempts: [makeAttempt()],
      ...props,
    },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

describe('ReadingLogLedger', () => {
  it('shows the empty state when there are no sessions', () => {
    const wrapper = mountLedger({ sessions: [], total: 0 })
    expect(wrapper.text()).toContain('No sessions recorded yet')
  })

  it('renders one row per session with its duration and change', () => {
    const wrapper = mountLedger({
      sessions: [makeSession({ id: 1, durationSeconds: 3660 }), makeSession({ id: 2, startedAt: '2026-04-15T08:00:00.000Z', progressDelta: -12 })],
      total: 2,
    })
    const text = wrapper.text()
    expect(text).toContain('1h 1m')
    expect(text).toContain('+5.5%')
    expect(text).toContain('-12.0%')
  })

  it('marks a stall of three days or more between two sessions', () => {
    const wrapper = mountLedger({
      sessions: [makeSession({ id: 1, startedAt: '2026-04-15T10:00:00.000Z' }), makeSession({ id: 2, startedAt: '2026-04-09T10:00:00.000Z' })],
      total: 2,
    })
    expect(wrapper.text()).toContain('5 days without reading')
  })

  it('leaves a single day off unmarked', () => {
    const wrapper = mountLedger({
      sessions: [makeSession({ id: 1, startedAt: '2026-04-15T10:00:00.000Z' }), makeSession({ id: 2, startedAt: '2026-04-13T10:00:00.000Z' })],
      total: 2,
    })
    expect(wrapper.text()).not.toContain('without reading')
  })

  it('rules off where the newer of two attempts began', () => {
    const wrapper = mountLedger({
      sessions: [
        makeSession({ id: 1, startedAt: '2026-04-15T10:00:00.000Z', attemptId: 2 }),
        makeSession({ id: 2, startedAt: '2026-04-14T10:00:00.000Z', attemptId: 1 }),
      ],
      total: 2,
      hasMore: true,
      attempts: [makeAttempt({ id: 1 }), makeAttempt({ id: 2, startedOn: '2026-04-15' })],
    })
    expect(wrapper.text()).toContain('Attempt 2 began')
    // hasMore is true, so the start of the oldest attempt is not claimed.
    expect(wrapper.text()).not.toContain('Attempt 1 began')
  })

  it('claims where the oldest attempt began once nothing older is left to load', () => {
    const wrapper = mountLedger({
      sessions: [makeSession({ id: 1, attemptId: 1 })],
      total: 1,
      hasMore: false,
      attempts: [makeAttempt({ id: 1 })],
    })
    expect(wrapper.text()).toContain('Attempt 1 began')
  })

  it('does not rule off sessions that were recorded while no attempt was open', () => {
    const wrapper = mountLedger({
      sessions: [
        makeSession({ id: 1, startedAt: '2026-04-15T10:00:00.000Z', attemptId: null }),
        makeSession({ id: 2, startedAt: '2026-04-14T10:00:00.000Z', attemptId: 1 }),
      ],
      total: 2,
      attempts: [makeAttempt({ id: 1 })],
    })
    expect(wrapper.text()).not.toContain('Outside any attempt')
    // Only the tail rule for the attempt that does exist; the null side is not an event.
    expect(wrapper.findAll('p').filter((row) => row.text().includes('began'))).toHaveLength(1)
  })

  it('drops the gap and attempt rows when the ledger is not in date order', () => {
    const wrapper = mountLedger({
      sortBy: 'durationSeconds',
      sessions: [
        makeSession({ id: 1, startedAt: '2026-04-15T10:00:00.000Z', attemptId: 2 }),
        makeSession({ id: 2, startedAt: '2026-04-01T10:00:00.000Z', attemptId: 1 }),
      ],
      total: 2,
      attempts: [makeAttempt({ id: 1 }), makeAttempt({ id: 2 })],
    })
    const text = wrapper.text()
    expect(text).not.toContain('without reading')
    expect(text).not.toContain('began')
  })

  it('emits a sort change when a sortable column is clicked', async () => {
    const wrapper = mountLedger()
    const lengthHeader = wrapper.find('button[data-sort-column="durationSeconds"]')
    await lengthHeader.trigger('click')
    expect(wrapper.emitted('sortChange')?.[0]).toEqual(['durationSeconds', 'asc'])
  })

  it('requires a second click before deleting a session', async () => {
    const wrapper = mountLedger()
    const deleteButton = wrapper.find('button[data-session-id="1"]')
    await deleteButton.trigger('click')
    expect(wrapper.emitted('deleteSession')).toBeFalsy()

    await wrapper.find('button[data-session-id="1"]').trigger('click')
    expect(wrapper.emitted('deleteSession')?.[0]).toEqual([1])
  })

  it('offers load more only while more rows exist', async () => {
    const wrapper = mountLedger({ hasMore: true, total: 40 })
    const loadMore = wrapper.findAll('button').find((button) => button.text() === 'Load more')
    expect(loadMore).toBeDefined()
    await loadMore!.trigger('click')
    expect(wrapper.emitted('loadMore')).toBeTruthy()

    const settled = mountLedger({ hasMore: false })
    expect(settled.findAll('button').some((button) => button.text() === 'Load more')).toBe(false)
  })
})
