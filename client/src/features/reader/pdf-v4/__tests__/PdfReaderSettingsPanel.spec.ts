import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PdfReaderSettingsPanel from '../components/PdfReaderSettingsPanel.vue'

function mountPanel() {
  return mount(PdfReaderSettingsPanel, {
    props: {
      scrollMode: 'vertical',
      spread: 'none',
      rotation: 0,
      zoomMode: 'fit-page',
      customScale: 1,
    },
  })
}

describe('PdfReaderSettingsPanel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces zoom previews and persists only the committed slider value', async () => {
    vi.useFakeTimers()
    const wrapper = mountPanel()
    const slider = wrapper.get('input[type="range"]')
    const element = slider.element as HTMLInputElement

    element.value = '1.5'
    await slider.trigger('input')
    element.value = '1.75'
    await slider.trigger('input')

    await vi.advanceTimersByTimeAsync(99)
    expect(wrapper.emitted('previewZoom')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.emitted('previewZoom')).toEqual([[1.75]])
    expect(wrapper.emitted('setZoom')).toBeUndefined()

    element.value = '2'
    await slider.trigger('input')
    await slider.trigger('change')
    await vi.runAllTimersAsync()

    expect(wrapper.emitted('previewZoom')).toEqual([[1.75]])
    expect(wrapper.emitted('setZoom')).toEqual([['custom', 2]])
  })

  it('exposes page, horizontal, automatic zoom, and auto spread choices', async () => {
    const wrapper = mountPanel()
    const buttons = wrapper.findAll('button')
    const clickLabel = async (label: string) => buttons.find((button) => button.text() === label)!.trigger('click')

    await clickLabel('Page')
    await clickLabel('Horizontal scroll')
    await clickLabel('Automatic')
    await clickLabel('Auto')

    expect(wrapper.emitted('setScrollMode')).toEqual([['page'], ['horizontal']])
    expect(wrapper.emitted('setZoom')).toEqual([['automatic']])
    expect(wrapper.emitted('setSpread')).toEqual([['auto']])
  })
})
