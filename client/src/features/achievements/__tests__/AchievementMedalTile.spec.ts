import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AchievementMedalTile from '../components/AchievementMedalTile.vue'
import { groupAchievements } from '../composables/useGroupedAchievements'
import { booksFinishedSet, makeAchievement } from './fixtures'

function mountTile(items: ReturnType<typeof makeAchievement>[]) {
  return mount(AchievementMedalTile, { props: { item: groupAchievements(items)[0]! } })
}

describe('AchievementMedalTile', () => {
  it('names the highest earned tier and the progress toward the next in the set unit', () => {
    const wrapper = mountTile(booksFinishedSet(3, 47))
    const button = wrapper.get('button')
    expect(button.text()).toContain('Story Stalwart')
    expect(button.text()).toContain('Tier 3')
    expect(button.text()).toContain('47 / 100 books')
    expect(button.attributes('aria-label')).toBe('Story Stalwart, Epic, Tier 3, 47 / 100 books')
  })

  it('says a finished set has every tier', () => {
    expect(mountTile(booksFinishedSet(4, null)).text()).toContain('All 4 tiers')
  })

  it('masks a secret and shows no progress for it', () => {
    const wrapper = mountTile([makeAchievement({ key: 'tough_crowd', name: 'Secret Achievement', hidden: true, threshold: 5, currentProgress: 3 })])
    expect(wrapper.text()).toContain('Secret Achievement')
    expect(wrapper.text()).toContain('Keep reading')
    expect(wrapper.text()).not.toContain('3 / 5')
  })

  it('emits its id when opened', async () => {
    const wrapper = mountTile(booksFinishedSet(1, 4))
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['books_finished']])
  })
})
