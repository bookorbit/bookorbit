import { describe, expect, it } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import type { AchievementHint, AchievementItem } from '@bookorbit/types'
import AchievementShowcase from '../components/AchievementShowcase.vue'
import { groupAchievements } from '../composables/useGroupedAchievements'
import { booksFinishedSet, makeAchievement, makeCategory } from './fixtures'

function mountShowcase(items: AchievementItem[], hints: AchievementHint[] = []) {
  return mount(AchievementShowcase, {
    global: { stubs: { RouterLink: RouterLinkStub } },
    props: {
      hints: new Map(hints.map((hint) => [hint.key, hint])),
      categories: [makeCategory({ key: 'reading', label: 'Reading', achievements: items })],
      items,
      displayItems: groupAchievements(items),
      totalEarned: items.filter((item) => item.earned).length,
      totalAvailable: items.length,
      inProgressCount: 2,
    },
  })
}

describe('AchievementShowcase', () => {
  const now = new Date().toISOString()
  const items = [
    ...booksFinishedSet(3, 47),
    makeAchievement({ key: 'new_year_reader', name: 'New Year Reader', rarity: 'epic', hidden: true, sortOrder: 30, earned: true, awardedAt: now }),
    makeAchievement({
      key: 'hours',
      name: 'Chronicle Veteran',
      groupKey: 'hours_read',
      tier: 3,
      rarity: 'epic',
      sortOrder: 40,
      threshold: 500,
      currentProgress: 474,
    }),
  ]

  it('leads with the newest unlock and counts what landed today', () => {
    const wrapper = mountShowcase(items)
    expect(wrapper.get('h2').text()).toBe('New Year Reader')
    expect(wrapper.text()).toContain('1 new today')
    expect(wrapper.text()).toContain('Secret revealed')
  })

  it('puts the closest unlock first, with what is left in its unit', () => {
    const wrapper = mountShowcase(items)
    expect(wrapper.text()).toContain('Chronicle Veteran')
    expect(wrapper.text()).toContain('26 hours to go')
    expect(wrapper.text()).toContain('474 / 500 hours')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('95')
  })

  it('says how to get the closest unlock once its hint arrives', () => {
    const wrapper = mountShowcase(items, [{ key: 'hours', kind: 'reading_pace', values: { hours: 44, days: 30, remaining: 26, etaDays: 18 } }])
    expect(wrapper.text()).toContain('You read 44 hours in the last 30 days. About 3 weeks at this pace.')
  })

  it('offers to resume the book a hint names', () => {
    const wrapper = mountShowcase(items, [
      {
        key: 'hours',
        kind: 'nearly_finished',
        count: 1,
        bookIds: [112],
        bookTitles: ['The Elements'],
        values: { minPercent: 90, resume: { bookId: 112, fileId: 118, format: 'epub' } },
      },
    ])
    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links.map((link) => link.attributes('aria-label') ?? link.text())).toEqual(['Open The Elements', 'Continue reading'])
    expect(links[1]!.props('to')).toEqual({ name: 'reader', params: { bookId: 112, fileId: 118 }, query: { format: 'epub' } })
  })

  it('drops an achievement that cannot be earned from the closest unlocks', () => {
    const wrapper = mountShowcase(items, [{ key: 'hours', kind: 'unavailable', values: { reason: 'no_long_book', pages: 1000 } }])
    expect(wrapper.text()).not.toContain('Chronicle Veteran')
    expect(wrapper.text()).toContain('Grand Archivist')
  })

  it('reads the tier total as one sentence', () => {
    expect(mountShowcase(items).text()).toMatch(/4\s*of 6 tiers earned/)
  })

  it('invites a first unlock when nothing is earned yet', () => {
    const wrapper = mountShowcase([makeAchievement({ key: 'first' })])
    expect(wrapper.text()).toContain('Your first medal is waiting')
    expect(wrapper.text()).toContain('Nothing is counting toward a medal yet.')
  })

  it('emits open for a medal and asks to show everything in progress', async () => {
    const wrapper = mountShowcase(items)
    await wrapper.get('button[aria-label="Open New Year Reader"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().startsWith('All 2'))!
      .trigger('click')
    expect(wrapper.emitted('open')).toEqual([['new_year_reader']])
    expect(wrapper.emitted('showInProgress')).toHaveLength(1)
  })
})
