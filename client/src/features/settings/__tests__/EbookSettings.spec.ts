import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fontCssFamilyGroupName, type EpubReaderSettings } from '@bookorbit/types'
import EbookSettings from '../EbookSettings.vue'

const readerSettingsMock = vi.hoisted(() => ({
  effective: {
    __v_isRef: true,
    value: {
      themeName: 'default',
      isDark: false,
      fontFamily: null,
      fontWeight: 400,
      fontStyle: 'normal',
      fontSize: 16,
      lineHeight: 1.5,
      paragraphSpacing: 0,
      letterSpacing: null,
      wordSpacing: null,
      textIndent: null,
      maxColumnCount: 2,
      gap: 0.05,
      maxInlineSize: 720,
      maxBlockSize: 1440,
      justify: true,
      hyphenate: true,
      flow: 'paginated',
      overrideBookFormatting: true,
      footerDisplayMode: 0,
      fixedLayoutSpread: 'auto',
    } as EpubReaderSettings,
  },
  load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  update: vi.fn<() => void>(),
  reset: vi.fn<() => void>(),
}))

const customFontsMock = vi.hoisted(() => ({
  families: { __v_isRef: true, value: [] },
  visibleServerFamilies: { __v_isRef: true, value: [] },
  fonts: { __v_isRef: true, value: [] },
  serverFonts: { __v_isRef: true, value: [] },
  hiddenServerFamilies: { __v_isRef: true, value: [] },
  generateFontFaceCSS: vi.fn<() => string>().mockReturnValue(''),
  cssFamilyAvailable: vi.fn<() => boolean>().mockReturnValue(true),
  fetchAllFonts: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@/features/reader/shared/composables/useReaderSettings', () => ({
  useReaderDefaultSettings: () => readerSettingsMock,
}))

vi.mock('@/features/reader/epub/composables/useCustomFonts', () => ({
  useCustomFonts: () => customFontsMock,
}))

describe('EbookSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readerSettingsMock.effective.value.fontFamily = null
    readerSettingsMock.effective.value.fontWeight = 400
    readerSettingsMock.effective.value.fontStyle = 'normal'
    readerSettingsMock.effective.value.letterSpacing = null
    readerSettingsMock.effective.value.wordSpacing = null
    readerSettingsMock.effective.value.textIndent = null
    customFontsMock.cssFamilyAvailable.mockReturnValue(true)
    customFontsMock.fetchAllFonts.mockResolvedValue(undefined)
  })

  it('places one reset action at the end of the settings form', async () => {
    const wrapper = mount(EbookSettings, { props: { embedded: true } })
    await flushPromises()

    const resetAction = wrapper.get('[data-testid="settings-reset-action"]')
    const resetButtons = wrapper.findAll('button').filter((button) => button.text() === 'Reset to defaults')

    expect(resetButtons).toHaveLength(1)
    expect(wrapper.element.lastElementChild).toBe(resetAction.element)

    await resetButtons[0]!.trigger('click')
    expect(readerSettingsMock.reset).toHaveBeenCalledOnce()
  })

  it('associates the new font style select with its visible label', async () => {
    const wrapper = mount(EbookSettings, { props: { embedded: true } })
    await flushPromises()

    const select = wrapper.get('select[id^="ebook-font-style-"]')
    expect(wrapper.get(`label[for="${select.attributes('id')}"]`).text()).toBe('Font style')
  })

  it('shows and updates the paragraph spacing default', async () => {
    const wrapper = mount(EbookSettings, { props: { embedded: true } })
    await flushPromises()

    const slider = wrapper.get('input[id^="ebook-paragraph-spacing-"]')
    expect(wrapper.get(`label[for="${slider.attributes('id')}"]`).text()).toBe('Paragraph spacing')
    expect(slider.attributes('aria-valuetext')).toBe('Book default')

    await slider.setValue('1.2')
    expect(readerSettingsMock.update).toHaveBeenCalledWith({
      paragraphSpacing: 1.2,
    })
  })

  it('switches typography defaults between publisher and custom values', async () => {
    const wrapper = mount(EbookSettings, { props: { embedded: true } })
    await flushPromises()

    const letterSource = wrapper.get('select[id^="ebook-letter-spacing-source-"]')
    expect((letterSource.element as HTMLSelectElement).value).toBe('book')

    await letterSource.setValue('custom')
    expect(readerSettingsMock.update).toHaveBeenCalledWith({
      letterSpacing: 0,
    })

    readerSettingsMock.effective.value.letterSpacing = 0.1
    const customized = mount(EbookSettings, { props: { embedded: true } })
    await flushPromises()
    const slider = customized.get('input[id^="ebook-letter-spacing-"]')
    expect(slider.attributes('aria-valuetext')).toBe('0.1 em')
    await slider.setValue('0.13')
    expect(readerSettingsMock.update).toHaveBeenCalledWith({
      letterSpacing: 0.13,
    })

    await customized.get('select[id^="ebook-letter-spacing-source-"]').setValue('book')
    expect(readerSettingsMock.update).toHaveBeenCalledWith({
      letterSpacing: null,
    })
  })

  it('waits for both font catalogs before resetting an unavailable saved family', async () => {
    readerSettingsMock.effective.value.fontFamily = fontCssFamilyGroupName('Removed')
    readerSettingsMock.effective.value.fontWeight = 1000
    readerSettingsMock.effective.value.fontStyle = 'italic'
    customFontsMock.cssFamilyAvailable.mockReturnValue(false)
    customFontsMock.fetchAllFonts.mockImplementation(async () => {
      expect(readerSettingsMock.update).not.toHaveBeenCalled()
    })

    mount(EbookSettings, { props: { embedded: true } })
    await flushPromises()

    expect(readerSettingsMock.update).toHaveBeenCalledWith({
      fontFamily: null,
      fontWeight: 700,
      fontStyle: 'italic',
    })
  })
})
