import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { AchievementCategoryGroup, AchievementHint } from '@bookorbit/types'
import { booksFinishedSet, makeAchievement, makeCategory } from './fixtures'

const state = {
  categories: ref<AchievementCategoryGroup[]>([]),
  totalEarned: ref(0),
  totalAvailable: ref(0),
  loading: ref(false),
  error: ref(false),
  reload: vi.fn<() => Promise<void>>(),
}

const hintState = {
  hints: ref<ReadonlyMap<string, AchievementHint>>(new Map()),
  reload: vi.fn<() => Promise<void>>(),
}

vi.mock('../composables/useAchievements', () => ({ useAchievements: () => state }))
vi.mock('../composables/useAchievementHints', () => ({ useAchievementHints: () => hintState }))

import AchievementsTab from '../components/AchievementsTab.vue'

const stubs = {
  AchievementDetailSheet: {
    props: ['item', 'categoryLabel', 'hint'],
    template: '<div class="sheet-stub" :data-open="item ? item.type : \'\'" :data-hint="hint ? hint.key : \'\'">{{ categoryLabel }}</div>',
  },
}

describe('AchievementsTab', () => {
  beforeEach(() => {
    state.categories.value = [
      makeCategory({
        key: 'reading',
        label: 'Reading',
        earnedCount: 4,
        totalCount: 6,
        achievements: [
          ...booksFinishedSet(3, 47),
          makeAchievement({ key: 'slow_burn', name: 'Slow Burn', sortOrder: 9 }),
          makeAchievement({
            key: 'marathoner',
            name: 'Marathoner',
            rarity: 'rare',
            sortOrder: 10,
            earned: true,
            awardedAt: '2026-08-19T10:00:00.000Z',
            context: { durationMinutes: 304 },
          }),
        ],
      }),
      makeCategory({
        key: 'devices',
        label: 'Devices',
        earnedCount: 1,
        totalCount: 1,
        achievements: [
          makeAchievement({
            key: 'full_orbit',
            name: 'Full Orbit',
            category: 'devices',
            rarity: 'legendary',
            earned: true,
            awardedAt: '2026-08-17T10:00:00.000Z',
            context: { sources: 3 },
          }),
        ],
      }),
    ]
    state.totalEarned.value = 5
    state.totalAvailable.value = 7
  })

  it('shows the showcase, a shelf per category and filter counts that add up', () => {
    const wrapper = mount(AchievementsTab, { global: { stubs } })
    expect(wrapper.find('section[aria-label="Highlights"]').exists()).toBe(true)
    expect(wrapper.findAll('section[id^="achievements-"]').map((section) => section.attributes('id'))).toEqual([
      'achievements-reading',
      'achievements-devices',
    ])
    const filters = wrapper
      .get('[role="group"]')
      .findAll('button')
      .map((button) => button.text().replace(/\s+/g, ' '))
    expect(filters).toEqual(['All 4', 'Earned 2', 'In progress 1', 'Locked 1'])
  })

  it('narrows the shelves to one bucket and drops the showcase while filtered', async () => {
    const wrapper = mount(AchievementsTab, { global: { stubs } })
    await wrapper.get('[role="group"]').findAll('button')[3]!.trigger('click')
    expect(wrapper.find('section[aria-label="Highlights"]').exists()).toBe(false)
    expect(wrapper.findAll('.medal-tile').map((tile) => tile.attributes('aria-label'))).toEqual(['Slow Burn, Common, Not started'])
  })

  it('opens the detail sheet for a clicked medal with its category', async () => {
    const wrapper = mount(AchievementsTab, { global: { stubs } })
    await wrapper.get('.medal-tile[aria-label^="Story Stalwart"]').trigger('click')
    const sheet = wrapper.get('.sheet-stub')
    expect(sheet.attributes('data-open')).toBe('tiered')
    expect(sheet.text()).toBe('Reading')
  })

  it('hands the open medal the hint for its next tier', async () => {
    hintState.hints.value = new Map([
      ['books_finished_4', { key: 'books_finished_4', kind: 'nearly_finished', count: 1, values: { minPercent: 90, resume: null } }],
      ['slow_burn', { key: 'slow_burn', kind: 'unavailable', values: { reason: 'no_long_book', pages: 1000 } }],
    ])
    const wrapper = mount(AchievementsTab, { global: { stubs } })
    await wrapper.get('.medal-tile[aria-label^="Story Stalwart"]').trigger('click')
    expect(wrapper.get('.sheet-stub').attributes('data-hint')).toBe('books_finished_4')
    await wrapper.get('.medal-tile[aria-label^="Marathoner"]').trigger('click')
    expect(wrapper.get('.sheet-stub').attributes('data-hint')).toBe('')
    hintState.hints.value = new Map()
  })

  it('pairs a short last shelf with the record book', () => {
    const wrapper = mount(AchievementsTab, { global: { stubs } })
    const records = wrapper.get('section[aria-labelledby="achievements-records-title"]')
    expect(records.text()).toContain('Record book')
    expect(records.text()).toContain('5 h 4 min')
    expect(records.element.parentElement?.querySelector('#achievements-devices')).not.toBeNull()
  })

  it('offers a retry when loading fails', async () => {
    state.error.value = true
    const wrapper = mount(AchievementsTab, { global: { stubs } })
    await wrapper.get('[role="alert"] button').trigger('click')
    expect(state.reload).toHaveBeenCalled()
    expect(hintState.reload).toHaveBeenCalled()
    state.error.value = false
  })
})
