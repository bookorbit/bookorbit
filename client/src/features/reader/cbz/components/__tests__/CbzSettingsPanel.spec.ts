import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { CBX_READER_DEFAULTS, type CbxReaderSettings } from '@bookorbit/types'
import CbzSettingsPanel from '../CbzSettingsPanel.vue'

function makeSettings(overrides: Partial<CbxReaderSettings> = {}): CbxReaderSettings {
  return { ...CBX_READER_DEFAULTS, ...overrides }
}

function mountPanel(props: Partial<InstanceType<typeof CbzSettingsPanel>['$props']> = {}) {
  return mount(CbzSettingsPanel, {
    props: { settings: makeSettings(), ...props },
  })
}

function twoPageSettings(overrides: Partial<CbxReaderSettings> = {}): CbxReaderSettings {
  return makeSettings({ viewMode: 'two-page', scrollMode: 'paginated', ...overrides })
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

describe('CbzSettingsPanel', () => {
  it('presents every setting without tab navigation', () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('Fit mode')
    expect(wrapper.text()).toContain('Page view')
    expect(wrapper.text()).toContain('Scroll mode')
    expect(wrapper.text()).toContain('Reading direction')
    expect(wrapper.text()).toContain('Background')
  })

  it('selects a fit mode and marks the active choice', async () => {
    const wrapper = mountPanel()

    const width = buttonByText(wrapper, 'Page Width')
    expect(width?.attributes('aria-pressed')).toBe('false')
    expect(buttonByText(wrapper, 'Page Fit')?.attributes('aria-pressed')).toBe('true')

    await width?.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ fitMode: 'fit-width' }])
  })

  it('switches the page view', async () => {
    const wrapper = mountPanel()

    await buttonByText(wrapper, 'Two-page')?.trigger('click')

    expect(wrapper.emitted('update')?.[0]).toEqual([{ viewMode: 'two-page' }])
  })

  it('switches scroll mode and reading direction', async () => {
    const wrapper = mountPanel()

    await buttonByText(wrapper, 'Infinite')?.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ scrollMode: 'infinite' }])

    await buttonByText(wrapper, 'R to L')?.trigger('click')
    expect(wrapper.emitted('update')?.[1]).toEqual([{ direction: 'rtl' }])
  })

  it('selects a background color', async () => {
    const wrapper = mountPanel()

    const white = buttonByAriaLabel(wrapper, 'White')
    expect(white.attributes('aria-pressed')).toBe('false')
    expect(buttonByAriaLabel(wrapper, 'Black').attributes('aria-pressed')).toBe('true')

    await white.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ bgColor: 'white' }])
  })

  it('hides the spread group until two-page paged layout is chosen', () => {
    const single = mountPanel()
    expect(single.text()).not.toContain('Two-page spread')

    const scrolled = mountPanel({ settings: makeSettings({ viewMode: 'two-page', scrollMode: 'infinite' }) })
    expect(scrolled.text()).not.toContain('Two-page spread')
    expect(scrolled.text()).toContain('Two pages are shown only in paged mode.')

    const spread = mountPanel({ settings: twoPageSettings(), isSpreadActive: true })
    expect(spread.text()).toContain('Two-page spread')
    expect(spread.text()).toContain('Spread alignment')
    expect(spread.text()).toContain('Wide pages')
    expect(spread.text()).toContain('Spread gap')
  })

  it('emits spread adjustments', async () => {
    const wrapper = mountPanel({ settings: twoPageSettings(), isSpreadActive: true })

    await buttonByText(wrapper, 'Shifted')?.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ spreadAlignment: 'shifted' }])

    await buttonByText(wrapper, 'In spreads')?.trigger('click')
    expect(wrapper.emitted('update')?.[1]).toEqual([{ widePageSingletonMode: 'disable' }])

    await rangeByLabel(wrapper, 'Spread gap')!.setValue('24')
    expect(wrapper.emitted('update')?.[2]).toEqual([{ spreadGap: 24 }])

    await switchByLabel(wrapper, 'Force two-page')!.trigger('click')
    expect(wrapper.emitted('update')?.[3]).toEqual([{ forceTwoPage: true }])
  })

  it('explains the single-page fallback only while spreads are inactive', () => {
    const fallback = mountPanel({ settings: twoPageSettings(), isSpreadActive: false })
    expect(fallback.text()).toContain('This screen is too narrow for two pages, so single pages are shown.')

    const active = mountPanel({ settings: twoPageSettings(), isSpreadActive: true })
    expect(active.text()).not.toContain('This screen is too narrow for two pages, so single pages are shown.')
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
})
