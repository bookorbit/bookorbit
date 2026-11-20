import { mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CUSTOM_FIELD_TYPE_OPERATORS, type CustomMetadataFieldSummary, type GroupRule, type Rule } from '@bookorbit/types'
import { providerShortLabel } from '@/lib/provider-colors'
import BookFilterBuilder from '../BookFilterBuilder.vue'

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([]), loading: ref(false), fetchLibraries: vi.fn<() => Promise<void>>() }),
}))

vi.mock('@/features/book/composables/useMetadataProviderLabels', () => ({
  useMetadataProviderLabels: () => ({ labels: ref({}) }),
}))

const customFields = ref<CustomMetadataFieldSummary[]>([])

vi.mock('@/features/book/composables/useActiveCustomFields', () => ({
  useActiveCustomFields: () => ({ fields: customFields }),
  activeCustomFieldLabel: (fieldId: number) => customFields.value.find((f) => f.id === fieldId)?.label ?? null,
}))

function makeCustomField(overrides: Partial<CustomMetadataFieldSummary> = {}): CustomMetadataFieldSummary {
  return { id: 7, label: 'Shelf Location', type: 'text', displayOrder: 0, archivedAt: null, enabledLibraryIds: [], ...overrides }
}

interface StubOption {
  value: string
  label: string
}

const passthrough = { template: '<div><slot /></div>' }

