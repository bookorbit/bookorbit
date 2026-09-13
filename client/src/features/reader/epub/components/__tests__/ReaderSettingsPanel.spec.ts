import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import type { UserFont } from '@bookorbit/types'
import { fontCssFamilyGroupName } from '@bookorbit/types'
import ReaderSettingsPanel from '../ReaderSettingsPanel.vue'
import type { ReaderState } from '../../composables/useReaderState'
import type { FontFamily, useCustomFonts } from '../../composables/useCustomFonts'

function makeState(overrides: Partial<ReaderState> = {}): ReaderState {
  return {
    fontSize: 16,
    lineHeight: 1.5,
    paragraphSpacing: 0,
    letterSpacing: null,
    wordSpacing: null,
    textIndent: null,
    fontFamily: null,
    fontWeight: 400,
    fontStyle: 'normal',
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

function groupByAriaLabel(wrapper: VueWrapper, label: string) {
  return wrapper.find(`[role="group"][aria-label="${label}"]`)
}

/** Resolves the style chips through the group their heading labels, a11y wiring included. */
function styleChips(wrapper: VueWrapper) {
  const group = wrapper.findAll('[role="group"]').find((candidate) => {
    const labelId = candidate.attributes('aria-labelledby')
    return labelId ? wrapper.find(`[id="${labelId}"]`).text() === 'Style' : false
  })
  return group ? group.findAll('button') : []
}

function styleChipLabels(wrapper: VueWrapper) {
  return styleChips(wrapper).map((chip) => chip.text())
}

function styleChip(wrapper: VueWrapper, label: string) {
  return styleChips(wrapper).find((chip) => chip.text() === label)
}

const userCss = (name: string) => fontCssFamilyGroupName(name, 'user')

function makeFont(overrides: Partial<UserFont> = {}): UserFont {
  return {
    id: 1,
    familyName: 'Test',
    originalFileName: 'Test.ttf',
    format: 'ttf',
    weight: 400,
    style: 'normal',
    weightMin: null,
    weightMax: null,
    instances: null,
    fileSize: 1000,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeFamily(name: string, variants: UserFont[]): FontFamily {
  return { name, cssFamilyName: userCss(name), scope: 'user', variants }
}

/** The slice of useCustomFonts the panel actually reads. */
function makeCustomFonts(families: FontFamily[]) {
  return {
    fonts: ref(families.flatMap((family) => family.variants)),
    serverFonts: ref([] as UserFont[]),
    families: computed(() => families),
    visibleServerFamilies: computed(() => [] as FontFamily[]),
    isFontFamilySelected: (name: string, current: string | null) => current === userCss(name),
    getCssFamilyForDisplay: (name: string) => userCss(name),
    generateFontFaceCSS: () => '',
  } as unknown as ReturnType<typeof useCustomFonts>
}

describe('ReaderSettingsPanel', () => {
  it('presents every reflowable setting without tab navigation', () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('Text size')
    expect(wrapper.text()).toContain('Page color')
    expect(wrapper.text()).toContain('Font')
    expect(wrapper.text()).toContain('Line spacing')
    expect(wrapper.text()).toContain('Paragraph spacing')
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

  it('labels and emits paragraph spacing from the slider', async () => {
    const publisherDefault = mountPanel()
    expect(rangeByLabel(publisherDefault, 'Paragraph spacing')!.attributes('aria-valuetext')).toBe('Default')

    const wrapper = mountPanel({ state: makeState({ paragraphSpacing: 1.4 }) })
    const slider = rangeByLabel(wrapper, 'Paragraph spacing')!
    expect(slider.attributes('aria-valuetext')).toBe('1.4 em')

    await slider.setValue('1.7')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ paragraphSpacing: 1.7 }])
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
    const wrapper = mountPanel({
      state: makeState({
        maxColumnCount: 2,
        gap: 0.05,
        justify: true,
        hyphenate: true,
      }),
    })

    await buttonByAriaLabel(wrapper, 'More columns').trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ maxColumnCount: 3 }])

    await rangeByLabel(wrapper, 'Column gap')!.setValue('12')
    expect(wrapper.emitted('update')?.[1]).toEqual([{ gap: 0.12 }])

    await switchByLabel(wrapper, 'Justify text')!.trigger('click')
    expect(wrapper.emitted('update')?.[2]).toEqual([{ justify: false }])

    await switchByLabel(wrapper, 'Hyphenation')!.trigger('click')
    expect(wrapper.emitted('update')?.[3]).toEqual([{ hyphenate: false }])
  })

  it('offers publisher and custom typography controls with nullable overrides', async () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('Letter spacing')
    expect(wrapper.text()).toContain('Word spacing')
    expect(wrapper.text()).toContain('First-line indent')
    expect(groupByAriaLabel(wrapper, 'Letter spacing').get('button[aria-pressed="true"]').text()).toBe('Book')

    await groupByAriaLabel(wrapper, 'Letter spacing').findAll('button')[1]!.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ letterSpacing: 0 }])

    const customized = mountPanel({
      state: makeState({ letterSpacing: 0.1, wordSpacing: 0.2, textIndent: 1 }),
    })
    await rangeByLabel(customized, 'Letter spacing')!.setValue('0.13')
    await rangeByLabel(customized, 'Word spacing')!.setValue('0.35')
    await rangeByLabel(customized, 'First-line indent')!.setValue('1.75')
    await groupByAriaLabel(customized, 'Letter spacing').findAll('button')[0]!.trigger('click')

    expect(customized.emitted('update')).toEqual([
      [{ letterSpacing: 0.13 }],
      [{ wordSpacing: 0.35 }],
      [{ textIndent: 1.75 }],
      [{ letterSpacing: null }],
    ])
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
    const wrapper = mountPanel({
      state: makeState({ fixedLayoutSpread: 'auto' }),
      isFixedLayout: true,
    })

    expect(wrapper.text()).toContain('Page spreads')
    expect(wrapper.text()).toContain('Page color')
    expect(wrapper.text()).not.toContain('Text size')
    expect(wrapper.text()).not.toContain('Reading flow')
    expect(wrapper.text()).not.toContain('Advanced layout')
    expect(wrapper.text()).not.toContain('Letter spacing')

    await buttonByText(wrapper, 'Single page')?.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ fixedLayoutSpread: 'none' }])
  })

  it('hides fixed-layout spread controls for reflowable books', () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).not.toContain('Page spreads')
    expect(wrapper.text()).not.toContain('Single page')
  })

  describe('font style', () => {
    it('offers the four system styles while a built-in stack is selected', () => {
      const wrapper = mountPanel({ state: makeState({ fontFamily: 'serif' }) })

      expect(styleChipLabels(wrapper)).toEqual(['Regular', 'Bold', 'Regular Italic', 'Bold Italic'])
    })

    it('emits the weight and slant of the chosen style', async () => {
      const wrapper = mountPanel({ state: makeState({ fontFamily: 'serif' }) })

      await styleChip(wrapper, 'Bold Italic')?.trigger('click')

      expect(wrapper.emitted('update')?.[0]).toEqual([{ fontWeight: 700, fontStyle: 'italic' }])
    })

    it('marks the style in use as pressed', () => {
      const wrapper = mountPanel({
        state: makeState({
          fontFamily: 'serif',
          fontWeight: 700,
          fontStyle: 'normal',
        }),
      })

      expect(styleChip(wrapper, 'Bold')?.attributes('aria-pressed')).toBe('true')
      expect(styleChip(wrapper, 'Regular')?.attributes('aria-pressed')).toBe('false')
    })

    it('names each style the way its designer did for a variable font', () => {
      const customFonts = makeCustomFonts([
        makeFamily('Inter', [
          makeFont({
            weightMin: 100,
            weightMax: 900,
            instances: [
              { name: 'Thin', weight: 100, style: 'normal' },
              { name: 'Book', weight: 400, style: 'normal' },
              { name: 'Heavy', weight: 900, style: 'normal' },
            ],
          }),
        ]),
      ])
      const wrapper = mountPanel({
        state: makeState({ fontFamily: userCss('Inter') }),
        customFonts,
      })

      expect(styleChipLabels(wrapper)).toEqual(['Thin', 'Book', 'Heavy'])
    })

    it('hides the row for a family that offers a single style', () => {
      const customFonts = makeCustomFonts([makeFamily('Solo', [makeFont()])])
      const wrapper = mountPanel({
        state: makeState({ fontFamily: userCss('Solo') }),
        customFonts,
      })

      expect(wrapper.text()).not.toContain('Style')
      expect(styleChipLabels(wrapper)).toEqual([])
    })

    it('moves to the nearest style when the newly picked family lacks the current one', async () => {
      const customFonts = makeCustomFonts([makeFamily('Sparse', [makeFont({ weight: 300 }), makeFont({ id: 2, weight: 500 })])])
      const wrapper = mountPanel({
        state: makeState({ fontFamily: 'serif', fontWeight: 700 }),
        customFonts,
      })

      await buttonByText(wrapper, 'Sparse')?.trigger('click')

      expect(wrapper.emitted('update')?.[0]).toEqual([{ fontFamily: userCss('Sparse'), fontWeight: 500, fontStyle: 'normal' }])
    })

    it('leaves the style alone when the newly picked family offers it', async () => {
      const customFonts = makeCustomFonts([makeFamily('Full', [makeFont({ weight: 400 }), makeFont({ id: 2, weight: 700 })])])
      const wrapper = mountPanel({
        state: makeState({ fontFamily: 'serif', fontWeight: 700 }),
        customFonts,
      })

      await buttonByText(wrapper, 'Full')?.trigger('click')

      expect(wrapper.emitted('update')?.[0]).toEqual([{ fontFamily: userCss('Full') }])
    })
  })
})
