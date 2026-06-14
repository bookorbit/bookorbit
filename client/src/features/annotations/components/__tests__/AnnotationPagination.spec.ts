import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AnnotationPagination from '../AnnotationPagination.vue'

const stubs = { Button: { template: '<button><slot /></button>' } }

function mountPagination(props: Record<string, unknown> = {}) {
  return mount(AnnotationPagination, {
    props: { page: 2, totalPages: 5, rangeStart: 26, rangeEnd: 50, total: 120, ...props },
    global: { stubs },
  })
}

describe('AnnotationPagination', () => {
  it('renders the range summary with an optional unit', () => {
    expect(mountPagination().text()).toContain('Showing 26-50 of 120')
    expect(mountPagination({ unit: 'highlights' }).text()).toContain('of 120 highlights')
  })

  it('hides the navigation when there is a single page', () => {
    const wrapper = mountPagination({ totalPages: 1, page: 1 })
    expect(wrapper.find('[aria-label="Next page"]').exists()).toBe(false)
  })

  it('emits the next and previous pages', async () => {
    const wrapper = mountPagination({ page: 2, totalPages: 5 })
    await wrapper.get('[aria-label="Next page"]').trigger('click')
    await wrapper.get('[aria-label="Previous page"]').trigger('click')
    expect(wrapper.emitted('update:page')).toEqual([[3], [1]])
  })

  it('jumps to the first and last pages', async () => {
    const wrapper = mountPagination({ page: 3, totalPages: 5 })
    await wrapper.get('[aria-label="First page"]').trigger('click')
    await wrapper.get('[aria-label="Last page"]').trigger('click')
    expect(wrapper.emitted('update:page')).toEqual([[1], [5]])
  })

  it('disables the edges and never emits past the bounds', async () => {
    const first = mountPagination({ page: 1, totalPages: 3 })
    expect(first.get('[aria-label="Previous page"]').attributes('disabled')).toBeDefined()
    await first.get('[aria-label="Previous page"]').trigger('click')
    expect(first.emitted('update:page')).toBeUndefined()

    const last = mountPagination({ page: 3, totalPages: 3 })
    expect(last.get('[aria-label="Next page"]').attributes('disabled')).toBeDefined()
    await last.get('[aria-label="Next page"]').trigger('click')
    expect(last.emitted('update:page')).toBeUndefined()
  })
})
