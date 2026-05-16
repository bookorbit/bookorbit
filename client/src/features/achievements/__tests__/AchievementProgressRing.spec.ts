import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AchievementProgressRing from '../components/AchievementProgressRing.vue'

async function mountRing(percent: number, color = 'text-sky-400', size?: number) {
  const wrapper = mount(AchievementProgressRing, {
    props: { percent, color, size },
  })
  await wrapper.vm.$nextTick()
  return wrapper
}

function getCircles(wrapper: Awaited<ReturnType<typeof mountRing>>) {
  const circles = wrapper.findAll('circle')
  return { track: circles[0]!, fill: circles[1]! }
}

describe('AchievementProgressRing', () => {
  it('renders an SVG element', async () => {
    const wrapper = await mountRing(50)
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('renders two circles - track and fill', async () => {
    const wrapper = await mountRing(50)
    expect(wrapper.findAll('circle')).toHaveLength(2)
  })

  it('applies the color class to the progress (fill) circle', async () => {
    const wrapper = await mountRing(75, 'text-emerald-400')
    const { fill } = getCircles(wrapper)
    expect(fill.classes()).toContain('text-emerald-400')
  })

  it('uses the default size of 32 when size prop is not provided', async () => {
    const wrapper = await mountRing(50)
    const svg = wrapper.find('svg')
    expect(svg.attributes('width')).toBe('32')
    expect(svg.attributes('height')).toBe('32')
  })

  it('uses the provided size prop', async () => {
    const wrapper = await mountRing(50, 'text-sky-400', 48)
    const svg = wrapper.find('svg')
    expect(svg.attributes('width')).toBe('48')
    expect(svg.attributes('height')).toBe('48')
  })

  it('sets a positive stroke-dasharray on the fill circle', async () => {
    const wrapper = await mountRing(50)
    const { fill } = getCircles(wrapper)
    const dasharray = Number(fill.attributes('stroke-dasharray'))
    expect(dasharray).toBeGreaterThan(0)
  })

  it('has zero dashoffset for 100% fill after mount', async () => {
    const wrapper = await mountRing(100)
    const { fill } = getCircles(wrapper)
    const dashoffset = Number(fill.attributes('stroke-dashoffset'))
    expect(dashoffset).toBeCloseTo(0)
  })

  it('has full dashoffset for 0% fill after mount', async () => {
    const wrapper = await mountRing(0)
    const { fill } = getCircles(wrapper)
    const dasharray = Number(fill.attributes('stroke-dasharray'))
    const dashoffset = Number(fill.attributes('stroke-dashoffset'))
    expect(dashoffset).toBeCloseTo(dasharray)
  })

  it('has half dashoffset for 50% fill after mount', async () => {
    const wrapper = await mountRing(50)
    const { fill } = getCircles(wrapper)
    const dasharray = Number(fill.attributes('stroke-dasharray'))
    const dashoffset = Number(fill.attributes('stroke-dashoffset'))
    expect(dashoffset).toBeCloseTo(dasharray / 2, 0)
  })

  it('clamps percent to 0 for negative values', async () => {
    const wrapper = await mountRing(-20)
    const { fill } = getCircles(wrapper)
    const dasharray = Number(fill.attributes('stroke-dasharray'))
    const dashoffset = Number(fill.attributes('stroke-dashoffset'))
    expect(dashoffset).toBeCloseTo(dasharray)
  })

  it('clamps percent to 100 for values over 100', async () => {
    const wrapper = await mountRing(150)
    const { fill } = getCircles(wrapper)
    const dashoffset = Number(fill.attributes('stroke-dashoffset'))
    expect(dashoffset).toBeCloseTo(0)
  })

  it('applies -rotate-90 class to the SVG for correct starting angle', async () => {
    const wrapper = await mountRing(50)
    expect(wrapper.find('svg').classes()).toContain('-rotate-90')
  })

  it('includes transition class on the fill circle for animation', async () => {
    const wrapper = await mountRing(50)
    const { fill } = getCircles(wrapper)
    expect(fill.classes()).toContain('duration-700')
  })
})
