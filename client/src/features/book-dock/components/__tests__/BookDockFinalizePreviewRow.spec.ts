import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BookCard, BookDockFinalizePreviewItem } from '@bookorbit/types'
import BookDockFinalizePreviewRow from '../BookDockFinalizePreviewRow.vue'
import type { BookDockJoinChoice } from '../../composables/useBookDockJoinChoices'
import { i18n } from '@/i18n'

const pickerResults = ref<BookCard[]>([])
const pickerQuery = ref('')
const searchMock = vi.fn<(libraryId: number | null, term: string) => void>()

vi.mock('@/features/book/composables/useMergeBookPicker', () => ({
  useMergeBookPicker: () => ({
    query: pickerQuery,
    results: pickerResults,
    searching: ref(false),
    failed: ref(false),
    search: searchMock,
    reset: vi.fn<() => void>(),
  }),
}))

vi.mock('@/features/book/components/BookCoverImage.vue', () => ({ default: { template: '<img alt="" />' } }))

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

function item(overrides: Partial<BookDockFinalizePreviewItem> = {}): BookDockFinalizePreviewItem {
  return { fileId: 10, fileName: 'dune.pdf', newName: 'Frank Herbert/Dune/Dune.pdf', status: 'ready', libraryId: 2, canJoinBook: true, ...overrides }
}

function mountRow(props: { item: BookDockFinalizePreviewItem; choice?: BookDockJoinChoice; pickerOpen?: boolean }) {
  const wrapper = mount(BookDockFinalizePreviewRow, {
    props: { pickerOpen: false, ...props },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return wrapper
}

function button(wrapper: ReturnType<typeof mountRow>, text: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text().trim() === text)
  if (!found) throw new Error(`No button "${text}"`)
  return found
}

describe('BookDockFinalizePreviewRow', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
    pickerResults.value = []
    pickerQuery.value = ''
    searchMock.mockReset()
  })

  it('offers a suggested book with its reason and adds the file to it', async () => {
    const wrapper = mountRow({
      item: item({ suggestedJoinBook: { bookId: 42, title: 'Dune', authors: ['Frank Herbert'], reason: 'isbn' } }),
    })

    expect(wrapper.text()).toContain('Looks like another format of Dune')
    expect(wrapper.text()).toContain('Same ISBN')
    const accept = button(wrapper, 'Add to this book')
    expect(accept.attributes('aria-label')).toBe('Add dune.pdf to Dune')
    expect(wrapper.text()).toContain('Choose another book')

    await accept.trigger('click')
    expect(wrapper.emitted('choose')).toEqual([[{ bookId: 42, title: 'Dune' }]])
  })

  it('shows a work id match, and no reason for one this build does not know', () => {
    const work = mountRow({ item: item({ suggestedJoinBook: { bookId: 42, title: 'Dune', authors: [], reason: 'work_id' } }) })
    expect(work.text()).toContain('Same work on Hardcover or Open Library')

    const unknown = mountRow({
      item: item({ suggestedJoinBook: { bookId: 42, title: 'Dune', authors: [], reason: 'something_new' as never } }),
    })
    expect(unknown.text()).toContain('Looks like another format of Dune')
    expect(unknown.text()).not.toContain('Same')
  })

  it('offers no join where the preview does not allow one', () => {
    const wrapper = mountRow({
      item: item({ canJoinBook: false, suggestedJoinBook: { bookId: 42, title: 'Dune', authors: [], reason: 'isbn' } }),
    })
    expect(wrapper.text()).toBe('Frank Herbert/Dune/Dune.pdf')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('shows the confirmed book and files the file as new again', async () => {
    const wrapper = mountRow({
      item: item({ joinsBook: { bookId: 42, title: 'Dune', authors: ['Frank Herbert'] } }),
      choice: { bookId: 42, title: 'Dune' },
    })

    expect(wrapper.text()).toContain('Joins Dune')
    expect(wrapper.text()).toContain('Frank Herbert')
    expect(wrapper.text()).not.toContain('Add to an existing book')
    await button(wrapper, 'File as a new book').trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('explains a refused join in its own words', () => {
    const wrapper = mountRow({
      item: item({ newName: undefined, status: 'invalid_target', canJoinBook: undefined, errorCode: 'BOOK_DOCK_JOIN_OTHER_LIBRARY' }),
      choice: { bookId: 42, title: 'Dune' },
    })

    expect(wrapper.text()).toContain('dune.pdf')
    expect(wrapper.get('[role="alert"]').text()).toBe('Dune is in a different library from the one this file is filed into.')
    expect(wrapper.text()).toContain('File as a new book')
  })

  it('searches only the file library and hands back the picked book', async () => {
    const wrapper = mountRow({ item: item() })
    await button(wrapper, 'Add to an existing book').trigger('click')
    expect(wrapper.emitted('openPicker')).toHaveLength(1)

    await wrapper.setProps({ pickerOpen: true })
    await flushPromises()
    const input = wrapper.get('input[type="search"]')
    expect(document.activeElement).toBe(input.element)
    await input.setValue('dune')
    expect(searchMock).toHaveBeenCalledWith(2, 'dune')

    pickerResults.value = [{ id: 42, title: 'Dune', authors: ['Frank Herbert'], files: [{ format: 'epub' }], hasCover: false } as unknown as BookCard]
    await flushPromises()
    const result = wrapper.get('[data-testid="book-dock-join-picker-results"] button')
    expect(result.attributes('aria-label')).toBe('Add to Dune')
    expect(result.text()).toContain('EPUB')
    await result.trigger('click')
    expect(wrapper.emitted('choose')).toEqual([[{ bookId: 42, title: 'Dune' }]])
  })

  it('closes the picker on cancel or Escape', async () => {
    const wrapper = mountRow({ item: item(), pickerOpen: true })
    await flushPromises()
    await button(wrapper, 'Cancel').trigger('click')
    await wrapper.get('input[type="search"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('closePicker')).toHaveLength(2)
  })
})
