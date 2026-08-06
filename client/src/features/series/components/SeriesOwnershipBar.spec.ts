import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import SeriesOwnershipBar from './SeriesOwnershipBar.vue'

function mountBar(ownedCount: number, expectedCount: number): VueWrapper {
  return mount(SeriesOwnershipBar, { props: { ownedCount, expectedCount } })
}

function fillStyle(wrapper: VueWrapper): string {
  return wrapper.get('[role="progressbar"] > div').attributes('style') ?? ''
}

describe('SeriesOwnershipBar', () => {
  it('states how many of the series is in the library', () => {
    expect(mountBar(4, 7).text()).toContain('4 of 7 in library')
  })

  it('captions below the track, matching the read-progress bar it sits beside', () => {
    const wrapper = mountBar(4, 7)
    const children = Array.from(wrapper.element.children) as Element[]

    expect(children[0]?.getAttribute('role')).toBe('progressbar')
    expect(children[1]?.tagName).toBe('P')
  })

  it('fills the bar in proportion to what is owned', () => {
    expect(fillStyle(mountBar(4, 7))).toContain('width: 57%')
    expect(fillStyle(mountBar(1, 4))).toContain('width: 25%')
    expect(fillStyle(mountBar(0, 5))).toContain('width: 0%')
  })

  it('marks a complete series distinctly from a partial one', () => {
    expect(mountBar(7, 7).get('[role="progressbar"] > div').classes()).toContain('bg-green-500')
    expect(mountBar(6, 7).get('[role="progressbar"] > div').classes()).toContain('bg-primary')
  })

  it('caps the fill when the library holds more than the provider expects', () => {
    const wrapper = mountBar(9, 7)

    expect(fillStyle(wrapper)).toContain('width: 100%')
    expect(wrapper.get('[role="progressbar"] > div').classes()).toContain('bg-green-500')
  })

  it('does not divide by zero when the expected total is zero', () => {
    const style = fillStyle(mountBar(0, 0))

    expect(style).toContain('width: 0%')
    expect(style).not.toContain('NaN')
  })

  it('exposes progress to assistive technology rather than by colour alone', () => {
    const bar = mountBar(4, 7).get('[role="progressbar"]')

    expect(bar.attributes('aria-valuenow')).toBe('4')
    expect(bar.attributes('aria-valuemin')).toBe('0')
    expect(bar.attributes('aria-valuemax')).toBe('7')
    expect(bar.attributes('aria-valuetext')).toBe('4 of 7 in library')
    expect(bar.attributes('aria-label')).toBe('In library')
  })
})
