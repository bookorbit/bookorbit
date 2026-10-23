import { describe, expect, it } from 'vitest'
import type { AchievementHint } from '@bookorbit/types'
import { mount, RouterLinkStub } from '@vue/test-utils'
import AchievementDetailSheet from '../components/AchievementDetailSheet.vue'
import { groupAchievements } from '../composables/useGroupedAchievements'
import { booksFinishedSet, makeAchievement } from './fixtures'

const stubs = {
  Sheet: { template: '<div><slot /></div>' },
  SheetContent: { template: '<div><slot /></div>' },
  SheetTitle: { template: '<h2><slot /></h2>' },
  SheetDescription: { template: '<p><slot /></p>' },
  RouterLink: RouterLinkStub,
}

function mountSheet(items: ReturnType<typeof makeAchievement>[], hint: AchievementHint | null = null) {
  return mount(AchievementDetailSheet, { props: { item: groupAchievements(items)[0]!, categoryLabel: 'Reading', hint }, global: { stubs } })
}

describe('AchievementDetailSheet', () => {
  it('lists every tier of a set, linking each earned one to the book behind it', () => {
    const wrapper = mountSheet(booksFinishedSet(2, 12))
    expect(wrapper.get('h2').text()).toBe('Spine Scout')
    expect(wrapper.findAll('ol > li')).toHaveLength(4)
    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links.map((link) => link.props('to'))).toEqual(['/book/300', '/book/301'])
    expect(links[1]!.text()).toContain('Book 10 was Book 2')
    expect(wrapper.text()).toContain('12 / 35 books')
  })

  it('tells the moment behind a single achievement', () => {
    const wrapper = mountSheet([
      makeAchievement({
        key: 'marathoner',
        name: 'Marathoner',
        rarity: 'rare',
        earned: true,
        awardedAt: '2026-08-19T10:00:00.000Z',
        context: { durationMinutes: 304 },
      }),
    ])
    expect(wrapper.text()).toContain('The moment')
    expect(wrapper.text()).toContain('One session ran 5 h 4 min')
  })

  it('shows what is left on an achievement in progress', () => {
    const wrapper = mountSheet([makeAchievement({ key: 'wordsmith', name: 'Wordsmith', threshold: 280, currentProgress: 72 })])
    expect(wrapper.text()).toContain('208 to go')
    expect(wrapper.text()).toContain('72 / 280')
  })

  it('says how to get a locked achievement, with the books behind it and a way in', () => {
    const wrapper = mountSheet([makeAchievement({ key: 'slow_burn', name: 'Slow Burn' })], {
      key: 'slow_burn',
      kind: 'stalled_book',
      count: 1,
      bookIds: [180],
      bookTitles: ['The Dead of Winter'],
      values: {
        title: 'The Dead of Winter',
        percent: 91,
        startedAt: '2025-08-12T12:00:00.000Z',
        resume: { bookId: 180, fileId: 186, format: 'epub' },
      },
    })
    expect(wrapper.text()).toContain('How to get it')
    expect(wrapper.text()).toContain('The Dead of Winter is 91% read and was started on Aug 12, 2025.')
    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links.map((link) => link.props('to'))).toEqual([
      '/book/180',
      { name: 'reader', params: { bookId: 180, fileId: 186 }, query: { format: 'epub' } },
    ])
    expect(links[0]!.attributes('aria-label')).toBe('Open The Dead of Winter')
  })

  it('places the hint for a set above its tiers', () => {
    const wrapper = mountSheet(booksFinishedSet(3, 47), {
      key: 'books_finished_4',
      kind: 'unavailable',
      values: { reason: 'nothing_before_year', year: 1900 },
    })
    const text = wrapper.text()
    expect(text.indexOf('Nothing on your shelves was published before 1900.')).toBeGreaterThan(-1)
    expect(text.indexOf('How to get it')).toBeLessThan(text.indexOf('The set'))
  })

  it('shows no hint section without a hint the client can read', () => {
    const wrapper = mountSheet([makeAchievement({ key: 'slow_burn', name: 'Slow Burn' })], {
      key: 'slow_burn',
      kind: 'brand_new_kind',
      values: {},
    } as unknown as AchievementHint)
    expect(wrapper.text()).not.toContain('How to get it')
  })

  it('reveals nothing about a secret', () => {
    const wrapper = mountSheet([makeAchievement({ key: 'reborn', name: 'Secret Achievement', hidden: true })])
    expect(wrapper.get('h2').text()).toBe('Secret Achievement')
    expect(wrapper.text()).toContain('Keep reading to reveal this one.')
  })
})
