import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PaginationNav from '../PaginationNav.vue'

function mountPager(page: number, totalPages: number) {
  return mount(PaginationNav, { props: { page, totalPages } })
}

function numberedButtons(wrapper: ReturnType<typeof mountPager>) {
  return wrapper.findAll('button').filter((button) => /^\d+$/.test(button.text().trim()))
}

describe('PaginationNav', () => {
  it('keeps a 350-page run bounded around the current page', () => {
    const wrapper = mountPager(176, 350)

    expect(numberedButtons(wrapper).map((button) => button.text())).toEqual(['1', '2', '175', '176', '177', '349', '350'])
    expect(wrapper.findAll('[aria-hidden="true"]').filter((element) => element.text() === '…')).toHaveLength(2)
    expect(wrapper.get('[aria-current="page"]').text()).toBe('176')
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Page 176 of 350')
  })

  it('shows the first and last pages at either boundary', () => {
    const first = mountPager(1, 350)
    const last = mountPager(350, 350)

    expect(numberedButtons(first).map((button) => button.text())).toEqual(['1', '2', '349', '350'])
    expect(numberedButtons(last).map((button) => button.text())).toEqual(['1', '2', '349', '350'])
    expect(first.get('[aria-label="Previous page"]').attributes('disabled')).toBeDefined()
    expect(last.get('[aria-label="Next page"]').attributes('disabled')).toBeDefined()
  })

  it('fills single-page gaps and lists short runs fully', () => {
    expect(numberedButtons(mountPager(4, 8)).map((button) => button.text())).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(numberedButtons(mountPager(2, 4)).map((button) => button.text())).toEqual(['1', '2', '3', '4'])
  })

  it('emits bounded previous, next, and direct page changes', async () => {
    const wrapper = mountPager(176, 350)

    await wrapper.get('[aria-label="Previous page"]').trigger('click')
    await wrapper.get('[aria-label="Next page"]').trigger('click')
    await wrapper.get('[aria-label="Go to page 350"]').trigger('click')

    expect(wrapper.emitted('update:page')).toEqual([[175], [177], [350]])
  })

  it('hides itself when there is one page', () => {
    expect(mountPager(1, 1).find('nav').exists()).toBe(false)
  })
})
