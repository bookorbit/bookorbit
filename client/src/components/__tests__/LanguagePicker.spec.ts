import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LanguagePicker from '../LanguagePicker.vue'

const localeStore = reactive({ locale: 'en' })
const matchSupportedLocale = vi.fn<(candidates: readonly string[]) => string | null>(() => null)

vi.mock('@/stores/locale', () => ({
  useLocaleStore: () => localeStore,
  matchSupportedLocale: (candidates: readonly string[]) => matchSupportedLocale(candidates),
}))

function setBrowserLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true })
}

/** Row labels for one heading, so assertions do not depend on the other group's contents. */
function groupLabels(wrapper: ReturnType<typeof mount>, heading: string): string[] {
  const group = wrapper.findAll('div.pb-1').find((candidate) => candidate.find('p')?.text() === heading)
  if (!group) return []
  return group.findAll('button').map((button) => button.find('span[lang]').text())
}

describe('LanguagePicker', () => {
  beforeEach(() => {
    localeStore.locale = 'en'
    matchSupportedLocale.mockReset()
    matchSupportedLocale.mockReturnValue(null)
    setBrowserLanguages(['en-US'])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sorts every language by the name it actually renders, not by locale code', () => {
    const labels = groupLabels(mount(LanguagePicker), 'All languages')

    // Ordering by code would put Suomi between Español and Français, and Bahasa
    // Indonesia between Magyar and Italiano, which reads as unsorted to a user.
    expect(labels.slice(0, 6)).toEqual(['Bahasa Indonesia', 'Čeština', 'Dansk', 'Deutsch', 'English', 'Español'])
    expect(labels).toHaveLength(25)
  })

  it('pairs each native name with its English name', () => {
    const wrapper = mount(LanguagePicker)
    const german = wrapper.findAll('button').find((button) => button.find('span[lang]').text() === 'Deutsch')

    expect(german?.text()).toContain('German')
    expect(german?.find('span[lang]').attributes('lang')).toBe('de')
  })

  it('distinguishes the two Chinese catalogs by script rather than by bare language', () => {
    const wrapper = mount(LanguagePicker)
    const texts = wrapper.findAll('button').map((button) => button.text())

    expect(texts.some((text) => text.includes('简体中文') && text.includes('Simplified Chinese'))).toBe(true)
    expect(texts.some((text) => text.includes('繁體中文') && text.includes('Traditional Chinese'))).toBe(true)
  })

  it('suggests the current locale plus the browser languages it can match', () => {
    localeStore.locale = 'de'
    setBrowserLanguages(['fr-FR', 'ja-JP'])
    matchSupportedLocale.mockImplementation((candidates) => {
      const [candidate] = candidates
      if (candidate === 'fr-FR') return 'fr'
      if (candidate === 'ja-JP') return 'ja'
      return null
    })

    expect(groupLabels(mount(LanguagePicker), 'Suggested')).toEqual(['Deutsch', 'Français', '日本語'])
  })

  it('never repeats the current locale in the suggestions', () => {
    localeStore.locale = 'fr'
    setBrowserLanguages(['fr-FR', 'fr-CA'])
    matchSupportedLocale.mockReturnValue('fr')

    expect(groupLabels(mount(LanguagePicker), 'Suggested')).toEqual(['Français'])
  })

  it('filters on the native name, the English name, and the locale code', async () => {
    const wrapper = mount(LanguagePicker)
    const input = wrapper.find('input')

    for (const [query, expected] of [
      ['deuts', 'Deutsch'],
      ['germ', 'Deutsch'],
      ['ko', '한국어'],
    ] as const) {
      await input.setValue(query)
      expect(groupLabels(wrapper, 'Results')).toContain(expected)
    }
  })

  it('reports an empty search instead of rendering an empty list', async () => {
    const wrapper = mount(LanguagePicker)

    await wrapper.find('input').setValue('klingon')

    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.text()).toContain('No languages match "klingon"')
  })

  it('marks the active language and emits the one that was chosen', async () => {
    localeStore.locale = 'pl'
    const wrapper = mount(LanguagePicker)

    const active = wrapper.findAll('button').filter((button) => button.attributes('aria-current') === 'true')
    expect(active.every((button) => button.find('span[lang]').text() === 'Polski')).toBe(true)

    const italian = wrapper.findAll('button').find((button) => button.find('span[lang]').text() === 'Italiano')
    await italian!.trigger('click')

    expect(wrapper.emitted('select')?.at(-1)).toEqual(['it'])
  })
})
