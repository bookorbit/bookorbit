import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AchievementFilterBar from '../components/AchievementFilterBar.vue'

describe('AchievementFilterBar', () => {
  function mountComponent() {
    return mount(AchievementFilterBar, {
      props: {
        activeFilter: 'all',
        totalEarned: 2,
        totalAvailable: 5,
        counts: { all: 4, earned: 1, 'in-progress': 2, locked: 1 },
      },
    })
  }

  it('renders the heading and the tier summary', () => {
    const wrapper = mountComponent()
    expect(wrapper.text()).toContain('Achievements')
    expect(wrapper.text()).toContain('2 of 5 tiers')
  })

  it('shows each filter with its count and marks the active one', () => {
    const buttons = mountComponent().get('[role="group"]').findAll('button')
    expect(buttons.map((button) => button.text().replace(/\s+/g, ' '))).toEqual(['All 4', 'Earned 1', 'In progress 2', 'Locked 1'])
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true')
    expect(buttons[1]!.attributes('aria-pressed')).toBe('false')
  })

  it('emits filter changes when pills are clicked', async () => {
    const wrapper = mountComponent()
    const buttons = wrapper.get('[role="group"]').findAll('button')
    for (const button of buttons) await button.trigger('click')
    expect(wrapper.emitted('change')).toEqual([['all'], ['earned'], ['in-progress'], ['locked']])
  })
})
