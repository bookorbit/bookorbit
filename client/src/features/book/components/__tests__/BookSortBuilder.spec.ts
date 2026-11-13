import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

interface StubOption {
  value: string
  label: string
}

// The picker's own popover is reka's; here it lists its fields as buttons so a pick is one click.
const FieldPickerPopover = {
  name: 'FieldPickerPopover',
  props: ['open', 'groups', 'selected', 'exclude', 'title'],
  emits: ['pick', 'update:open'],
  computed: {
    options(this: { groups: { options: StubOption[] }[]; exclude?: string[] }) {
      return this.groups.flatMap((group) => group.options).filter((option) => !(this.exclude ?? []).includes(option.value))
    },
  },
  template: `<div class="picker" :data-title="title" :data-selected="selected"><slot name="trigger" /><button v-for="option in options" :key="option.value" type="button" class="pick" :data-value="option.value" @click="$emit('pick', option.value)">{{ option.label }}</button></div>`,
}

function mountBuilder(modelValue: SortSpec[], collectionScoped = false) {
  return mount(BookSortBuilder, { props: { modelValue, collectionScoped }, global: { stubs: { FieldPickerPopover } } })
}

function lastSort(wrapper: ReturnType<typeof mountBuilder>) {
  const events = wrapper.emitted<[SortSpec[]]>('update:modelValue')
  return events?.[events.length - 1]?.[0]
}

function pickerOptions(wrapper: ReturnType<typeof mountBuilder>, index: number) {
  return wrapper
    .findAll('.picker')
    [index]!.findAll('.pick')
    .map((button) => button.attributes('data-value'))
}

describe('BookSortBuilder', () => {
  beforeEach(() => {
    customFields.value = []
  })

  it('reads an empty sort as the default and saves it on the first change', async () => {
    const wrapper = mountBuilder([])

    expect(wrapper.text()).toContain('Sort by')
    expect(wrapper.get('.picker').attributes('data-selected')).toBe('title')
    expect(wrapper.get('button[aria-pressed="true"]').text()).toBe('A → Z')

    const desc = wrapper.findAll('button[aria-pressed]').find((button) => button.text() === 'Z → A')!
    await desc.trigger('click')

    expect(lastSort(wrapper)).toEqual([{ field: 'title', dir: 'desc' }])
  })

  it('sorts by a newly picked field in its natural order and keeps the other levels', async () => {
    const wrapper = mountBuilder([
      { field: 'title', dir: 'asc' },
      { field: 'author', dir: 'asc' },
    ])

    await wrapper.get('.picker .pick[data-value="addedAt"]').trigger('click')

    expect(lastSort(wrapper)).toEqual([
      { field: 'addedAt', dir: 'desc' },
      { field: 'author', dir: 'asc' },
    ])
  })

  it('adds a then-by level in its natural order without offering fields already used', async () => {
    const wrapper = mountBuilder([{ field: 'title', dir: 'asc' }])
    const addPicker = wrapper.findAll('.picker').at(-1)!
    expect(addPicker.attributes('data-title')).toBe('Then by')
    expect(pickerOptions(wrapper, 1)).not.toContain('title')

    await addPicker.get('.pick[data-value="rating"]').trigger('click')

    expect(lastSort(wrapper)).toEqual([
      { field: 'title', dir: 'asc' },
      { field: 'rating', dir: 'desc' },
    ])
  })

  it('switches and removes a then-by level', async () => {
    const wrapper = mountBuilder([
      { field: 'title', dir: 'asc' },
      { field: 'addedAt', dir: 'desc' },
    ])

    const level = wrapper.get('[data-testid="sort-sentence-level"]')
    expect(level.text()).toContain('then by')
    await level.get('button[aria-label="Date Added: Newest first. Switch"]').trigger('click')
    expect(lastSort(wrapper)).toEqual([
      { field: 'title', dir: 'asc' },
      { field: 'addedAt', dir: 'asc' },
    ])

    await level.get('button[aria-label="Remove Date Added"]').trigger('click')
    expect(lastSort(wrapper)).toEqual([{ field: 'title', dir: 'asc' }])
  })

  it('stops offering "Then by" once a random sort leads', () => {
    const wrapper = mountBuilder([{ field: 'random', dir: 'asc' }])

    expect(wrapper.findAll('.picker')).toHaveLength(1)
    expect(wrapper.find('button[aria-pressed]').exists()).toBe(false)
  })

  // The server rejects collectionOrder outside a collection, so offering it in a smart scope or a
  // home shelf would hand the user a sort that 400s.
  it('offers collection-scoped sort fields only inside a collection', () => {
    expect(pickerOptions(mountBuilder([{ field: 'title', dir: 'asc' }]), 0)).not.toContain('collectionOrder')
    expect(pickerOptions(mountBuilder([{ field: 'title', dir: 'asc' }], true), 0)).toContain('collectionOrder')
  })

  it('lists active custom fields labelled verbatim and leaves out archived ones', () => {
    customFields.value = [
      makeField({ id: 7, label: 'Shelf Location', displayOrder: 1 }),
      makeField({ id: 3, label: 'Condition', displayOrder: 0 }),
      makeField({ id: 9, label: 'Old Field', archivedAt: '2026-01-01T00:00:00.000Z' }),
    ]

    const picker = mountBuilder([{ field: 'title', dir: 'asc' }]).findAll('.picker')[0]!
    const custom = picker.findAll('.pick').filter((button) => button.attributes('data-value')!.startsWith('custom:'))

    expect(custom.map((button) => [button.attributes('data-value'), button.text()])).toEqual([
      ['custom:3', 'Condition'],
      ['custom:7', 'Shelf Location'],
    ])
  })

  it('does not offer a custom field another level already uses', () => {
    customFields.value = [makeField({ id: 7 })]

    const wrapper = mountBuilder([
      { field: 'title', dir: 'asc' },
      { field: 'custom:7', dir: 'asc' },
    ])

    expect(pickerOptions(wrapper, 0)).not.toContain('custom:7')
    expect(pickerOptions(wrapper, 2)).not.toContain('custom:7')
  })
})
