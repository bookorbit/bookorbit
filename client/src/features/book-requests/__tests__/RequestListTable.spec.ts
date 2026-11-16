import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookRequestItem } from '@bookorbit/types'

import RequestListTable from '../components/RequestListTable.vue'

const LONG_TITLE = 'Teddy and Booker T: How Two American Icons Blazed a Path for Racial Equality (Unabridged)'

function request(overrides: Partial<BookRequestItem> = {}): BookRequestItem {
  return {
    id: 1613,
    userId: 1,
    requesterUsername: 'reporter',
    requesterName: 'Issue Reporter',
    title: LONG_TITLE,
    subtitle: null,
    authors: ['Brian Kilmeade'],
    seriesName: null,
    seriesIndex: null,
    isbn10: null,
    isbn13: null,
    publishedYear: 2021,
    language: 'en',
    coverUrl: null,
    providerKey: null,
    providerId: null,
    metadataSources: [],
    mediaKind: 'audiobook',
    status: 'available',
    preferredFormats: [],
    note: null,
    targetLibraryId: 1,
    targetLibraryName: 'Audiobooks',
    targetFolderId: null,
    decidedByUserId: null,
    decidedByUsername: null,
    decidedByName: null,
    decidedAt: null,
    decisionNote: null,
    matchedBookId: 42,
    bookDockFileId: null,
    selfServe: false,
    fulfillerUserId: null,
    statusReason: null,
    failureCode: null,
    failureMeta: null,
    subscribers: [],
    download: null,
    dismissed: false,
    companionRequestId: null,
    targetBookId: null,
    createdAt: '2026-09-29T12:00:00.000Z',
    updatedAt: '2026-09-29T12:00:00.000Z',
    ...overrides,
  }
}

const MODERATOR = { userId: 1, canManage: true, canSelfFulfil: true }

function render(rows: BookRequestItem[] = [request()], overrides: Record<string, unknown> = {}) {
  return mount(RequestListTable, {
    props: {
      requests: rows,
      viewer: MODERATOR,
      showRequester: true,
      busyIds: new Set<number>(),
      progressByRequest: {},
      density: 'comfortable',
      sortBy: 'createdAt',
      sortDir: 'desc',
      selectedRowIds: new Set<number>(),
      pageSelection: 'none',
      ...overrides,
    },
    global: {
      stubs: {
        RouterLink: RouterLinkStub,
        RequestCover: true,
        RequestPairCover: true,
        RequestStatusBadge: { props: ['status'], template: '<span class="status-badge">{{ status }}</span>' },
      },
    },
  })
}

describe('RequestListTable', () => {
  it('lets the book column take the slack, with the title truncated inside it', () => {
    const wrapper = render()
    const titleButton = wrapper.findAll('table tbody button').find((button) => button.text() === LONG_TITLE)

    expect(wrapper.get('table').classes()).toContain('table-fixed')
    expect(titleButton).toBeDefined()
    expect(titleButton!.classes()).toEqual(expect.arrayContaining(['min-w-0', 'truncate']))
    expect(titleButton!.attributes('title')).toBe(LONG_TITLE)
  })

  // A format asked for from a book's page carries no art, and used to show a blank placeholder.
  it('falls back to the cover of the book a format request joins', () => {
    const wrapper = render([request({ status: 'approved', matchedBookId: null, targetBookId: 434, coverUrl: null })])
    const covers = wrapper.findAllComponents({ name: 'RequestCover' })

    expect(covers.length).toBeGreaterThan(0)
    for (const cover of covers) {
      expect(cover.props('src')).toBeNull()
      expect(cover.props('fallbackSources')).toEqual(['/api/v1/books/434/thumbnail?medium=audio'])
    }
  })

  it('gives every row a checkbox, whatever state it is in', () => {
    const statuses = ['pending', 'approved', 'downloading', 'importing', 'needs_review', 'available', 'cancelled'] as const
    const wrapper = render(statuses.map((status, index) => request({ id: index + 1, status })))
    expect(wrapper.findAll('table tbody input[type="checkbox"]')).toHaveLength(statuses.length)
    expect(wrapper.findAll('ul input[type="checkbox"]')).toHaveLength(statuses.length)
  })

  it('opens the request from anywhere on the row, but not from its checkbox', async () => {
    const wrapper = render()
    await wrapper.get('table tbody td:nth-child(3)').trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual([1613])

    await wrapper.get('table tbody input[type="checkbox"]').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('shows the requester only on the approver list', () => {
    expect(render().get('table tbody').text()).toContain('Issue Reporter')
    expect(render([request()], { showRequester: false }).get('table tbody').text()).not.toContain('Issue Reporter')
  })

  it('says a request needs a release rather than repeating why automation handed it back', () => {
    const wrapper = render([request({ status: 'approved', failureCode: 'AUTOMATION_DISABLED', matchedBookId: null })])
    expect(wrapper.get('table tbody').text()).toContain('Needs a release')
    expect(wrapper.get('table tbody').text()).not.toContain('Automatic grabbing is off')
  })

  it('offers the next step as one button and keeps it out of the menu', () => {
    const wrapper = render([request({ status: 'approved', matchedBookId: null })])
    const step = wrapper.get('table tbody td:last-child button')
    expect(step.text()).toBe('Pick release')
  })
})

describe('RequestListTable pairs', () => {
  const ebook = request({ id: 10, mediaKind: 'ebook', status: 'pending', title: 'Dune', companionRequestId: 11, matchedBookId: null })
  const audiobook = request({ id: 11, mediaKind: 'audiobook', status: 'downloading', title: 'Dune', companionRequestId: 10, matchedBookId: null })

  it('renders the pair as one row with a lane per half, the ebook first', () => {
    const wrapper = render([{ ...ebook, companion: audiobook }])

    expect(wrapper.findAll('table tbody tr')).toHaveLength(1)
    const lanes = wrapper
      .get('table')
      .findAll('.status-badge')
      .map((badge) => badge.text())
    expect(lanes).toEqual(['pending', 'downloading'])
    expect(wrapper.find('table').text()).toContain('E-book + audiobook')
  })

  it('approves only the half that is waiting from the row button', async () => {
    const wrapper = render([{ ...ebook, companion: audiobook }])

    await wrapper.get('table tbody td:last-child button').trigger('click')

    const [step, row] = wrapper.emitted('step')?.[0] ?? []
    expect(step).toMatchObject({ kind: 'approve', halves: [expect.objectContaining({ id: 10 })] })
    expect(row).toMatchObject({ id: 10 })
  })

  it('ticks the row as one, whichever halves an action could reach', () => {
    const selected = render([{ ...ebook, companion: audiobook }], { selectedRowIds: new Set([10]) })
    expect((selected.get('table tbody input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    const none = render([{ ...ebook, companion: audiobook }])
    expect((none.get('table tbody input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
  })
})
