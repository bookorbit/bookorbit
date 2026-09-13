import { shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { BookDockSummary } from '@bookorbit/types'
import BookDockListBar from '../BookDockListBar.vue'

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    isDemoRestrictedAccount: { value: false },
  }),
}))

const summary: BookDockSummary = {
  pending: 0,
  working: 0,
  ready: 2,
  error: 0,
  needsReview: 0,
  readyToFile: 2,
  total: 2,
  paused: false,
}

function mountListBar(selectionCount: number) {
  return shallowMount(BookDockListBar, {
    props: {
      pageCount: 2,
      total: 2,
      totalSizeBytes: null,
      allOnPageSelected: selectionCount === 2,
      selectAllMatching: false,
      selectionCount,
      fetchedCount: 0,
      errorCount: 0,
      sort: 'attention',
      summary,
      keyboardActive: false,
    },
  })
}

describe('BookDockListBar selection actions', () => {
  it('offers a distinct deselect action while files are selected', () => {
    const wrapper = mountListBar(2)

    expect(wrapper.get('[data-testid="book-dock-deselect"]').text()).toBe('Deselect')
    expect(wrapper.get('[data-testid="book-dock-bulk-discard"]').text()).toBe('Discard')
  })

  it('emits deselect without invoking discard', async () => {
    const wrapper = mountListBar(2)

    await wrapper.get('[data-testid="book-dock-deselect"]').trigger('click')

    expect(wrapper.emitted('deselect')).toHaveLength(1)
    expect(wrapper.emitted('bulkDiscard')).toBeUndefined()
  })

  it('does not show selection actions when nothing is selected', () => {
    const wrapper = mountListBar(0)

    expect(wrapper.find('[data-testid="book-dock-deselect"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="book-dock-bulk-discard"]').exists()).toBe(false)
  })
})
