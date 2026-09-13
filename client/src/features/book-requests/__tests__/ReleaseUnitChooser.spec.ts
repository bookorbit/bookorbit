import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ReleaseUnitChoice } from '@bookorbit/types'

import ReleaseUnitChooser from '../components/ReleaseUnitChooser.vue'

function unit(overrides: Partial<ReleaseUnitChoice> = {}): ReleaseUnitChoice {
  return {
    index: 0,
    mediaKind: 'ebook',
    title: 'Mort',
    contentFileCount: 1,
    totalFileCount: 1,
    sizeBytes: 1024,
    primaryPath: 'Pack/Mort.epub',
    ...overrides,
  }
}

const UNITS = [unit(), unit({ index: 1, title: 'Small Gods', primaryPath: 'Pack/Small Gods.epub' })]

function mountChooser(units = UNITS, busy = false) {
  return mount(ReleaseUnitChooser, { props: { units, busy } })
}

describe('ReleaseUnitChooser', () => {
  it('lists every book the release turned out to hold', () => {
    const text = mountChooser().text()

    expect(text).toContain('2 separate books')
    expect(text).toContain('Mort')
    expect(text).toContain('Small Gods')
  })

  it('describes each book by kind, file count and size', () => {
    const text = mountChooser([unit({ mediaKind: 'audiobook', title: 'Neuromancer', contentFileCount: 31, sizeBytes: 512 * 1024 ** 2 })]).text()

    expect(text).toContain('Audiobook')
    expect(text).toContain('31 files')
    expect(text).toContain('512 MB')
  })

  /** BookOrbit could not tell which one was wanted, so it must not appear to have already decided. */
  it('preselects nothing and keeps the action disabled until a choice is made', async () => {
    const wrapper = mountChooser()
    const button = wrapper.get('button')

    expect(wrapper.findAll('input[type="radio"]').every((input) => !(input.element as HTMLInputElement).checked)).toBe(true)
    expect(button.attributes('disabled')).toBeDefined()

    await wrapper.findAll('input[type="radio"]')[1]!.setValue()
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('emits the index of the chosen book', async () => {
    const wrapper = mountChooser()

    await wrapper.findAll('input[type="radio"]')[1]!.setValue()
    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('choose')).toEqual([[1]])
  })

  it('disables every control while the import runs', () => {
    const wrapper = mountChooser(UNITS, true)

    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })

  it('names an untitled book rather than showing a blank row', () => {
    expect(mountChooser([unit({ title: null })]).text()).toContain('Untitled')
  })
})
