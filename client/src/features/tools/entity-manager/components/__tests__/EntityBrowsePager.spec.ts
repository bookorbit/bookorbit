import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import EntityBrowsePager from '../EntityBrowsePager.vue'

function mountPager(overrides: Partial<InstanceType<typeof EntityBrowsePager>['$props']> = {}) {
  return mount(EntityBrowsePager, {
    props: { page: 1, pageSize: 25, total: 428, totalPages: 18, ...overrides },
    global: {
      stubs: {
        DropdownMenu: { template: '<div><slot /></div>' },
        DropdownMenuTrigger: { template: '<div><slot /></div>' },
        DropdownMenuContent: { template: '<div><slot /></div>' },
        DropdownMenuItem: { emits: ['click'], template: '<button class="page-size-item" @click="$emit(\'click\')"><slot /></button>' },
      },
    },
  })
}

function pageLinks(wrapper: ReturnType<typeof mountPager>) {
  return wrapper.findAll('nav button').filter((button) => /^\d+$/.test(button.text().trim()))
}

describe('EntityBrowsePager', () => {
  it('reports the visible range rather than only the page number', () => {
    expect(mountPager({ page: 2 }).text()).toContain('Showing 26-50 of 428')
  })

  it('caps the range at the total on the final page', () => {
    expect(mountPager({ page: 18 }).text()).toContain('Showing 426-428 of 428')
  })

  it('reports an empty range when there are no results', () => {
    expect(mountPager({ page: 1, total: 0, totalPages: 1 }).text()).toContain('Showing 0-0 of 0')
  })

  it('emits previous and next page updates', async () => {
    const wrapper = mountPager({ page: 2 })

    await wrapper.find('[aria-label="Previous page"]').trigger('click')
    await wrapper.find('[aria-label="Next page"]').trigger('click')

    expect(wrapper.emitted('update:page')).toEqual([[1], [3]])
  })

  it('disables paging past either end', () => {
    const first = mountPager({ page: 1 })
    const last = mountPager({ page: 18 })

    expect(first.find('[aria-label="Previous page"]').attributes('disabled')).toBeDefined()
    expect(last.find('[aria-label="Next page"]').attributes('disabled')).toBeDefined()
  })

  it('collapses long page runs around the current page', () => {
    const wrapper = mountPager({ page: 9 })

    expect(pageLinks(wrapper).map((button) => button.text())).toEqual(['1', '8', '9', '10', '18'])
    expect(wrapper.text()).toContain('\u2026')
  })

  it('lists every page when the run is short enough to fit', () => {
    const wrapper = mountPager({ page: 1, total: 100, totalPages: 4 })

    expect(pageLinks(wrapper).map((button) => button.text())).toEqual(['1', '2', '3', '4'])
  })

  it('marks the current page for assistive technology', () => {
    const wrapper = mountPager({ page: 9 })
    const current = pageLinks(wrapper).find((button) => button.text() === '9')!

    expect(current.attributes('aria-current')).toBe('page')
  })

  it('emits a jump to a specific page', async () => {
    const wrapper = mountPager({ page: 9 })

    await pageLinks(wrapper)
      .find((button) => button.text() === '18')!
      .trigger('click')

    expect(wrapper.emitted('update:page')?.[0]).toEqual([18])
  })

  it('emits page size updates', async () => {
    const wrapper = mountPager()

    await wrapper.findAll('.page-size-item')[1]!.trigger('click')

    expect(wrapper.emitted('update:pageSize')?.[0]).toEqual([50])
  })

  it('hides pagination controls when everything fits on one page', () => {
    expect(mountPager({ total: 10, totalPages: 1 }).find('nav').exists()).toBe(false)
  })
})
