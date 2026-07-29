import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { AuditAction, type AuditLogEntry } from '@bookorbit/types'
import AuditEntryDetails from '../AuditEntryDetails.vue'

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    userId: 7,
    actorUsername: 'reader',
    action: AuditAction.BookBulkDelete,
    resource: 'book',
    resourceId: 10,
    description: 'Deleted "Dune" (#10)',
    ip: '127.0.0.1',
    meta: {
      total: 3,
      books: [
        { id: 10, title: 'Dune' },
        { id: 11, title: null },
      ],
      omitted: 1,
    },
    createdAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  }
}

describe('AuditEntryDetails', () => {
  it('renders resource and bounded deleted-book details', () => {
    const wrapper = mount(AuditEntryDetails, { props: { entry: makeEntry() } })

    expect(wrapper.get('[role="region"]').attributes('aria-label')).toBe('Details for audit event #1')
    expect(wrapper.text()).toContain('Event ID')
    expect(wrapper.text()).toContain('Actor')
    expect(wrapper.text()).toContain('reader')
    expect(wrapper.text()).toContain('Books')
    expect(wrapper.text()).toContain('Delete books')
    expect(wrapper.text()).toContain(AuditAction.BookBulkDelete)
    expect(wrapper.text()).toContain('Target type')
    expect(wrapper.text()).toContain('Book')
    expect(wrapper.text()).toContain('book')
    expect(wrapper.text()).toContain('Target ID')
    expect(wrapper.text()).toContain('Dune (book #10)')
    expect(wrapper.text()).toContain('Untitled (book #11)')
    expect(wrapper.text()).toContain('1 additional book omitted')
  })

  it('does not render malformed deletion metadata', () => {
    const wrapper = mount(AuditEntryDetails, {
      props: {
        entry: makeEntry({
          meta: { total: 2, books: [{ id: 10, title: 'Dune' }], omitted: 0 },
        }),
      },
    })

    expect(wrapper.text()).not.toContain('Deleted books')
    expect(wrapper.text()).not.toContain('Dune (book #10)')
  })
})
