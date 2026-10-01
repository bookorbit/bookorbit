import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LibraryCreatorReading from '../LibraryCreatorReading.vue'

function mountReading(readingThreshold = 0.25, markAsFinishedPercentComplete = 98) {
  return mount(LibraryCreatorReading, { props: { readingThreshold, markAsFinishedPercentComplete } })
}

describe('LibraryCreatorReading', () => {
  it('shows and emits a finished threshold at the requested 0.05% precision', async () => {
    const wrapper = mountReading(0.25, 99.95)

    const input = wrapper.get<HTMLInputElement>('#finished-threshold')
    expect(input.attributes('step')).toBe('0.05')
    expect(input.attributes('min')).toBe('90')
    expect(input.attributes('max')).toBe('100')
    expect(wrapper.text()).toContain('99.95%')

    await input.setValue('98.05')
    expect(wrapper.emitted('update:markAsFinishedPercentComplete')).toContainEqual([98.05])
  })

  it('labels both thresholds and describes their ranges', async () => {
    const wrapper = mountReading()

    expect(wrapper.get('label[for="reading-threshold"]').text()).toBe('Reading start')
    expect(wrapper.get('#reading-threshold-help').text()).toContain('Between 0.05% and 5%.')

    await wrapper.get('#reading-threshold').setValue('')
    expect(wrapper.emitted('update:readingThreshold')).toBeUndefined()
    await wrapper.get('#reading-threshold').setValue('1.5')
    expect(wrapper.emitted('update:readingThreshold')).toEqual([[1.5]])
  })

  it('drags each end over its own range only', async () => {
    const wrapper = mountReading()
    const start = wrapper.get<HTMLInputElement>('#reading-threshold-slider')
    const finish = wrapper.get<HTMLInputElement>('#finished-threshold-slider')

    expect([start.attributes('min'), start.attributes('max'), start.attributes('step')]).toEqual(['0.05', '5', '0.05'])
    expect([finish.attributes('min'), finish.attributes('max')]).toEqual(['90', '100'])

    await start.setValue('1.5')
    await finish.setValue('97.5')
    expect(wrapper.emitted('update:readingThreshold')).toEqual([[1.5]])
    expect(wrapper.emitted('update:markAsFinishedPercentComplete')).toEqual([[97.5]])
  })

  it('snaps the finish slider to round values while the field keeps full precision', () => {
    const wrapper = mountReading()

    expect(wrapper.get('#finished-threshold-slider').attributes('step')).toBe('0.25')
    expect(wrapper.get('#finished-threshold').attributes('step')).toBe('0.05')
  })

  it('names the sliders and announces their values as percentages', () => {
    const wrapper = mountReading(0.25, 98)

    const start = wrapper.get('#reading-threshold-slider')
    expect(start.attributes('aria-label')).toBe('Drag to set when a book counts as started')
    expect(start.attributes('aria-valuetext')).toBe('0.25%')
    expect(wrapper.get('#finished-threshold-slider').attributes('aria-valuetext')).toBe('98%')
  })

  it('pins an out-of-range value to the end of its slider rather than past it', () => {
    const wrapper = mountReading(9, 80)

    expect(wrapper.get('#reading-threshold-slider').attributes('style')).toContain('--fraction: 1')
    expect(wrapper.get('#finished-threshold-slider').attributes('style')).toContain('--fraction: 0')
  })
})
