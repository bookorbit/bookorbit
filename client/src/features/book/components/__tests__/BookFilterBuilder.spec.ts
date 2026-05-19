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
})
