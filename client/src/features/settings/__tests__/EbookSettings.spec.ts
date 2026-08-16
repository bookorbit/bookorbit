import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import EbookSettings from '../EbookSettings.vue'

const readerSettingsMock = vi.hoisted(() => ({
  effective: {
    __v_isRef: true,
    value: {
      themeName: 'default',
      isDark: false,
      fontFamily: null,
      fontSize: 16,
      lineHeight: 1.5,
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
    },
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
})