// reka's popovers and menus are replaced by plain markup that is always rendered, so a row's value
// panel, its menus and every field picker can be reached in one click.
const stubs = {
  FieldPickerPopover: {
    props: ['open', 'groups', 'selected', 'exclude', 'title'],
    emits: ['pick', 'update:open'],
    computed: {
      options(this: { groups: { options: StubOption[] }[] }) {
        return this.groups.flatMap((group) => group.options)
      },
    },
    template: `<div class="picker" :data-title="title"><slot name="trigger" /><button v-for="option in options" :key="option.value" type="button" class="pick" :data-value="option.value" @click="$emit('pick', option.value)">{{ option.label }}</button></div>`,
  },
  FilterListValues: { props: ['field', 'modelValue'], template: '<div class="list-values" />' },
  Popover: passthrough,
  PopoverTrigger: passthrough,
  PopoverContent: passthrough,
  DropdownMenu: passthrough,
  DropdownMenuTrigger: passthrough,
  DropdownMenuContent: passthrough,
  DropdownMenuSeparator: { template: '<hr />' },
  DropdownMenuItem: { emits: ['select'], template: '<button type="button" class="menu-item" @click="$emit(\'select\')"><slot /></button>' },
  DropdownMenuRadioGroup: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<div class="radio-group" :data-current="modelValue" @click="$emit('update:modelValue', $event.target.closest('[data-value]').dataset.value)"><slot /></div>`,
  },
  DropdownMenuRadioItem: { props: ['value'], template: '<button type="button" class="radio-item" :data-value="value"><slot /></button>' },
}

function group(...rules: (Rule | GroupRule)[]): GroupRule {
  return { type: 'group', join: 'AND', rules }
}

const dune: Rule = { type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }
const unread: Rule = { type: 'rule', field: 'readStatus', operator: 'includesAny', value: ['unread'] }

function mountBuilder(props: Record<string, unknown> = {}) {
  return mount(BookFilterBuilder, { props: { modelValue: undefined, ...props }, global: { stubs } })
}

function lastUpdate(wrapper: VueWrapper) {
  const events = wrapper.emitted<[GroupRule | undefined]>('update:modelValue')
  return events?.[events.length - 1]?.[0]
}

function rows(wrapper: VueWrapper) {
  return wrapper.findAll('[data-testid="filter-builder-rule"]')
}

async function addField(wrapper: VueWrapper, field: string) {
  await wrapper.findAll('.picker[data-title="Add filter"]').at(-1)!.get(`.pick[data-value="${field}"]`).trigger('click')
}

async function menuAction(scope: Pick<VueWrapper, 'findAll'>, label: string) {
  const item = scope.findAll('.menu-item').find((button) => button.text() === label)
  if (!item) throw new Error(`No menu item "${label}"`)
  await item.trigger('click')
}

function rowOperators(row: ReturnType<VueWrapper['find']>) {
  return row
    .findAll('.radio-group')[0]!
    .findAll('.radio-item')
    .map((item) => item.attributes('data-value'))
}

describe('BookFilterBuilder', () => {
  beforeEach(() => {
    customFields.value = []
  })

  it('starts empty with a way to add the first filter', () => {
    const wrapper = mountBuilder()

    expect(wrapper.get('[data-testid="filter-builder-empty"]').text()).toContain('No filters yet')
    expect(wrapper.find('.picker[data-title="Add filter"]').exists()).toBe(true)
  })

  it('keeps a new row out of the filter until it has a value, then sends it', async () => {
    const wrapper = mountBuilder()

    await addField(wrapper, 'title')
    expect(rows(wrapper)).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await rows(wrapper)[0]!.get('input[aria-label="Title value"]').setValue('Dune')

    expect(lastUpdate(wrapper)).toEqual(group({ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }))
  })

  it('leaves a row without a value on screen but out of what it sends', async () => {
    const wrapper = mountBuilder({ modelValue: group(dune) })

    await addField(wrapper, 'author')

    expect(rows(wrapper)).toHaveLength(2)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(rows(wrapper)[1]!.get('[data-testid="filter-builder-value"]').text()).toBe('Choose values')
  })

  it('does not rebuild its rows from its own echo, so a half-made row survives', async () => {
    const wrapper = mountBuilder({ modelValue: group(dune) })
    await addField(wrapper, 'author')
    await rows(wrapper)[0]!.get('input[aria-label="Title value"]').setValue('Dune Messiah')

    await wrapper.setProps({ modelValue: lastUpdate(wrapper) })

    expect(rows(wrapper)).toHaveLength(2)
  })

  it('clears to no filter by default and to an empty group when the editor asks to keep one', async () => {
    const incomplete = group({ type: 'rule', field: 'title', operator: 'contains' })

    const plain = mountBuilder({ modelValue: incomplete })
    await plain
      .findAll('button')
      .find((button) => button.text() === 'Clear all')!
      .trigger('click')
    expect(lastUpdate(plain)).toBeUndefined()

    const kept = mountBuilder({ modelValue: incomplete, preserveIncompleteRoot: true })
    await kept
      .findAll('button')
      .find((button) => button.text() === 'Clear all')!
      .trigger('click')
    expect(lastUpdate(kept)).toEqual({ type: 'group', join: 'AND', rules: [] })
  })

  it('switches the root between matching all and any of its filters', async () => {
    const wrapper = mountBuilder({ modelValue: group(dune, unread) })
    expect(wrapper.text()).toContain('Match')

    await wrapper.findAll('.radio-group')[0]!.get('.radio-item[data-value="OR"]').trigger('click')

    expect(lastUpdate(wrapper)).toEqual({ type: 'group', join: 'OR', rules: [dune, unread] })
  })

  it('shows list values as chips and a scalar value as one chip', () => {
    const wrapper = mountBuilder({
      modelValue: group(
        { ...unread, value: ['unread', 'reading', 'read', 'abandoned', 'skimmed'] },
        { type: 'rule', field: 'rating', operator: 'gte', value: 4 },
      ),
    })

    const [list, rating] = rows(wrapper)
    expect(list!.findAll('[data-testid="filter-builder-value"] > span').map((chip) => chip.text())).toEqual([
      'Unread',
      'Reading',
      'Read',
      'Abandoned',
      '+1',
    ])
    expect(rating!.get('[data-testid="filter-builder-value"]').text()).toBe('4 stars')
  })

  it('duplicates, wraps in a group and removes a row from its menu', async () => {
    const wrapper = mountBuilder({ modelValue: group(dune) })

    await menuAction(rows(wrapper)[0]!, 'Duplicate')
    expect(lastUpdate(wrapper)).toEqual(group(dune, dune))

    await menuAction(rows(wrapper)[1]!, 'Wrap in a group')
    expect(lastUpdate(wrapper)).toEqual(group(dune, { type: 'group', join: 'OR', rules: [dune] }))

    await menuAction(rows(wrapper)[0]!, 'Remove')
    expect(lastUpdate(wrapper)).toEqual(group({ type: 'group', join: 'OR', rules: [dune] }))
  })

  it('draws a group as "Any of these" and can ungroup or remove it', async () => {
    const nested: GroupRule = { type: 'group', join: 'OR', rules: [dune, unread] }
    const wrapper = mountBuilder({ modelValue: group(nested) })
    const block = wrapper.get('[data-testid="filter-builder-group"]')
    expect(block.text()).toContain('Any')
    expect(block.text()).toContain('of these')

    await menuAction(block, 'Ungroup')
    expect(lastUpdate(wrapper)).toEqual(group(dune, unread))

    await wrapper.setProps({ modelValue: group(nested) })
    await menuAction(wrapper.get('[data-testid="filter-builder-group"]'), 'Remove group')
    expect(lastUpdate(wrapper)).toBeUndefined()
  })

  it('adds a group that matches any of its rules', async () => {
    const wrapper = mountBuilder({ modelValue: group(dune) })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add group')!
      .trigger('click')
    const block = wrapper.get('[data-testid="filter-builder-group"]')
    await block.get('.picker[data-title="Add filter"] .pick[data-value="isbn"]').trigger('click')
    await wrapper.get('input[aria-label="ISBN value"]').setValue('978')

    expect(lastUpdate(wrapper)).toEqual(
      group(dune, { type: 'group', join: 'OR', rules: [{ type: 'rule', field: 'isbn', operator: 'eq', value: '978' }] }),
    )
  })

  it('offers no new groups at the deepest level allowed', () => {
    const wrapper = mountBuilder({ modelValue: group(dune), maxDepth: 0 })

    expect(wrapper.findAll('button').some((button) => button.text() === 'Add group')).toBe(false)
    expect(
      rows(wrapper)[0]!
        .findAll('.menu-item')
        .map((item) => item.text()),
    ).toEqual(['Duplicate', 'Remove'])
  })

  it('changes a row to another field and starts that field afresh', async () => {
    const wrapper = mountBuilder({ modelValue: group(dune, unread) })

    await rows(wrapper)[0]!.get('.picker[data-title="Change field"] .pick[data-value="rating"]').trigger('click')

    expect(lastUpdate(wrapper)).toEqual(group({ type: 'rule', field: 'rating', operator: 'gte', value: 4 }, unread))
  })

  it('shows the live count of matching books', () => {
    expect(mountBuilder({ modelValue: group(dune), matchCount: 1234 }).text()).toContain('1,234 books match')
    expect(mountBuilder({ modelValue: group(dune) }).text()).not.toContain('match')
  })

  it('reads a file size in megabytes and sends it in bytes', async () => {
    const wrapper = mountBuilder({ modelValue: group({ type: 'rule', field: 'fileSize', operator: 'lte', value: 26_214_400 }) })
    const input = wrapper.get('input[aria-label="File Size value"]')
    expect((input.element as HTMLInputElement).value).toBe('25')

    await input.setValue('10.5')

    expect(lastUpdate(wrapper)).toEqual(group({ type: 'rule', field: 'fileSize', operator: 'lte', value: 11_010_048 }))
  })

  it('offers date and empty/not-empty operators for Date Started', () => {
    const wrapper = mountBuilder({ modelValue: group({ type: 'rule', field: 'startedAt', operator: 'withinLast', value: 30 }) })

    expect(rowOperators(rows(wrapper)[0]!)).toEqual(expect.arrayContaining(['withinLast', 'moreThanAgo', 'between', 'isEmpty', 'isNotEmpty']))
  })

  it('sends a more-than-ago date as a plain day count', async () => {
    const wrapper = mountBuilder({ modelValue: group({ type: 'rule', field: 'finishedAt', operator: 'moreThanAgo', value: 200 }) })

    await wrapper.get('[data-testid="filter-rule-editor"] input[type="number"]').setValue('90')

    expect(lastUpdate(wrapper)).toEqual(group({ type: 'rule', field: 'finishedAt', operator: 'moreThanAgo', value: 90 }))
  })

  it('treats lock status, series status and audiobook cover as states with no value to set', async () => {
    const wrapper = mountBuilder({
      modelValue: group(
        { type: 'rule', field: 'lockStatus', operator: 'isLocked' },
        { type: 'rule', field: 'seriesStatus', operator: 'isUpNext' },
        { type: 'rule', field: 'audioCover', operator: 'isMissing' },
      ),
    })

    const [lock, series, cover] = rows(wrapper)
    for (const row of [lock!, series!, cover!]) expect(row.find('[data-testid="filter-builder-value"]').exists()).toBe(false)
    expect(new Set(rowOperators(lock!))).toEqual(new Set(['isLocked', 'isUnlocked']))
    expect(series!.find('.radio-group').exists()).toBe(false)
    expect(rowOperators(cover!)).toEqual(expect.arrayContaining(['isMissing', 'isPresent']))
  })

  it('sends community rating rules with their provider and reads a saved one back', async () => {
    const wrapper = mountBuilder({ modelValue: group({ type: 'rule', field: 'communityRating', operator: 'lt', value: 3, provider: 'goodreads' }) })
    const providers = wrapper.get('[role="radiogroup"][aria-label="Provider"]')
    expect(providers.get('[aria-checked="true"]').text()).toBe(providerShortLabel('goodreads'))
    expect(rows(wrapper)[0]!.get('[data-testid="filter-builder-value"]').text()).toContain(providerShortLabel('goodreads'))

    await providers
      .findAll('[role="radio"]')
      .find((radio) => radio.text() === providerShortLabel('hardcover'))!
      .trigger('click')

    expect(lastUpdate(wrapper)).toEqual(group({ type: 'rule', field: 'communityRating', operator: 'lt', value: 3, provider: 'hardcover' }))
  })

  it('reads a community rating without a provider as any provider', () => {
    const wrapper = mountBuilder({ modelValue: group({ type: 'rule', field: 'communityRatingCount', operator: 'gte', value: 25 }) })

    expect(wrapper.get('[role="radiogroup"][aria-label="Provider"] [aria-checked="true"]').text()).toBe('Any provider')
    expect((wrapper.get('[data-testid="filter-rule-editor"] input[type="number"]').element as HTMLInputElement).value).toBe('25')
  })
})

describe('BookFilterBuilder custom metadata fields', () => {
  beforeEach(() => {
    customFields.value = []
  })

  function mountWith(fields: CustomMetadataFieldSummary[], modelValue: GroupRule = group(dune)) {
    customFields.value = fields
    return mountBuilder({ modelValue })
  }

  it('lists active custom fields last, ordered and labelled verbatim', () => {
    const wrapper = mountWith([
      makeCustomField({ id: 7, label: 'Shelf Location', displayOrder: 1 }),
      makeCustomField({ id: 3, label: 'Condition', displayOrder: 0 }),
      makeCustomField({ id: 9, label: 'Old', archivedAt: '2026-01-01T00:00:00.000Z' }),
    ])

    const picks = wrapper.findAll('.picker[data-title="Add filter"] .pick')
    expect(picks.slice(-2).map((pick) => [pick.attributes('data-value'), pick.text()])).toEqual([
      ['custom:3', 'Condition'],
      ['custom:7', 'Shelf Location'],
    ])
  })

  it('keeps a rule pointing at a since-archived field', () => {
    const wrapper = mountWith(
      [makeCustomField({ id: 7, archivedAt: '2026-01-01T00:00:00.000Z' })],
      group({ type: 'rule', field: 'custom:7', operator: 'contains', value: 'A' }),
    )

    expect(rows(wrapper)).toHaveLength(1)
    expect(rows(wrapper)[0]!.get('[data-testid="filter-builder-value"]').text()).toBe('A')
  })

  it.each(['text', 'url', 'number', 'date'] as const)('offers only the operators a %s custom field supports', async (type) => {
    const wrapper = mountWith([makeCustomField({ type })])

    await rows(wrapper)[0]!.get('.picker[data-title="Change field"] .pick[data-value="custom:7"]').trigger('click')

    expect(new Set(rowOperators(rows(wrapper)[0]!))).toEqual(new Set(CUSTOM_FIELD_TYPE_OPERATORS[type]))
  })

  it('sends a number custom field rule with a numeric value', async () => {
    const wrapper = mountWith([makeCustomField({ type: 'number' })], group({ type: 'rule', field: 'custom:7', operator: 'gte', value: 1 }))

    await wrapper.get('[data-testid="filter-rule-editor"] input[type="number"]').setValue('12')

    expect(lastUpdate(wrapper)).toEqual(group({ type: 'rule', field: 'custom:7', operator: 'gte', value: 12 }))
  })

  it('sends a boolean custom field rule the moment it is added, with no value to set', async () => {
    const wrapper = mountWith([makeCustomField({ type: 'boolean' })])

    await addField(wrapper, 'custom:7')

    const sent = lastUpdate(wrapper)!
    expect(sent.rules[1]).toEqual({ type: 'rule', field: 'custom:7', operator: 'isTrue' })
    expect(rows(wrapper)[1]!.find('[data-testid="filter-builder-value"]').exists()).toBe(false)
  })

  it('never sends a provider on a custom field rule', async () => {
    const wrapper = mountWith([makeCustomField({ type: 'text' })])

    await addField(wrapper, 'custom:7')
    await rows(wrapper)[1]!.get('[data-testid="filter-rule-editor"] input').setValue('Shelf 3')

    expect(lastUpdate(wrapper)!.rules[1]).not.toHaveProperty('provider')
  })
})
