import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { DEFAULT_METADATA_SCORE_WEIGHTS, type MetadataScoreWeights } from '@bookorbit/types'
import ScoreWeightsLedger from '../components/ScoreWeightsLedger.vue'

const defaults = (): MetadataScoreWeights => ({ ...DEFAULT_METADATA_SCORE_WEIGHTS })

function render(props: Partial<{ weights: MetadataScoreWeights; saved: MetadataScoreWeights; query: string; disabled: boolean }> = {}) {
  return mount(ScoreWeightsLedger, {
    props: {
      weights: props.weights ?? defaults(),
      saved: props.saved ?? defaults(),
      query: props.query ?? '',
      disabled: props.disabled ?? false,
    },
  })
}

describe('ScoreWeightsLedger', () => {
  it('shows what a field is worth as a share rather than only its raw weight', () => {
    const text = render().text()
    // Title is 10 of 78 points, and one decimal keeps it distinct from Description at 10.3%.
    expect(text).toContain('12.8%')
    expect(text).toContain('10.3%')
  })

  it('ranks the heaviest field first', () => {
    const names = render()
      .findAll('p.font-semibold')
      .map((node) => node.text())
    expect(names[0]).toBe('Title')
  })

  it('separates switched-off fields into their own section instead of showing a bare zero', () => {
    const wrapper = render()
    expect(wrapper.text()).toContain('Not scored (3)')
    expect(wrapper.text()).toContain('A field at zero leaves the total too')
  })

  it('moves a field into the not-scored section when it is zeroed', () => {
    const wrapper = render({ weights: { ...defaults(), description: 0 } })
    expect(wrapper.text()).toContain('Not scored (4)')
  })

  it('renders a spinbutton per field, labelled by the visible field name', () => {
    const wrapper = render()
    const inputs = wrapper.findAll('input[type="number"]')
    expect(inputs).toHaveLength(24)
    expect(inputs[0].attributes('aria-labelledby')).toBe('score-field-title')
    expect(wrapper.find('#score-field-title').text()).toBe('Title')
  })

  it('marks a changed field with its delta from the saved value', () => {
    const wrapper = render({ weights: { ...defaults(), title: 14 } })
    expect(wrapper.text()).toContain('+4')
  })

  it('filters by field name and offers a way back', async () => {
    const wrapper = render({ query: 'isbn' })
    const names = wrapper.findAll('p.font-semibold').map((node) => node.text())
    expect(names).toEqual(['ISBN-13', 'ISBN-10'])

    const empty = render({ query: 'nothing matches this' })
    expect(empty.text()).toContain('No fields match that search.')
    await empty.find('button').trigger('click')
    expect(empty.emitted('clearQuery')).toHaveLength(1)
  })

  it('disables every control when the viewer cannot edit', () => {
    const wrapper = render({ disabled: true })
    expect(wrapper.findAll('input[type="number"]').every((input) => input.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
  })

  it('emits an adjustment when a stepper is pressed', async () => {
    const wrapper = render()
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('adjust')?.[0]).toEqual(['title', -1])
  })
})
