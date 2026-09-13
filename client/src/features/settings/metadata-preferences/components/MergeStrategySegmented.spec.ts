import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MergeStrategySegmented from './MergeStrategySegmented.vue'

describe('MergeStrategySegmented', () => {
  it('offers merge-with-existing only for genre fields', async () => {
    const standard = mount(MergeStrategySegmented, { props: { modelValue: 'fillMissing' } })
    const genres = mount(MergeStrategySegmented, {
      props: { modelValue: 'mergeExisting', allowMergeExisting: true },
    })

    expect(standard.findAll('[role="radio"]')).toHaveLength(3)
    expect(standard.text()).not.toContain('Merge')
    expect(genres.findAll('[role="radio"]')).toHaveLength(4)
    expect(genres.text()).toContain('Merge')

    await genres.findAll('[role="radio"]')[2]!.trigger('click')
    expect(genres.emitted('update:modelValue')).toEqual([['overwriteIfProvided']])
  })
})
