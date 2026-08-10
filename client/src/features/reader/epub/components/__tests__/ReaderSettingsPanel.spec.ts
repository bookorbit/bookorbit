import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReaderSettingsPanel from '../ReaderSettingsPanel.vue'
import type { ReaderState } from '../../composables/useReaderState'

function makeState(overrides: Partial<ReaderState> = {}): ReaderState {
  return {
    fontSize: 16,
    lineHeight: 1.5,
    fontFamily: null,
    maxColumnCount: 2,
    gap: 0.05,
    maxInlineSize: 720,
    maxBlockSize: 1440,
    justify: true,
    hyphenate: true,
    isDark: false,
    themeName: 'default',
    flow: 'paginated',
    fixedLayoutSpread: 'auto',
    ...overrides,
  }
}

function mountPanel(props: Partial<InstanceType<typeof ReaderSettingsPanel>['$props']> = {}) {
  return mount(ReaderSettingsPanel, {
    props: { state: makeState(), ...props },
  })
}

/** Resolves a slider through its <label for>, which also asserts the control is programmatically labelled. */
function rangeByLabel(wrapper: VueWrapper, labelText: string) {
  const label = wrapper.findAll('label').find((candidate) => candidate.text() === labelText)
  const id = label?.attributes('for')
  return id ? wrapper.find(`[id="${id}"]`) : undefined
}

/** Resolves a switch through aria-labelledby, so the a11y wiring is covered alongside the behaviour. */
function switchByLabel(wrapper: VueWrapper, labelText: string) {
  return wrapper.findAll('[role="switch"]').find((candidate) => {
    const labelId = candidate.attributes('aria-labelledby')
    return labelId ? wrapper.find(`[id="${labelId}"]`).text() === labelText : false
  })
}

function buttonByAriaLabel(wrapper: VueWrapper, label: string) {
  return wrapper.find(`button[aria-label="${label}"]`)
}

function buttonByText(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((button) => button.text() === text)
}

describe('ReaderSettingsPanel', () => {
  it('presents every reflowable setting without tab navigation', () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('Text size')
    expect(wrapper.text()).toContain('Page color')
    expect(wrapper.text()).toContain('Font')
    expect(wrapper.text()).toContain('Line spacing')
    expect(wrapper.text()).toContain('Page width')
    expect(wrapper.text()).toContain('Reading flow')
    expect(wrapper.text()).toContain('Advanced layout')
  })

  it('steps text size within its bounds', async () => {
    const wrapper = mountPanel()

    await buttonByAriaLabel(wrapper, 'Larger text').trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ fontSize: 17 }])

    await buttonByAriaLabel(wrapper, 'Smaller text').trigger('click')
    expect(wrapper.emitted('update')?.[1]).toEqual([{ fontSize: 15 }])
  })

  it('disables the text size steppers at the ends of the range', () => {
    const atMin = mountPanel({ state: makeState({ fontSize: 6 }) })
    expect(buttonByAriaLabel(atMin, 'Smaller text').attributes('disabled')).toBeDefined()
    expect(buttonByAriaLabel(atMin, 'Larger text').attributes('disabled')).toBeUndefined()

    const atMax = mountPanel({ state: makeState({ fontSize: 32 }) })
    expect(buttonByAriaLabel(atMax, 'Larger text').attributes('disabled')).toBeDefined()
  })

  it('switches colour mode and marks the active segment', async () => {
    const wrapper = mountPanel({ state: makeState({ isDark: false }) })

    const dark = buttonByText(wrapper, 'Dark')
    expect(dark?.attributes('aria-pressed')).toBe('false')
    expect(buttonByText(wrapper, 'Light')?.attributes('aria-pressed')).toBe('true')

    await dark?.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ isDark: true }])
  })

  it('selects a page colour theme', async () => {
    const wrapper = mountPanel({ state: makeState({ themeName: 'default' }) })

    await buttonByAriaLabel(wrapper, 'Sepia').trigger('click')

    expect(wrapper.emitted('update')?.[0]).toEqual([{ themeName: 'sepia' }])
  })

  it('selects a built-in font', async () => {
    const wrapper = mountPanel()

    await buttonByText(wrapper, 'Sans-serif')?.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ fontFamily: 'sans-serif' }])

    await buttonByText(wrapper, 'Book default')?.trigger('click')
    expect(wrapper.emitted('update')?.[1]).toEqual([{ fontFamily: null }])
  })

  it('emits rounded line spacing from the slider', async () => {
    const wrapper = mountPanel()

    const slider = rangeByLabel(wrapper, 'Line spacing')!
    await slider.setValue('1.8')

    expect(wrapper.emitted('update')?.[0]).toEqual([{ lineHeight: 1.8 }])
  })

  it('describes page width in words rather than pixels', async () => {
    const wrapper = mountPanel({ state: makeState({ maxInlineSize: 720 }) })

    const slider = rangeByLabel(wrapper, 'Page width')!
    expect(slider.attributes('aria-valuetext')).toBe('Medium')

    await slider.setValue('440')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ maxInlineSize: 440 }])

    expect(mountPanel({ state: makeState({ maxInlineSize: 440 }) }).text()).toContain('Narrow')
    expect(mountPanel({ state: makeState({ maxInlineSize: 1600 }) }).text()).toContain('Full')
  })

  it('switches reading flow', async () => {
    const wrapper = mountPanel({ state: makeState({ flow: 'paginated' }) })

    await buttonByText(wrapper, 'Scroll')?.trigger('click')

    expect(wrapper.emitted('update')?.[0]).toEqual([{ flow: 'scrolled' }])
  })

  it('emits advanced layout changes', async () => {
    const wrapper = mountPanel({ state: makeState({ maxColumnCount: 2, gap: 0.05, justify: true, hyphenate: true }) })

    await buttonByAriaLabel(wrapper, 'More columns').trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ maxColumnCount: 3 }])

    await rangeByLabel(wrapper, 'Column gap')!.setValue('12')
    expect(wrapper.emitted('update')?.[1]).toEqual([{ gap: 0.12 }])

    await switchByLabel(wrapper, 'Justify text')!.trigger('click')
    expect(wrapper.emitted('update')?.[2]).toEqual([{ justify: false }])

    await switchByLabel(wrapper, 'Hyphenation')!.trigger('click')
    expect(wrapper.emitted('update')?.[3]).toEqual([{ hyphenate: false }])
  })

  it('resets only when the book carries overrides', async () => {
    const untouched = mountPanel({ canReset: false })
    expect(buttonByAriaLabel(untouched, 'Reset to defaults').attributes('disabled')).toBeDefined()

    const customized = mountPanel({ canReset: true })
    const reset = buttonByAriaLabel(customized, 'Reset to defaults')
    expect(reset.attributes('disabled')).toBeUndefined()

    await reset.trigger('click')
    expect(customized.emitted('reset')).toHaveLength(1)
  })

  it('offers spread choices and hides text controls for fixed-layout books', async () => {
    const wrapper = mountPanel({ state: makeState({ fixedLayoutSpread: 'auto' }), isFixedLayout: true })

    expect(wrapper.text()).toContain('Page spreads')
    expect(wrapper.text()).toContain('Page color')
    expect(wrapper.text()).not.toContain('Text size')
    expect(wrapper.text()).not.toContain('Reading flow')
    expect(wrapper.text()).not.toContain('Advanced layout')

    await buttonByText(wrapper, 'Single page')?.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ fixedLayoutSpread: 'none' }])
  })

  it('hides fixed-layout spread controls for reflowable books', () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).not.toContain('Page spreads')
    expect(wrapper.text()).not.toContain('Single page')
  })
})
