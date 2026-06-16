import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { GroupRule } from '@bookorbit/types'
import BookFilterBuilder from '../BookFilterBuilder.vue'

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([]),
    loading: ref(false),
    fetchLibraries: vi.fn<() => Promise<void>>(),
  }),
}))

const incompleteFilter: GroupRule = {
  type: 'group',
  join: 'AND',
  rules: [{ type: 'rule', field: 'title', operator: 'contains' }],
}

function lastUpdate(wrapper: ReturnType<typeof mount<typeof BookFilterBuilder>>) {
  const events = wrapper.emitted('update:modelValue')
  return events?.[events.length - 1]?.[0]
}

describe('BookFilterBuilder', () => {
  it('emits undefined for an incomplete root filter by default', async () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: incompleteFilter,
      },
    })

    await wrapper.get('select').setValue('collection')

    expect(lastUpdate(wrapper)).toBeUndefined()
  })

  it('preserves an incomplete root group when requested', async () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: incompleteFilter,
        preserveIncompleteRoot: true,
      },
    })

    await wrapper.get('select').setValue('collection')

    expect(lastUpdate(wrapper)).toEqual({ type: 'group', join: 'AND', rules: [] })
  })

  it('includes Date Started and Date Finished in field options', () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] },
      },
    })

    const [fieldSelect] = wrapper.findAll('select')
    const optionText = fieldSelect!.findAll('option').map((opt) => opt.text())
    expect(optionText).toContain('Date Started')
    expect(optionText).toContain('Date Finished')
  })

  it('offers date and empty/not-empty operators for Date Started', async () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] },
      },
    })

    const [fieldSelect] = wrapper.findAll('select')
    await fieldSelect!.setValue('startedAt')

    const operatorSelect = wrapper.findAll('select')[1]
    const operatorOptions = operatorSelect!.findAll('option').map((opt) => opt.text())
    expect(operatorOptions).toEqual(expect.arrayContaining(['before', 'after', 'between', 'within last', 'is empty', 'is not empty']))
  })

  it('includes Lock Status in field options', () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] },
      },
    })

    const [fieldSelect] = wrapper.findAll('select')
    const optionText = fieldSelect!.findAll('option').map((opt) => opt.text())
    expect(optionText).toContain('Lock Status')
  })

  it('offers only is locked / is unlocked operators and no value input for Lock Status', async () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] },
      },
    })

    const [fieldSelect] = wrapper.findAll('select')
    await fieldSelect!.setValue('lockStatus')

    const operatorSelect = wrapper.findAll('select')[1]
    const operatorOptions = operatorSelect!.findAll('option').map((opt) => opt.text())
    expect(operatorOptions).toEqual(['is locked', 'is unlocked'])

    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('includes Series Status in field options', () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] },
      },
    })

    const [fieldSelect] = wrapper.findAll('select')
    const optionText = fieldSelect!.findAll('option').map((opt) => opt.text())
    expect(optionText).toContain('Series Status')
  })

  it('offers only is up next and no value input for Series Status', async () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] },
      },
    })

    const [fieldSelect] = wrapper.findAll('select')
    await fieldSelect!.setValue('seriesStatus')

    const operatorSelect = wrapper.findAll('select')[1]
    const operatorOptions = operatorSelect!.findAll('option').map((opt) => opt.text())
    expect(operatorOptions).toEqual(['is up next'])

    expect(wrapper.find('input').exists()).toBe(false)
  })
})
