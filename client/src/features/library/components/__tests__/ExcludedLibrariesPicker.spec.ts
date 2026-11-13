import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { Library } from '@bookorbit/types'

import ExcludedLibrariesPicker from '../ExcludedLibrariesPicker.vue'

const state = vi.hoisted(() => ({ fetchLibraries: vi.fn<() => Promise<void>>() }))

vi.mock('../../composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref<Partial<Library>[]>([
      { id: 1, name: 'Novels', bookCount: 1468 },
      { id: 2, name: 'Cookbooks', bookCount: 12 },
    ]),
    loaded: ref(true),
    fetchLibraries: state.fetchLibraries,
  }),
}))

const inline = { template: '<div><slot /></div>' }

function mountPicker(modelValue: number[]) {
  return mount(ExcludedLibrariesPicker, {
    props: { modelValue, label: 'Excluded libraries' },
    global: { stubs: { Popover: inline, PopoverTrigger: inline, PopoverContent: inline } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ExcludedLibrariesPicker', () => {
  it('reads None until a library is excluded', () => {
    const wrapper = mountPicker([])

    expect(wrapper.get('[data-testid="excluded-libraries-trigger"]').text()).toBe('None')
    expect(state.fetchLibraries).toHaveBeenCalled()
  })

  it('names the excluded libraries and lists every library with its book count', () => {
    const wrapper = mountPicker([1, 2])

    expect(wrapper.get('[data-testid="excluded-libraries-trigger"]').text()).toBe('Cookbooks, Novels')
    const rows = wrapper.findAll('label')
    expect(rows.map((row) => row.text())).toEqual(['Cookbooks12', 'Novels1,468'])
    expect(wrapper.text()).toContain('Applies when you press Save.')
  })

  it('adds and removes a library from the list', async () => {
    const wrapper = mountPicker([1])
    const [cookbooks, novels] = wrapper.findAll('input[type="checkbox"]')

    await cookbooks!.trigger('change')
    await novels!.trigger('change')

    expect(wrapper.emitted('update:modelValue')).toEqual([[[1, 2]], [[]]])
  })
})
