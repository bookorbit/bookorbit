import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { momentBookId, momentOf, recordBook, type MomentMessage } from '../lib/achievement-moments'
import { useMomentText } from '../composables/useMomentText'
import { makeAchievement } from './fixtures'

function render(message: MomentMessage | null): string {
  if (!message) return ''
  const Probe = defineComponent({
    setup() {
      const { momentText } = useMomentText()
      return () => h('span', momentText(message))
    },
  })
  return mount(Probe).text()
}

describe('momentOf', () => {
  it('names the book behind a books-finished tier', () => {
    const item = makeAchievement({
      key: 'books_finished_2',
      groupKey: 'books_finished',
      tier: 2,
      earned: true,
      context: { count: 14, bookId: 311, bookTitle: 'Armada' },
    })
    expect(render(momentOf(item))).toBe('Book 14 was Armada')
    expect(momentBookId(item)).toBe(311)
  })

  it('resolves a nested duration message', () => {
    const item = makeAchievement({ key: 'marathoner', earned: true, context: { durationMinutes: 304 } })
    expect(render(momentOf(item))).toBe('One session ran 5 h 4 min')
  })

  it('formats counts with the plural form and locale grouping', () => {
    const item = makeAchievement({ key: 'power_hour', earned: true, context: { pages: 1698 } })
    expect(render(momentOf(item))).toBe('1,698 pages in one session')
  })

  it('returns nothing for an unknown key, a missing field, or an achievement not yet earned', () => {
    expect(momentOf(makeAchievement({ key: 'brand_new', earned: true, context: { count: 3 } }))).toBeNull()
    expect(momentOf(makeAchievement({ key: 'books_finished_2', groupKey: 'books_finished', earned: true, context: { count: 14 } }))).toBeNull()
    expect(momentOf(makeAchievement({ key: 'marathoner', earned: false, context: { durationMinutes: 304 } }))).toBeNull()
    expect(momentOf(makeAchievement({ key: 'marathoner', earned: true, context: { durationMinutes: 'long' } }))).toBeNull()
  })
})

describe('recordBook', () => {
  it('keeps the highest earned tier of each set, rarest first, up to the limit', () => {
    const items = [
      makeAchievement({ key: 'annotator_2', groupKey: 'annotator', tier: 2, rarity: 'rare', sortOrder: 5, earned: true, context: { count: 60 } }),
      makeAchievement({
        key: 'annotator_4',
        groupKey: 'annotator',
        tier: 4,
        rarity: 'legendary',
        sortOrder: 7,
        earned: true,
        context: { count: 1652 },
      }),
      makeAchievement({ key: 'marathoner', rarity: 'rare', sortOrder: 2, earned: true, context: { durationMinutes: 95 } }),
      makeAchievement({ key: 'speed_reader', rarity: 'epic', sortOrder: 3, earned: true, context: { pages: 120 } }),
      makeAchievement({ key: 'power_hour', rarity: 'rare', sortOrder: 4, earned: false, context: { pages: 200 } }),
    ]
    const records = recordBook(items, 3)
    expect(records.map((entry) => entry.item.key)).toEqual(['annotator_4', 'speed_reader', 'marathoner'])
    expect(render(records[0]!.value)).toBe('1,652')
    expect(render(records[2]!.value)).toBe('1 h 35 min')
  })
})
