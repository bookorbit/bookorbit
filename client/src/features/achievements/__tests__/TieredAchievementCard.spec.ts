import { mount } from '@vue/test-utils'
import type { AchievementItem } from '@bookorbit/types'
import { describe, expect, it, vi } from 'vitest'
import TieredAchievementCard from '../components/TieredAchievementCard.vue'
import type { TieredGroup } from '../types'

vi.mock('../utils/resolveLucideIcon', () => ({
  resolveLucideIcon: vi.fn<() => object>(() => ({ template: '<svg />' })),
}))

function makeTier(overrides: Partial<AchievementItem> = {}): AchievementItem {
  return {
    key: 't1',
    groupKey: 'g',
    tier: 1,
    category: 'reading',
    name: 'Tier 1',
    description: 'Do 1 thing',
    iconName: 'book-open',
    rarity: 'common',
    threshold: 1,
    hidden: false,
    sortOrder: 1,
    earned: false,
    awardedAt: null,
    context: null,
    currentProgress: null,
    ...overrides,
  }
}

function makeGroup(overrides: Partial<TieredGroup> = {}): TieredGroup {
  const tierOne = makeTier({
    key: 'g_1',
    tier: 1,
    name: 'Fledgling',
    rarity: 'common',
    earned: true,
    threshold: 1,
    awardedAt: '2026-05-15T00:00:00Z',
  })
  const tierTwo = makeTier({
    key: 'g_2',
    tier: 2,
    name: 'Bookworm',
    rarity: 'rare',
    earned: false,
    threshold: 10,
    currentProgress: 5,
  })
  const tierThree = makeTier({
    key: 'g_3',
    tier: 3,
    name: 'Centurion',
    rarity: 'epic',
    earned: false,
    threshold: 50,
  })
  const tierFour = makeTier({
    key: 'g_4',
    tier: 4,
    name: 'Bibliophile',
    rarity: 'legendary',
    earned: false,
    threshold: 100,
  })

  return {
    type: 'tiered',
    groupKey: 'g',
    category: 'reading',
    displayName: 'Fledgling',
    displayDescription: 'Finish 10 books',
    iconName: 'book-open',
    rarity: 'common',
    tiers: [tierOne, tierTwo, tierThree, tierFour],
    earnedCount: 1,
    totalTiers: 4,
    highestEarnedTier: tierOne,
    nextUnearned: tierTwo,
    currentProgress: 5,
    sortOrder: 1,
    ...overrides,
  }
}

describe('TieredAchievementCard', () => {
  it('renders displayName and displayDescription', () => {
    const wrapper = mount(TieredAchievementCard, { props: { group: makeGroup() } })
    expect(wrapper.text()).toContain('Fledgling')
    expect(wrapper.text()).toContain('Finish 10 books')
  })

  it('renders correct number of pip dots', () => {
    const wrapper = mount(TieredAchievementCard, { props: { group: makeGroup() } })
    const pips = wrapper.findAll('[class*="rounded-full"][class*="size-2"]')
    expect(pips.length).toBe(4)
  })

  it('shows compact tier progress in a single line', () => {
    const wrapper = mount(TieredAchievementCard, { props: { group: makeGroup() } })
    expect(wrapper.text()).toContain('Tier 1 of 4')
    expect(wrapper.text()).toContain('5 / 10 to Bookworm')
    expect(wrapper.find('[class*="h-1.5"][class*="flex-1"]').exists()).toBe(false)
  })

  it('shows Tier 0 progress text when no tiers are earned yet', () => {
    const tierOne = makeTier({
      key: 'library_builder_1',
      groupKey: 'library_builder',
      tier: 1,
      name: 'Shelf Starter',
      description: 'Have 50 books in your library',
      threshold: 50,
      earned: false,
      currentProgress: 264,
    })
    const tierTwo = makeTier({
      key: 'library_builder_2',
      groupKey: 'library_builder',
      tier: 2,
      name: 'Growing Collection',
      threshold: 250,
      earned: false,
    })
    const tierThree = makeTier({
      key: 'library_builder_3',
      groupKey: 'library_builder',
      tier: 3,
      name: 'Vast Library',
      threshold: 1000,
      earned: false,
    })
    const tierFour = makeTier({
      key: 'library_builder_4',
      groupKey: 'library_builder',
      tier: 4,
      name: 'Library of Alexandria',
      threshold: 5000,
      earned: false,
    })
    const wrapper = mount(TieredAchievementCard, {
      props: {
        group: makeGroup({
          displayName: 'Shelf Starter',
          displayDescription: 'Have 50 books in your library',
          tiers: [tierOne, tierTwo, tierThree, tierFour],
          earnedCount: 0,
          totalTiers: 4,
          highestEarnedTier: null,
          nextUnearned: tierOne,
          currentProgress: 264,
        }),
      },
    })

    expect(wrapper.text()).toContain('Tier 0 of 4')
    expect(wrapper.text()).toContain('264 / 50 to Shelf Starter')
  })

  it('shows All tiers complete! when all earned', () => {
    const allEarned = makeGroup({
      earnedCount: 4,
      totalTiers: 4,
      nextUnearned: null,
      currentProgress: null,
    })
    const wrapper = mount(TieredAchievementCard, { props: { group: allEarned } })
    expect(wrapper.text()).toContain('All tiers complete!')
    expect(wrapper.find('[class*="bg-green-500"]').exists()).toBe(true)
    expect(wrapper.find('[class*="text-green-400"]').exists()).toBe(true)
  })

  it('clicking toggles expansion', async () => {
    const wrapper = mount(TieredAchievementCard, { props: { group: makeGroup() } })
    expect(wrapper.find('[class*="border-t"]').exists()).toBe(false)
    await wrapper.trigger('click')
    expect(wrapper.find('[class*="border-t"]').exists()).toBe(true)
  })

  it('expanded panel shows tier list', async () => {
    const wrapper = mount(TieredAchievementCard, { props: { group: makeGroup() } })
    await wrapper.trigger('click')
    expect(wrapper.text()).toContain('Fledgling')
    expect(wrapper.text()).toContain('Bookworm')
    expect(wrapper.text()).toContain('Centurion')
    expect(wrapper.text()).toContain('Bibliophile')
  })

  it('expanded panel shows tier dates for earned tiers', async () => {
    const wrapper = mount(TieredAchievementCard, { props: { group: makeGroup() } })
    await wrapper.trigger('click')
    const expectedDate = new Date('2026-05-15T00:00:00Z').toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    expect(wrapper.text()).toContain(expectedDate)
  })
})
