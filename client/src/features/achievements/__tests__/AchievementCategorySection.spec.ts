import { mount } from '@vue/test-utils'
import type { AchievementCategoryGroup, AchievementItem } from '@bookorbit/types'
import { describe, expect, it } from 'vitest'
import AchievementCategorySection from '../components/AchievementCategorySection.vue'

function makeAchievement(overrides: Partial<AchievementItem> = {}): AchievementItem {
  return {
    key: 'achievement',
    groupKey: null,
    tier: null,
    category: 'reading',
    name: 'Achievement',
    description: 'Description',
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

function makeGroup(overrides: Partial<AchievementCategoryGroup> = {}): AchievementCategoryGroup {
  return {
    key: 'exploration',
    label: 'Exploration',
    earnedCount: 1,
    totalCount: 2,
    achievements: [
      makeAchievement({ key: 'a1', category: 'exploration', earned: true }),
      makeAchievement({ key: 'a2', category: 'exploration', earned: false }),
    ],
    ...overrides,
  }
}

function mountComponent(group: AchievementCategoryGroup = makeGroup()) {
  return mount(AchievementCategorySection, {
    props: {
      group,
      filter: 'all',
    },
    global: {
      stubs: {
        AchievementCard: { template: '<div class="achievement-card-stub" />' },
        TieredAchievementCard: { template: '<div class="tiered-achievement-card-stub" />' },
      },
    },
  })
}

describe('AchievementCategorySection', () => {
  it('renders the category accent bar for the category', () => {
    const wrapper = mountComponent()
    expect(wrapper.find('.w-1.rounded-full').classes()).toContain('bg-orange-500')
  })

  it('renders an AchievementProgressRing with the category icon color', () => {
    const wrapper = mountComponent()
    const ring = wrapper.findComponent({ name: 'AchievementProgressRing' })
    expect(ring.exists()).toBe(true)
    expect(ring.props('color')).toBe('text-orange-400')
    expect(ring.props('percent')).toBe(50)
  })

  it('uses gap-6 spacing for the grid', () => {
    const wrapper = mountComponent()
    expect(wrapper.find('.grid').classes()).toContain('gap-6')
  })
})
