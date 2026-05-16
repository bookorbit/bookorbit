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
        earnedCount: 2,
        inProgressCount: 1,
        lockedCount: 2,
      },
    })
  }

  it('renders aggregate achievement stats', () => {
    const wrapper = mountComponent()
    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).toContain('/ 5 earned')
  })

  it('renders the vertical divider', () => {
    const wrapper = mountComponent()
    expect(wrapper.find('.bg-border.h-4.w-px').exists()).toBe(true)
  })

  it('emits filter changes when pills are clicked', async () => {
    const wrapper = mountComponent()
    const buttons = wrapper.findAll('button')

    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')
    await buttons[3]!.trigger('click')

    expect(wrapper.emitted('change')).toEqual([['all'], ['earned'], ['in-progress'], ['locked']])
  })
})
