import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomMetadataFieldSummary, GroupRule } from '@bookorbit/types'
import BookFilterBuilder from '../BookFilterBuilder.vue'

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([]),
    loading: ref(false),
    fetchLibraries: vi.fn<() => Promise<void>>(),
  }),
}))

const customFields = ref<CustomMetadataFieldSummary[]>([])

vi.mock('@/features/book/composables/useActiveCustomFields', () => ({
  useActiveCustomFields: () => ({ fields: customFields }),
  activeCustomFieldLabel: (fieldId: number) => customFields.value.find((f) => f.id === fieldId)?.label ?? null,
}))

function makeCustomField(overrides: Partial<CustomMetadataFieldSummary> = {}): CustomMetadataFieldSummary {
  return { id: 7, label: 'Shelf Location', type: 'text', displayOrder: 0, archivedAt: null, enabledLibraryIds: [], ...overrides }
}

const titleFilter: GroupRule = {
  type: 'group',
  join: 'AND',
  rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }],
}

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
  beforeEach(() => {
    customFields.value = []
  })

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

  it('serializes primary file size input from megabytes to bytes', async () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] },
      },
    })

    await wrapper.findAll('select')[0]!.setValue('fileSize')
    await wrapper.findAll('select')[1]!.setValue('gte')
    await wrapper.get('input[aria-label="Primary file size in megabytes"]').setValue('10.5')

    expect(lastUpdate(wrapper)).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'fileSize', operator: 'gte', value: 11_010_048, valueTo: undefined }],
    })
  })

  it('hydrates saved primary file size bytes as megabytes', () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'fileSize', operator: 'lte', value: 26_214_400 }] },
      },
    })

    expect((wrapper.get('input[aria-label="Primary file size in megabytes"]').element as HTMLInputElement).value).toBe('25')
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

  it('emits community rating rules with provider context', async () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] },
      },
    })

    const [fieldSelect] = wrapper.findAll('select')
    await fieldSelect!.setValue('communityRating')

    const operatorSelect = wrapper.findAll('select')[1]
    await operatorSelect!.setValue('gte')

    await wrapper.get('select[aria-label="Community rating provider"]').setValue('amazon')
    await wrapper.get('input[type="number"]').setValue('4.5')

    expect(lastUpdate(wrapper)).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'communityRating', operator: 'gte', value: 4.5, valueTo: undefined, provider: 'amazon' }],
    })
  })

  it('hydrates the saved community rating provider', () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: {
          type: 'group',
          join: 'AND',
          rules: [{ type: 'rule', field: 'communityRating', operator: 'lt', value: 3, provider: 'goodreads' }],
        },
      },
    })

    expect((wrapper.get('select[aria-label="Community rating provider"]').element as HTMLSelectElement).value).toBe('goodreads')
  })

  it('hydrates missing community rating provider as any provider', () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: {
          type: 'group',
          join: 'AND',
          rules: [{ type: 'rule', field: 'communityRating', operator: 'gte', value: 4.5 }],
        },
      },
    })

    expect((wrapper.get('select[aria-label="Community rating provider"]').element as HTMLSelectElement).value).toBe('any')
  })

  it('serializes a provider-aware community review count rule', async () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] },
      },
    })

    const [fieldSelect] = wrapper.findAll('select')
    await fieldSelect!.setValue('communityRatingCount')
    await wrapper.findAll('select')[1]!.setValue('gte')
    await wrapper.get('select[aria-label="Community rating provider"]').setValue('hardcover')

    const input = wrapper.get('input[type="number"]')
    expect(input.attributes('min')).toBe('0')
    expect(input.attributes('max')).toBeUndefined()
    expect(input.attributes('step')).toBe('1')
    await input.setValue('1000')

    expect(lastUpdate(wrapper)).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'communityRatingCount', operator: 'gte', value: 1000, valueTo: undefined, provider: 'hardcover' }],
    })
  })

  it('hydrates a saved community review count provider', () => {
    const wrapper = mount(BookFilterBuilder, {
      props: {
        modelValue: {
          type: 'group',
          join: 'AND',
          rules: [{ type: 'rule', field: 'communityRatingCount', operator: 'lt', value: 25, provider: 'goodreads' }],
        },
      },
    })

    expect((wrapper.get('select[aria-label="Community rating provider"]').element as HTMLSelectElement).value).toBe('goodreads')
    expect((wrapper.get('input[type="number"]').element as HTMLInputElement).value).toBe('25')
  })
})

