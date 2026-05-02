import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import BookTableCellDispatcher from '../BookTableCellDispatcher.vue'

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Book One',
    authors: ['Author A'],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    ...overrides,
  }
}

const baseProps = {
  book: makeBook(),
  colId: 'lockRow' as const,
  cellType: 'lockRow' as const,
  hasLockField: false,
  isLocked: false,
  isActive: false,
  isReadOnly: false,
  isFullyLocked: false,
  lockedFieldCount: 0,
  selectionMode: false,
  alwaysShowOpenLinkIcon: false,
  value: null,
}

function mountDispatcher(overrides: Partial<typeof baseProps> = {}) {
  return mount(BookTableCellDispatcher, {
    props: { ...baseProps, ...overrides },
    global: {
      stubs: {
        Lock: { template: '<svg data-test="lock-icon" />' },
        LockOpen: { template: '<svg data-test="lock-open-icon" />' },
      },
    },
  })
}

describe('BookTableCellDispatcher lock row', () => {
  it('renders unlocked state and emits lock-all', async () => {
    const wrapper = mountDispatcher({ isFullyLocked: false, lockedFieldCount: 0 })
    const button = wrapper.get('button')

    expect(button.attributes('aria-label')).toBe('Lock all fields')
    expect(button.classes()).toContain('text-muted-foreground/70')

    await button.trigger('click')
    expect(wrapper.emitted('lockAll')).toBeTruthy()
    expect(wrapper.emitted('unlockAll')).toBeFalsy()
  })

  it('renders partial lock state in first column and emits lock-all', async () => {
    const wrapper = mountDispatcher({ isFullyLocked: false, lockedFieldCount: 2 })
    const button = wrapper.get('button')

    expect(button.attributes('aria-label')).toBe('Lock all fields')
    expect(button.classes()).toContain('text-amber-600/90')

    await button.trigger('click')
    expect(wrapper.emitted('lockAll')).toBeTruthy()
    expect(wrapper.emitted('unlockAll')).toBeFalsy()
  })

  it('renders fully locked state and emits unlock-all', async () => {
    const wrapper = mountDispatcher({ isFullyLocked: true, lockedFieldCount: 12 })
    const button = wrapper.get('button')

    expect(button.attributes('aria-label')).toBe('Unlock all fields')
    expect(button.classes()).toContain('text-primary/90')

    await button.trigger('click')
    expect(wrapper.emitted('unlockAll')).toBeTruthy()
    expect(wrapper.emitted('lockAll')).toBeFalsy()
  })
})
