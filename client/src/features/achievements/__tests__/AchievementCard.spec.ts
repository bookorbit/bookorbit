import { mount } from '@vue/test-utils'
import type { AchievementItem } from '@bookorbit/types'
import { describe, expect, it, vi } from 'vitest'
import AchievementCard from '../components/AchievementCard.vue'

vi.mock('../utils/resolveLucideIcon', () => ({
  resolveLucideIcon: vi.fn<() => object>(() => ({ template: '<svg />' })),
}))

function makeAchievement(overrides: Partial<AchievementItem> = {}): AchievementItem {
  return {
    key: 'test',
    groupKey: null,
    tier: null,
    category: 'reading',
    name: 'Test Achievement',
    description: 'Do something cool',
    iconName: 'book-open',
    rarity: 'common',
    threshold: null,
    hidden: false,
    sortOrder: 1,
    earned: false,
    awardedAt: null,
    context: null,
    currentProgress: null,
    ...overrides,
  }
}

describe('AchievementCard', () => {
  it('renders name and description for a locked achievement', () => {
    const wrapper = mount(AchievementCard, { props: { achievement: makeAchievement() } })
    expect(wrapper.text()).toContain('Test Achievement')
    expect(wrapper.text()).toContain('Do something cool')
  })

  it('renders rarity pill for a locked achievement', () => {
    const wrapper = mount(AchievementCard, {
      props: { achievement: makeAchievement({ rarity: 'rare' }) },
    })
    expect(wrapper.text()).toContain('Rare')
  })

  it('shows Secret Achievement and pulsing state for hidden locked achievements', () => {
    const wrapper = mount(AchievementCard, {
      props: { achievement: makeAchievement({ hidden: true, earned: false }) },
    })
    expect(wrapper.text()).toContain('Secret Achievement')
    expect(wrapper.text()).toContain('???')
    expect(wrapper.text()).not.toContain('Test Achievement')
    expect(wrapper.classes()).toContain('animate-pulse')
  })

  it('applies grayscale class for locked non-hidden achievements', () => {
    const wrapper = mount(AchievementCard, {
      props: { achievement: makeAchievement({ hidden: false, earned: false }) },
    })
    expect(wrapper.classes()).toContain('grayscale')
  })

  it('shows earned date for earned achievements', () => {
    const wrapper = mount(AchievementCard, {
      props: {
        achievement: makeAchievement({ earned: true, awardedAt: '2026-01-05T00:00:00Z' }),
      },
    })
    expect(wrapper.text()).toContain('Earned')
    expect(wrapper.text()).toContain('2026')
  })

  it('renders a check badge for earned achievements', () => {
    const wrapper = mount(AchievementCard, {
      props: {
        achievement: makeAchievement({ earned: true, awardedAt: '2026-01-05T00:00:00Z' }),
      },
    })
    expect(wrapper.find('[class*="bg-green-500"]').exists()).toBe(true)
    expect(wrapper.find('[class*="text-green-400"]').exists()).toBe(true)
  })

  it('does not show earned date for locked achievements', () => {
    const wrapper = mount(AchievementCard, {
      props: { achievement: makeAchievement({ earned: false, awardedAt: null }) },
    })
    expect(wrapper.text()).not.toContain('Earned')
  })

  it('toggles isExpanded on click for non-hidden achievements', async () => {
    const wrapper = mount(AchievementCard, {
      props: { achievement: makeAchievement({ earned: true, awardedAt: '2026-01-05T00:00:00Z' }) },
    })
    const expandedBefore = wrapper.find('[class*="border-t"]').exists()
    await wrapper.trigger('click')
    const expandedAfter = wrapper.find('[class*="border-t"]').exists()
    expect(expandedAfter).not.toBe(expandedBefore)
  })

  it('does not expand on click for hidden locked achievements', async () => {
    const wrapper = mount(AchievementCard, {
      props: { achievement: makeAchievement({ hidden: true, earned: false }) },
    })
    await wrapper.trigger('click')
    expect(wrapper.find('[class*="border-t"]').exists()).toBe(false)
  })

  it('shows progress bar when threshold and currentProgress are set and not earned', () => {
    const wrapper = mount(AchievementCard, {
      props: {
        achievement: makeAchievement({ threshold: 100, currentProgress: 45, earned: false }),
      },
    })
    expect(wrapper.text()).toContain('45')
    expect(wrapper.text()).toContain('100')
  })

  it('does not show progress bar when earned', () => {
    const wrapper = mount(AchievementCard, {
      props: {
        achievement: makeAchievement({
          threshold: 100,
          currentProgress: 100,
          earned: true,
          awardedAt: '2026-01-05T00:00:00Z',
        }),
      },
    })
    expect(wrapper.text()).not.toContain('100 / 100')
  })

  it('shows context bookTitle when expanded and earned', async () => {
    const wrapper = mount(AchievementCard, {
      props: {
        achievement: makeAchievement({
          earned: true,
          awardedAt: '2026-01-05T00:00:00Z',
          context: { bookTitle: 'Dune' },
        }),
      },
    })
    await wrapper.trigger('click')
    expect(wrapper.text()).toContain('Dune')
  })
})
