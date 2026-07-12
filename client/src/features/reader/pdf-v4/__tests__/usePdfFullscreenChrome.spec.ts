import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { usePdfFullscreenChrome } from '../composables/usePdfFullscreenChrome'

describe('usePdfFullscreenChrome', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-hides only in fullscreen and keeps a session pin', async () => {
    vi.useFakeTimers()
    const fullscreen = ref(false)
    const openUi = ref(false)
    let chrome!: ReturnType<typeof usePdfFullscreenChrome>
    const wrapper = mount(
      defineComponent({
        setup() {
          chrome = usePdfFullscreenChrome(fullscreen, openUi)
          return () => h('div')
        },
      }),
    )

    await vi.advanceTimersByTimeAsync(3000)
    expect(chrome.visible.value).toBe(true)

    fullscreen.value = true
    await vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(2500)
    expect(chrome.visible.value).toBe(false)

    chrome.reveal()
    chrome.togglePinned()
    await vi.advanceTimersByTimeAsync(3000)
    expect(chrome.visible.value).toBe(true)

    fullscreen.value = false
    await vi.runAllTicks()
    expect(chrome.pinned.value).toBe(true)

    fullscreen.value = true
    await vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(3000)
    expect(chrome.visible.value).toBe(true)

    chrome.togglePinned()
    await vi.advanceTimersByTimeAsync(2500)
    expect(chrome.visible.value).toBe(false)
    wrapper.unmount()
  })
})
