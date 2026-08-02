import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { CustomMetadataFieldSummary, SortSpec } from '@bookorbit/types'
import BookSortBuilder from '../BookSortBuilder.vue'

const customFields = ref<CustomMetadataFieldSummary[]>([])

vi.mock('@/features/book/composables/useActiveCustomFields', () => ({
  useActiveCustomFields: () => ({ fields: customFields }),
  activeCustomFieldLabel: (fieldId: number) => customFields.value.find((f) => f.id === fieldId)?.label ?? null,
}))

function makeField(overrides: Partial<CustomMetadataFieldSummary> = {}): CustomMetadataFieldSummary {
  return { id: 7, label: 'Shelf Location', type: 'text', displayOrder: 0, archivedAt: null, enabledLibraryIds: [], ...overrides }
}

function mountBuilder(modelValue: SortSpec[]) {
  return mount(BookSortBuilder, {
    props: { modelValue },
    global: {
      stubs: {
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('BookSortBuilder', () => {
  it('offers no custom field group when none are active', () => {
    customFields.value = []

    const wrapper = mountBuilder([{ field: 'title', dir: 'asc' }])

    expect(wrapper.find('optgroup').exists()).toBe(false)
  })

  it('lists active custom fields in their own group, labelled verbatim', () => {
    customFields.value = [makeField({ id: 7, label: 'Shelf Location', displayOrder: 1 }), makeField({ id: 3, label: 'Condition', displayOrder: 0 })]

    const wrapper = mountBuilder([{ field: 'title', dir: 'asc' }])
    const group = wrapper.get('optgroup')

    expect(group.attributes('label')).toBe('Custom fields')
    expect(group.findAll('option').map((o) => [o.attributes('value'), o.text()])).toEqual([
      ['custom:3', 'Condition'],
      ['custom:7', 'Shelf Location'],
    ])
  })

  it('omits archived custom fields', () => {
    customFields.value = [makeField({ id: 7, archivedAt: '2026-01-01T00:00:00.000Z' })]

    const wrapper = mountBuilder([{ field: 'title', dir: 'asc' }])

    expect(wrapper.find('optgroup').exists()).toBe(false)
  })

  it('emits a custom sort field when one is selected', async () => {
    customFields.value = [makeField({ id: 7 })]

    const wrapper = mountBuilder([{ field: 'title', dir: 'asc' }])
    await wrapper.get('select').setValue('custom:7')

    const events = wrapper.emitted('update:modelValue')
    expect(events?.[events.length - 1]?.[0]).toEqual([{ field: 'custom:7', dir: 'asc' }])
  })

  it('does not offer a custom field that is already used by another tier', () => {
    customFields.value = [makeField({ id: 7 })]

    const wrapper = mountBuilder([
      { field: 'custom:7', dir: 'asc' },
      { field: 'title', dir: 'asc' },
    ])
    const secondTierGroup = wrapper.findAll('optgroup')[1]

    expect(secondTierGroup?.findAll('option')).toHaveLength(0)
  })
})
