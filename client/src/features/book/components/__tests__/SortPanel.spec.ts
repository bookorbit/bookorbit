import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SortSpec } from '@bookorbit/types'
import SortPanel from '../sort-filter/SortPanel.vue'

vi.mock('@/features/book/composables/useActiveCustomFields', () => ({
  useActiveCustomFields: () => ({ fields: ref([]) }),
  activeCustomFieldLabel: () => null,
}))

function mountPanel(modelValue: SortSpec[], props: Record<string, unknown> = {}) {
  return mount(SortPanel, { props: { modelValue, ...props }, attachTo: document.body })
}

function lastSort(wrapper: VueWrapper) {
  const events = wrapper.emitted<[SortSpec[]]>('update:modelValue')
  return events?.[events.length - 1]?.[0]
}

function option(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('[role="option"]').find((item) => item.text().trim() === label)
  if (!found) throw new Error(`No option "${label}"`)
  return found
}

function button(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('button').find((item) => item.text().trim() === label)
  if (!found) throw new Error(`No button "${label}"`)
  return found
}

beforeAll(() => {
  // jsdom has no layout, so the listbox's scroll-to-highlighted call needs a stand-in.
  Element.prototype.scrollIntoView = vi.fn<() => void>()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SortPanel', () => {
  it('sorts by a picked field in its natural order: dates newest first, text A to Z', async () => {
    const wrapper = mountPanel([{ field: 'title', dir: 'asc' }])

    await option(wrapper, 'Date Added').trigger('click')
    expect(lastSort(wrapper)).toEqual([{ field: 'addedAt', dir: 'desc' }])

    await wrapper.setProps({ modelValue: [{ field: 'addedAt', dir: 'desc' }] })
    await option(wrapper, 'Title').trigger('click')
    expect(lastSort(wrapper)).toEqual([{ field: 'title', dir: 'asc' }])
    wrapper.unmount()
  })

  it('keeps the other levels when the lead changes and does not offer them as the lead', async () => {
    const wrapper = mountPanel([
      { field: 'title', dir: 'asc' },
      { field: 'author', dir: 'asc' },
    ])

    expect(wrapper.findAll('[role="option"]').some((item) => item.text().trim() === 'Author')).toBe(false)
    await option(wrapper, 'Rating').trigger('click')

    expect(lastSort(wrapper)).toEqual([
      { field: 'rating', dir: 'desc' },
      { field: 'author', dir: 'asc' },
    ])
    wrapper.unmount()
  })

  it("names the order in the lead field's own words and flips it", async () => {
    const wrapper = mountPanel([{ field: 'addedAt', dir: 'desc' }])

    expect(wrapper.get('button[aria-pressed="true"]').text()).toBe('Newest first')
    await button(wrapper, 'Oldest first').trigger('click')

    expect(lastSort(wrapper)).toEqual([{ field: 'addedAt', dir: 'asc' }])
    wrapper.unmount()
  })

  it('adds a "Then by" level in its natural order', async () => {
    const wrapper = mountPanel([{ field: 'title', dir: 'asc' }])

    await button(wrapper, 'Then by…').trigger('click')
    expect(wrapper.findAll('[role="option"]').some((item) => item.text().trim() === 'Title')).toBe(false)
    await option(wrapper, 'Page Count').trigger('click')

    expect(lastSort(wrapper)).toEqual([
      { field: 'title', dir: 'asc' },
      { field: 'pageCount', dir: 'desc' },
    ])
    expect(wrapper.text()).toContain('Then by…')
    wrapper.unmount()
  })

  it('switches and removes an extra level from its row', async () => {
    const wrapper = mountPanel([
      { field: 'title', dir: 'asc' },
      { field: 'addedAt', dir: 'desc' },
    ])

    const level = wrapper.get('[data-testid="sort-level"]')
    await level.get('button[aria-label="Date Added: Newest first. Switch"]').trigger('click')
    expect(lastSort(wrapper)).toEqual([
      { field: 'title', dir: 'asc' },
      { field: 'addedAt', dir: 'asc' },
    ])

    await level.get('button[aria-label="Remove Date Added"]').trigger('click')
    expect(lastSort(wrapper)).toEqual([{ field: 'title', dir: 'asc' }])
    wrapper.unmount()
  })

  it('offers a reset only when the sort is not the default', async () => {
    const atDefault = mountPanel([{ field: 'title', dir: 'asc' }])
    expect(atDefault.text()).not.toContain('Reset to')
    atDefault.unmount()

    const changed = mountPanel([{ field: 'rating', dir: 'desc' }])
    await button(changed, 'Reset to Title, A → Z').trigger('click')
    expect(lastSort(changed)).toEqual([{ field: 'title', dir: 'asc' }])
    changed.unmount()
  })

  it('keeps focus in the footer when Reset or a removed level takes its own button away', async () => {
    const wrapper = mountPanel([
      { field: 'rating', dir: 'desc' },
      { field: 'author', dir: 'asc' },
    ])

    const remove = wrapper.get<HTMLButtonElement>('button[aria-label="Remove Author"]')
    remove.element.focus()
    await remove.trigger('click')
    await wrapper.setProps({ modelValue: lastSort(wrapper) })
    expect(document.activeElement?.textContent?.trim()).toBe('Then by…')

    const reset = button(wrapper, 'Reset to Title, A → Z')
    const resetElement = reset.element as HTMLButtonElement
    resetElement.focus()
    await reset.trigger('click')
    await wrapper.setProps({ modelValue: lastSort(wrapper) })
    expect(document.activeElement?.textContent?.trim()).toBe('Then by…')
    wrapper.unmount()
  })

  it('offers "Shuffle again" for a random sort and no extra levels', async () => {
    const wrapper = mountPanel([{ field: 'random', dir: 'asc' }])

    await button(wrapper, 'Shuffle again').trigger('click')

    expect(wrapper.emitted('shuffle')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Then by…')
    wrapper.unmount()
  })

  it('picks a field from the keyboard: type to narrow, arrow to it, Enter', async () => {
    const wrapper = mountPanel([{ field: 'title', dir: 'asc' }])
    const search = wrapper.get('input[type="search"]')

    await search.setValue('page')
    await flushPromises()
    expect(wrapper.findAll('[role="option"]').map((item) => item.text().trim())).toEqual(['Page Count'])
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'Enter' })

    expect(lastSort(wrapper)).toEqual([{ field: 'pageCount', dir: 'desc' }])
    wrapper.unmount()
  })

  it('limits the list on pages that sort by a few fields, with their own names and no extra levels', () => {
    const wrapper = mountPanel([{ field: 'seriesIndex', dir: 'asc' }], {
      only: ['seriesIndex', 'title', 'addedAt'],
      labels: { seriesIndex: 'Series Order' },
      multi: false,
      defaultSort: [{ field: 'seriesIndex', dir: 'asc' }],
    })

    expect(wrapper.findAll('[role="option"]').map((item) => item.text().trim())).toEqual(['Series Order', 'Title', 'Date Added'])
    expect(wrapper.find('input[type="search"]').exists()).toBe(false)
    expect(wrapper.get('button[aria-pressed="true"]').text()).toBe('1 → 9')
    expect(wrapper.text()).not.toContain('Then by…')
    wrapper.unmount()
  })
})
