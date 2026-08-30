import { shallowMount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookDockSummary } from '@bookorbit/types'
import BookDockFilterBar from '../BookDockFilterBar.vue'

const summary: BookDockSummary = {
  pending: 0,
  working: 0,
  ready: 168,
  error: 0,
  needsReview: 167,
  readyToFile: 1,
  total: 168,
  paused: false,
}

describe('BookDockFilterBar', () => {
  it('shows filing-ready files in the Ready chip and selects the matching predicate', async () => {
    const wrapper = shallowMount(BookDockFilterBar, {
      props: { activeView: 'all', summary },
    })

    const readyChip = wrapper.get('[data-testid="book-dock-chip-ready"]')
    expect(readyChip.text()).toContain('Ready')
    expect(readyChip.text()).toContain('1')
    expect(readyChip.text()).not.toContain('168')

    await readyChip.trigger('click')

    expect(wrapper.emitted('view')).toEqual([['readyToFile']])
  })
})
