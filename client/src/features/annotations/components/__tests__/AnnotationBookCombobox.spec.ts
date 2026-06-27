import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { AnnotationHubBookFacet } from '@bookorbit/types'
import AnnotationBookCombobox from '../AnnotationBookCombobox.vue'

const BOOKS: AnnotationHubBookFacet[] = [
  { bookId: 5, bookTitle: 'Dune', author: 'FH', count: 9 },
  { bookId: 6, bookTitle: 'Hyperion', author: 'DS', count: 4 },
]

function mountCombobox(props: Partial<{ modelValue: number | 'all'; selectedLabel: string | null }> = {}, books = BOOKS) {
  const searchFn = vi.fn<(q: string) => Promise<AnnotationHubBookFacet[]>>().mockResolvedValue(books)
  const wrapper = mount(AnnotationBookCombobox, {
    props: { modelValue: 'all', selectedLabel: null, searchFn, ...props },
  })
  return { wrapper, searchFn }
}

describe('AnnotationBookCombobox', () => {
  it('shows the selected label and a clear control when a book is selected', () => {
    const { wrapper } = mountCombobox({ modelValue: 5, selectedLabel: 'Dune' })

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Dune')
    expect(wrapper.find('[aria-label="Clear book filter"]').exists()).toBe(true)
  })

  it('loads the recent list on focus and emits id + label on select', async () => {
    const { wrapper, searchFn } = mountCombobox()

    await wrapper.get('input').trigger('focus')
    await flushPromises()

    expect(searchFn).toHaveBeenCalledWith('')
    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(2)

    await options[0]!.trigger('mousedown')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([5])
    expect(wrapper.emitted('update:selectedLabel')?.[0]).toEqual(['Dune'])
  })

  it('clears the selection back to all books', async () => {
    const { wrapper } = mountCombobox({ modelValue: 5, selectedLabel: 'Dune' })

    await wrapper.get('[aria-label="Clear book filter"]').trigger('mousedown')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['all'])
    expect(wrapper.emitted('update:selectedLabel')?.[0]).toEqual([null])
  })

  it('shows an empty state when the search returns nothing', async () => {
    const { wrapper } = mountCombobox({}, [])

    await wrapper.get('input').trigger('focus')
    await flushPromises()

    expect(wrapper.text()).toContain('No books found')
  })
})
