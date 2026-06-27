import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReadingLogTable from '../ReadingLogTable.vue'

function makeSession(overrides = {}) {
  return {
    id: 1,
    startedAt: '2026-04-15T10:00:00.000Z',
    endedAt: '2026-04-15T10:30:00.000Z',
    durationSeconds: 1800,
    progressDelta: 5.5,
    endProgress: 42.0,
    format: 'epub',
    source: null,
    ...overrides,
  }
}

function mountTable(props = {}) {
  return mount(ReadingLogTable, {
    props: {
      sessions: [makeSession()],
      total: 1,
      sortBy: 'startedAt',
      sortDir: 'desc' as const,
      loading: false,
      loadingMore: false,
      hasMore: false,
      hasMultipleFormats: false,
      ...props,
    },
  })
}

describe('ReadingLogTable', () => {
  it('renders rows from sessions prop', () => {
    const wrapper = mountTable()
    expect(wrapper.find('tbody').findAll('tr').length).toBeGreaterThan(0)
  })

  it('shows empty state when sessions is empty and not loading', () => {
    const wrapper = mountTable({ sessions: [], total: 0 })
    expect(wrapper.text()).toContain('No reading sessions recorded yet')
  })

  it('first delete click enters confirm state', async () => {
    const wrapper = mountTable()
    const deleteBtn = wrapper.find('button[title="Delete"]')
    await deleteBtn.trigger('click')

    const confirmBtn = wrapper.find('button[title="Click again to confirm delete"]')
    expect(confirmBtn.exists()).toBe(true)
    expect(confirmBtn.text()).toContain('Confirm')
    expect(wrapper.find('button[title="Cancel delete"]').exists()).toBe(true)
  })

  it('second delete click emits deleteSession event', async () => {
    const wrapper = mountTable()
    const deleteBtn = wrapper.find('button[title="Delete"]')
    await deleteBtn.trigger('click')

    const confirmBtn = wrapper.find('button[title="Click again to confirm delete"]')
    await confirmBtn.trigger('click')

    expect(wrapper.emitted('deleteSession')).toBeTruthy()
    expect(wrapper.emitted('deleteSession')?.[0]).toEqual([1])
  })

  it('formats duration in h/m/s', () => {
    const wrapper = mountTable({ sessions: [makeSession({ durationSeconds: 3661 })] })
    expect(wrapper.text()).toContain('1h 1m 1s')
  })

  it('formats minutes-only duration correctly', () => {
    const wrapper = mountTable({ sessions: [makeSession({ durationSeconds: 125 })] })
    expect(wrapper.text()).toContain('2m 5s')
  })

  it('formats seconds-only duration correctly', () => {
    const wrapper = mountTable({ sessions: [makeSession({ durationSeconds: 45 })] })
    expect(wrapper.text()).toContain('45s')
  })

  it('shows progress delta with + prefix', () => {
    const wrapper = mountTable({ sessions: [makeSession({ progressDelta: 5.5 })] })
    expect(wrapper.text()).toContain('+5.5%')
  })

  it('shows negative progress delta without a + prefix', () => {
    const wrapper = mountTable({ sessions: [makeSession({ progressDelta: -6 })] })
    expect(wrapper.text()).toContain('-6.0%')
    expect(wrapper.text()).not.toContain('+-6.0%')
  })

  it('shows "-" for null progressDelta', () => {
    const wrapper = mountTable({ sessions: [makeSession({ progressDelta: null })] })
    expect(wrapper.find('tbody').text()).toContain('-')
  })

  it('shows endProgress with % suffix', () => {
    const wrapper = mountTable({ sessions: [makeSession({ endProgress: 42.0 })] })
    expect(wrapper.text()).toContain('42.0%')
  })

  it('shows "-" for null endProgress', () => {
    const wrapper = mountTable({ sessions: [makeSession({ endProgress: null })] })
    expect(wrapper.find('tbody').text()).toContain('-')
  })

  it('shows pace per hour derived from delta and duration', () => {
    const wrapper = mountTable({ sessions: [makeSession({ progressDelta: 5, durationSeconds: 1800 })] })
    expect(wrapper.text()).toContain('10.0%/hr')
  })

  it('shows "-" pace when progressDelta is null', () => {
    const wrapper = mountTable({ sessions: [makeSession({ progressDelta: null })] })
    const paceCells = wrapper.findAll('td.hidden')
    expect(paceCells.some((cell) => cell.text() === '-')).toBe(true)
  })

  it('shows "-" pace when progressDelta is negative', () => {
    const wrapper = mountTable({ sessions: [makeSession({ progressDelta: -70.2, durationSeconds: 26 })] })
    const paceCells = wrapper.findAll('td.hidden')
    expect(paceCells.some((cell) => cell.text() === '-')).toBe(true)
    expect(wrapper.text()).not.toContain('-9715.3%/hr')
  })

  it('groups sessions under day headers with subtotals when sorted by date', () => {
    // Local-time constructors keep the grouping assertions timezone-agnostic.
    const day1Morning = new Date(2026, 3, 15, 10, 0).toISOString()
    const day1Evening = new Date(2026, 3, 15, 20, 0).toISOString()
    const day2Morning = new Date(2026, 3, 14, 9, 0).toISOString()
    const wrapper = mountTable({
      sessions: [
        makeSession({ id: 1, startedAt: day1Morning, durationSeconds: 1800, progressDelta: 3 }),
        makeSession({ id: 2, startedAt: day1Evening, durationSeconds: 1800, progressDelta: 2 }),
        makeSession({ id: 3, startedAt: day2Morning, durationSeconds: 600, progressDelta: null }),
      ],
      total: 3,
    })

    const headerRows = wrapper.findAll('tbody tr.bg-muted\\/40')
    expect(headerRows.length).toBe(2)
    expect(headerRows[0]!.text()).toContain('1h 0m')
    expect(headerRows[0]!.text()).toContain('+5.0%')
    expect(headerRows[1]!.text()).toContain('10m')
    expect(headerRows[1]!.text()).not.toContain('%')
  })

  it('renders flat rows without day headers when sorted by another column', () => {
    const wrapper = mountTable({
      sessions: [
        makeSession({ id: 1, startedAt: new Date(2026, 3, 15, 10, 0).toISOString() }),
        makeSession({ id: 2, startedAt: new Date(2026, 3, 14, 9, 0).toISOString() }),
      ],
      total: 2,
      sortBy: 'durationSeconds',
    })

    expect(wrapper.findAll('tbody tr.bg-muted\\/40').length).toBe(0)
    expect(wrapper.find('tbody').findAll('tr').length).toBe(2)
  })

  it('shows source pills when sessions carry a source', () => {
    const wrapper = mountTable({
      sessions: [makeSession({ id: 1, source: 'koreader' }), makeSession({ id: 2, source: 'manual' })],
      total: 2,
    })

    expect(wrapper.text()).toContain('KOReader')
    expect(wrapper.text()).toContain('Manual')
    const headers = wrapper.findAll('th')
    expect(headers.some((h) => h.text() === 'Source')).toBe(true)
  })

  it('hides the source column when no session has a source', () => {
    const wrapper = mountTable({ sessions: [makeSession({ source: null })] })
    const headers = wrapper.findAll('th')
    expect(headers.some((h) => h.text() === 'Source')).toBe(false)
  })

  it('does not show format column when hasMultipleFormats is false', () => {
    const wrapper = mountTable({ hasMultipleFormats: false })
    const headers = wrapper.findAll('th')
    const formatHeader = headers.find((h) => h.text() === 'Format')
    expect(formatHeader).toBeUndefined()
  })

  it('shows format column when hasMultipleFormats is true', () => {
    const wrapper = mountTable({ hasMultipleFormats: true })
    const headers = wrapper.findAll('th')
    const formatHeader = headers.find((h) => h.text().includes('Format'))
    expect(formatHeader).toBeDefined()
  })

  it('applies opacity class during loading instead of replacing rows', () => {
    const wrapper = mountTable({ loading: true })
    const tableContainer = wrapper.find('.overflow-x-auto')
    expect(tableContainer.classes()).toContain('opacity-50')
    expect(wrapper.find('tbody').findAll('tr').length).toBeGreaterThan(0)
  })

  it('does not apply opacity when not loading', () => {
    const wrapper = mountTable({ loading: false })
    const tableContainer = wrapper.find('.overflow-x-auto')
    expect(tableContainer.classes()).not.toContain('opacity-50')
  })

  it('sort header button emits sortChange with toggled direction', async () => {
    const wrapper = mountTable({ sortBy: 'startedAt', sortDir: 'asc' })
    const dateHeader = wrapper.find('thead button')
    await dateHeader.trigger('click')
    expect(wrapper.emitted('sortChange')?.[0]).toEqual(['startedAt', 'desc'])
  })

  it('sort header button emits asc when currently desc', async () => {
    const wrapper = mountTable({ sortBy: 'startedAt', sortDir: 'desc' })
    const dateHeader = wrapper.find('thead button')
    await dateHeader.trigger('click')
    expect(wrapper.emitted('sortChange')?.[0]).toEqual(['startedAt', 'asc'])
  })

  it('shows a Load more button when hasMore is true and emits loadMore', async () => {
    const wrapper = mountTable({ total: 30, hasMore: true })
    const loadMoreBtn = wrapper.findAll('button').find((b) => b.text().includes('Load more'))
    expect(loadMoreBtn).toBeDefined()
    await loadMoreBtn!.trigger('click')
    expect(wrapper.emitted('loadMore')).toBeTruthy()
  })

  it('hides the Load more button when everything is loaded', () => {
    const wrapper = mountTable({ total: 1, hasMore: false })
    const loadMoreBtn = wrapper.findAll('button').find((b) => b.text().includes('Load more'))
    expect(loadMoreBtn).toBeUndefined()
  })

  it('disables the Load more button while loading more', () => {
    const wrapper = mountTable({ total: 30, hasMore: true, loadingMore: true })
    const loadMoreBtn = wrapper.findAll('button').find((b) => b.text().includes('Load more'))
    expect(loadMoreBtn?.attributes('disabled')).toBeDefined()
  })

  it('shows the accumulated count', () => {
    const wrapper = mountTable({ sessions: [makeSession({ id: 1 }), makeSession({ id: 2 })], total: 50 })
    expect(wrapper.text()).toContain('Showing 2 of 50 sessions')
  })

  it('clears confirm state when sessions prop changes', async () => {
    const session = makeSession({ id: 1 })
    const wrapper = mountTable({ sessions: [session] })
    const deleteBtn = wrapper.find('button[title="Delete"]')
    await deleteBtn.trigger('click')
    expect(wrapper.find('button[title="Click again to confirm delete"]').exists()).toBe(true)
    await wrapper.setProps({ sessions: [makeSession({ id: 2 })] })
    expect(wrapper.find('button[title="Click again to confirm delete"]').exists()).toBe(false)
  })

  it('clears confirm state when sort changes', async () => {
    const wrapper = mountTable()
    const deleteBtn = wrapper.find('button[title="Delete"]')
    await deleteBtn.trigger('click')
    expect(wrapper.find('button[title="Click again to confirm delete"]').exists()).toBe(true)
    const sortBtn = wrapper.find('thead button')
    await sortBtn.trigger('click')
    expect(wrapper.find('button[title="Click again to confirm delete"]').exists()).toBe(false)
  })

  it('clears confirm state when cancel delete is clicked', async () => {
    const wrapper = mountTable()
    const deleteBtn = wrapper.find('button[title="Delete"]')
    await deleteBtn.trigger('click')
    expect(wrapper.find('button[title="Click again to confirm delete"]').exists()).toBe(true)
    const cancelBtn = wrapper.find('button[title="Cancel delete"]')
    await cancelBtn.trigger('click')
    expect(wrapper.find('button[title="Click again to confirm delete"]').exists()).toBe(false)
    expect(wrapper.find('button[title="Delete"]').exists()).toBe(true)
  })
})