describe('BookFilterBuilder custom metadata fields', () => {
  beforeEach(() => {
    customFields.value = []
  })

  function mountWithCustomFields(fields: CustomMetadataFieldSummary[], modelValue: GroupRule = titleFilter) {
    customFields.value = fields
    return mount(BookFilterBuilder, { props: { modelValue } })
  }

  function fieldOptions(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('select')[0]!
  }

  function operatorOptions(wrapper: ReturnType<typeof mount>) {
    return wrapper
      .findAll('select')[1]!
      .findAll('option')
      .map((option) => option.text())
  }

  it('offers no custom field group when none are active', () => {
    const wrapper = mountWithCustomFields([])

    expect(wrapper.find('optgroup').exists()).toBe(false)
  })

  it('lists active custom fields in their own group, ordered and labelled verbatim', () => {
    const wrapper = mountWithCustomFields([
      makeCustomField({ id: 7, label: 'Shelf Location', displayOrder: 1 }),
      makeCustomField({ id: 3, label: 'Condition', displayOrder: 0 }),
    ])

    const group = wrapper.get('optgroup')
    expect(group.attributes('label')).toBe('Custom fields')
    expect(group.findAll('option').map((option) => [option.attributes('value'), option.text()])).toEqual([
      ['custom:3', 'Condition'],
      ['custom:7', 'Shelf Location'],
    ])
  })

  it('omits archived custom fields', () => {
    const wrapper = mountWithCustomFields([makeCustomField({ archivedAt: '2026-01-01T00:00:00.000Z' })])

    expect(wrapper.find('optgroup').exists()).toBe(false)
  })

  it('keeps a rule pointing at a since-archived field selectable', () => {
    const wrapper = mountWithCustomFields([makeCustomField({ id: 3, label: 'Condition' })], {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'custom:7', operator: 'contains', value: 'A3' }],
    })

    const values = wrapper
      .get('optgroup')
      .findAll('option')
      .map((option) => option.attributes('value'))
    expect(values).toEqual(['custom:3', 'custom:7'])
    expect((fieldOptions(wrapper).element as HTMLSelectElement).value).toBe('custom:7')
  })

  it.each([
    ['text', ['contains', 'does not contain', 'starts with', 'ends with', 'is', 'is not', 'is empty', 'is not empty']],
    ['url', ['contains', 'does not contain', 'starts with', 'ends with', 'is', 'is not', 'is empty', 'is not empty']],
    ['number', ['is', 'is not', 'greater than', 'at least', 'less than', 'at most', 'between', 'is empty', 'is not empty']],
    ['date', ['before', 'after', 'between', 'within last', 'is empty', 'is not empty']],
    ['boolean', ['is yes', 'is no', 'is empty', 'is not empty']],
  ] as const)('offers only the operators a %s custom field supports', async (type, expected) => {
    const wrapper = mountWithCustomFields([makeCustomField({ type })])

    await fieldOptions(wrapper).setValue('custom:7')

    expect(operatorOptions(wrapper)).toEqual(expected)
  })

  it('emits a text custom field rule with its string value', async () => {
    const wrapper = mountWithCustomFields([makeCustomField({ type: 'text' })])

    await fieldOptions(wrapper).setValue('custom:7')
    await wrapper.get('input').setValue('A3')

    expect(lastUpdate(wrapper)).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'custom:7', operator: 'contains', value: 'A3', valueTo: undefined }],
    })
  })

  it('emits a number custom field rule with numeric bounds', async () => {
    const wrapper = mountWithCustomFields([makeCustomField({ type: 'number' })])

    await fieldOptions(wrapper).setValue('custom:7')
    await wrapper.findAll('select')[1]!.setValue('between')
    const inputs = wrapper.findAll('input[type="number"]')
    await inputs[0]!.setValue('2')
    await inputs[1]!.setValue('9')

    expect(lastUpdate(wrapper)).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'custom:7', operator: 'between', value: 2, valueTo: 9 }],
    })
  })

  it('emits a date custom field rule with a date value', async () => {
    const wrapper = mountWithCustomFields([makeCustomField({ type: 'date' })])

    await fieldOptions(wrapper).setValue('custom:7')
    const valueInput = wrapper.get('input')
    expect(valueInput.attributes('type')).toBe('date')
    await valueInput.setValue('2024-05-01')

    expect(lastUpdate(wrapper)).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'custom:7', operator: 'before', value: '2024-05-01', valueTo: undefined }],
    })
  })

  it('converts a within last unit to days for a date custom field', async () => {
    const wrapper = mountWithCustomFields([makeCustomField({ type: 'date' })])

    await fieldOptions(wrapper).setValue('custom:7')
    await wrapper.findAll('select')[1]!.setValue('withinLast')
    await wrapper.get('input[type="number"]').setValue('2')
    await wrapper.findAll('select')[2]!.setValue('weeks')

    expect(lastUpdate(wrapper)).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'custom:7', operator: 'withinLast', value: 14, valueTo: undefined }],
    })
  })

  it('emits a boolean custom field rule with no value input at all', async () => {
    const wrapper = mountWithCustomFields([makeCustomField({ type: 'boolean' })])

    await fieldOptions(wrapper).setValue('custom:7')

    expect(wrapper.find('input').exists()).toBe(false)
    expect(lastUpdate(wrapper)).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'custom:7', operator: 'isTrue', value: undefined, valueTo: undefined }],
    })
  })

  it('resets an operator that does not carry over when switching to a custom field', async () => {
    const wrapper = mountWithCustomFields([makeCustomField({ type: 'number' })])

    await fieldOptions(wrapper).setValue('custom:7')

    expect((wrapper.findAll('select')[1]!.element as HTMLSelectElement).value).toBe('eq')
  })

  it('never sends a provider on a custom field rule', async () => {
    const wrapper = mountWithCustomFields([makeCustomField({ type: 'text' })], {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'communityRating', operator: 'gte', value: 4, provider: 'amazon' }],
    })

    await fieldOptions(wrapper).setValue('custom:7')
    await wrapper.get('input').setValue('A3')

    expect(lastUpdate(wrapper)).toEqual({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'custom:7', operator: 'contains', value: 'A3', valueTo: undefined }],
    })
  })
})
