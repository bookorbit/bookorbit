import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import AchievementMedal from '../components/AchievementMedal.vue'
import { MEDAL_SHAPES, medalRarity, pipPositions, progressDash } from '../lib/medal-geometry'

describe('AchievementMedal', () => {
  it('draws an earned medal in its rarity silhouette and is hidden from assistive tech', () => {
    const wrapper = mount(AchievementMedal, { props: { rarity: 'legendary', icon: 'trophy' } })
    const svg = wrapper.get('svg.achievement-medal')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.classes()).toContain('achievement-medal--earned')
    expect(wrapper.findAll('path').some((path) => path.attributes('d') === MEDAL_SHAPES.legendary)).toBe(true)
  })

  it('gives every instance in one page its own gradient ids', () => {
    const Pair = defineComponent({
      components: { AchievementMedal },
      template: '<div><AchievementMedal rarity="rare" icon="star" /><AchievementMedal rarity="rare" icon="star" /></div>',
    })
    const ids = mount(Pair)
      .findAll('linearGradient')
      .map((gradient) => gradient.attributes('id'))
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('draws a progress ring only on a locked medal with progress', () => {
    const locked = mount(AchievementMedal, { props: { rarity: 'epic', icon: 'clock', state: 'locked', progress: 0.5 } })
    const arc = locked.findAll('circle').find((circle) => circle.attributes('stroke-dasharray')?.includes(' '))
    expect(arc).toBeDefined()
    const empty = mount(AchievementMedal, { props: { rarity: 'epic', icon: 'clock', state: 'locked', progress: null } })
    expect(empty.findAll('circle').some((circle) => circle.attributes('stroke-linecap') === 'round' && circle.attributes('transform'))).toBe(false)
  })

  it('shows a question mark instead of the icon for a secret', () => {
    const wrapper = mount(AchievementMedal, { props: { rarity: 'common', icon: 'lock', state: 'secret' } })
    expect(wrapper.get('text').text()).toBe('?')
  })

  it('adds no sheen unless asked, and one pip per tier', () => {
    const plain = mount(AchievementMedal, {
      props: {
        rarity: 'epic',
        icon: 'book-open',
        pips: [
          { rarity: 'common', earned: true },
          { rarity: 'rare', earned: true },
          { rarity: 'epic', earned: false },
        ],
      },
    })
    expect(plain.find('.achievement-medal__sheen').exists()).toBe(false)
    expect(plain.findAll('circle[r="3.6"]')).toHaveLength(2)
    expect(plain.findAll('circle[r="3.2"]')).toHaveLength(1)
    const hero = mount(AchievementMedal, { props: { rarity: 'epic', icon: 'book-open', sheen: 'intro' } })
    expect(hero.find('.achievement-medal__sheen').exists()).toBe(true)
    expect(hero.get('svg').classes()).toContain('achievement-medal--sheen-intro')
  })
})

describe('medal geometry', () => {
  it('falls back to common for a rarity this build does not know', () => {
    expect(medalRarity('mythic')).toBe('common')
    expect(medalRarity('epic')).toBe('epic')
  })

  it('spreads pips symmetrically around the bottom of the rim', () => {
    const [first, , , last] = pipPositions(4)
    expect(first![1]).toBeCloseTo(last![1])
    expect(first![0] - 50).toBeCloseTo(50 - last![0])
  })

  it('clamps the progress arc', () => {
    expect(progressDash(2).dash).toBeCloseTo(progressDash(1).length)
    expect(progressDash(-1).dash).toBe(0)
  })
})
