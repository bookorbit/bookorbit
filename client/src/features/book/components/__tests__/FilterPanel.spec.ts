import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GroupRule, Rule } from '@bookorbit/types'
import FilterPanel from '../sort-filter/FilterPanel.vue'

vi.mock('@/features/book/composables/useActiveCustomFields', () => ({
  useActiveCustomFields: () => ({ fields: ref([]) }),
  activeCustomFieldLabel: () => null,
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([]), loading: ref(false), fetchLibraries: vi.fn<() => Promise<void>>() }),
}))

vi.mock('@/features/collection/composables/useCollections', () => ({
  useCollections: () => ({ collections: ref([]), fetchCollections: vi.fn<() => Promise<void>>() }),
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(async () => new Response('[]', { status: 200 })),
}))

const dune: Rule = { type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }
const unread: Rule = { type: 'rule', field: 'readStatus', operator: 'includesAny', value: ['unread'] }

function group(...rules: (Rule | GroupRule)[]): GroupRule {
  return { type: 'group', join: 'AND', rules }
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(FilterPanel, {
    props: { modelValue: undefined, ...props },
    attachTo: document.body,
    global: {
      stubs: {
        BookFilterBuilder: { props: ['modelValue'], template: '<div data-testid="builder-stub"><button type="button">Match all</button></div>' },
      },
    },
  })
}

function lastFilter(wrapper: VueWrapper) {
  const events = wrapper.emitted<[GroupRule | undefined]>('update:modelValue')
  return events?.[events.length - 1]?.[0]
}

function option(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('[role="option"]').find((item) => item.text().trim() === label)
  if (!found) throw new Error(`No option "${label}"`)
  return found
}

beforeAll(() => {
  // jsdom has no layout, so the listbox's scroll-to-highlighted call needs a stand-in.
  Element.prototype.scrollIntoView = vi.fn<() => void>()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('FilterPanel', () => {
  it("opens a picked field's own control and applies its value as it is typed", async () => {
    const wrapper = mountPanel()

    await option(wrapper, 'Title').trigger('click')
    expect(wrapper.find('[data-testid="filter-rule-editor"]').exists()).toBe(true)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await wrapper.get('input[aria-label="Title value"]').setValue('Dune')

    expect(lastFilter(wrapper)).toEqual(group(dune))
    wrapper.unmount()
  })

  it('takes a rule out while its value is empty and puts it back in the same place', async () => {
    const wrapper = mountPanel({ modelValue: group(dune, unread), view: { kind: 'rule', index: 0 } })
    const input = wrapper.get('input[aria-label="Title value"]')

    await input.setValue('')
    expect(lastFilter(wrapper)).toEqual(group(unread))
    expect(wrapper.text()).toContain('Not applied until it has a value')

    await wrapper.setProps({ modelValue: lastFilter(wrapper) })
    await input.setValue('Hyperion')
    expect(lastFilter(wrapper)).toEqual(group({ ...dune, value: 'Hyperion' }, unread))
    wrapper.unmount()
  })

  it('lists the active filters, each one editable and removable, with Clear all', async () => {
    const wrapper = mountPanel({ modelValue: group(dune, unread) })

    const active = wrapper.get('[role="group"][aria-label="Active"]')
    expect(active.text()).toContain('Title contains Dune')
    expect(active.text()).toContain('Read Status is Unread')

    await active.get('button[aria-label="Remove Read Status is Unread"]').trigger('click')
    expect(lastFilter(wrapper)).toEqual(group(dune))

    await active
      .findAll('button')
      .find((button) => button.text() === 'Clear all')!
      .trigger('click')
    expect(lastFilter(wrapper)).toBeUndefined()

    await active.get('button[aria-label="Edit Title contains Dune"]').trigger('click')
    expect((wrapper.get('input[aria-label="Title value"]').element as HTMLInputElement).value).toBe('Dune')
    wrapper.unmount()
  })

  it('opens the existing checklist filter rather than starting a second one', async () => {
    const wrapper = mountPanel({ modelValue: group(unread) })

    await option(wrapper, 'Read Status').trigger('click')
    await flushPromises()
    await option(wrapper, 'Reading').trigger('click')

    expect(lastFilter(wrapper)).toEqual(group({ ...unread, value: ['unread', 'reading'] }))
    wrapper.unmount()
  })

  it('offers controlled author genders and applies a selected value', async () => {
    const wrapper = mountPanel()

    await option(wrapper, 'Author Gender').trigger('click')
    await flushPromises()
    await option(wrapper, 'Non-binary').trigger('click')

    expect(lastFilter(wrapper)).toEqual(group({ type: 'rule', field: 'authorGender', operator: 'includesAny', value: ['non_binary'] }))
    wrapper.unmount()
  })

  it('opens the builder for a group, which has no value panel of its own', async () => {
    const nested: GroupRule = { type: 'group', join: 'OR', rules: [dune, unread] }
    const wrapper = mountPanel({ modelValue: group(nested), view: { kind: 'rule', index: 0 } })

    expect(wrapper.find('[data-testid="filter-panel-builder"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('removes the rule a token opened and closes, since there is no list to go back to', async () => {
    const wrapper = mountPanel({ modelValue: group(dune, unread), view: { kind: 'rule', index: 1 } })

    await wrapper.get('button[aria-label="Remove this filter"]').trigger('click')

    expect(lastFilter(wrapper)).toEqual(group(dune))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it("hands focus to a picked field's value control, so typing goes straight in", async () => {
    const wrapper = mountPanel()

    await option(wrapper, 'Title').trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('input[aria-label="Title value"]').element)
    wrapper.unmount()
  })

  it('lands on the checked star and moves the rating with the arrow keys', async () => {
    const wrapper = mountPanel()

    await option(wrapper, 'Rating').trigger('click')
    await flushPromises()
    const four = wrapper.get('button[aria-label="4 stars"]')
    expect(document.activeElement).toBe(four.element)

    await four.trigger('keydown', { key: 'ArrowRight' })
    expect(lastFilter(wrapper)).toEqual(group({ type: 'rule', field: 'rating', operator: 'gte', value: 5 }))
    expect(document.activeElement).toBe(wrapper.get('button[aria-label="5 stars"]').element)

    await wrapper.get('button[aria-label="5 stars"]').trigger('keydown', { key: 'Home' })
    expect(lastFilter(wrapper)).toMatchObject(group({ type: 'rule', field: 'rating', operator: 'gte', value: 1 }))
    wrapper.unmount()
  })

  it('reaches the Advanced builder from the field list', async () => {
    const wrapper = mountPanel({ modelValue: group(dune) })

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Advanced builder'))!
      .trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="builder-stub"]').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="builder-stub"] button').element)
    wrapper.unmount()
  })
})
