import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useVisibility } from '../useVisibility'

function mountVisibility() {
  let visibility!: ReturnType<typeof useVisibility>
  const wrapper = mount(
    defineComponent({
      setup() {
        visibility = useVisibility()
        return () => h('div')
      },
    }),
  )

  return { visibility, wrapper }
}

describe('useVisibility', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('temporarily reveals unpinned controls from a middle tap', async () => {
    vi.useFakeTimers()
    const { visibility, wrapper } = mountVisibility()

    visibility.handleMiddleTap()

    expect(visibility.isPinned.value).toBe(false)
    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)

    await vi.advanceTimersByTimeAsync(3000)

    expect(visibility.headerVisible.value).toBe(false)
    expect(visibility.footerVisible.value).toBe(false)
    wrapper.unmount()
  })

  it('hides temporarily visible controls on the next middle tap', () => {
    vi.useFakeTimers()
    const { visibility, wrapper } = mountVisibility()

    visibility.handleMiddleTap()
    visibility.handleMiddleTap()

    expect(visibility.isPinned.value).toBe(false)
    expect(visibility.headerVisible.value).toBe(false)
    expect(visibility.footerVisible.value).toBe(false)
    wrapper.unmount()
  })

  it('keeps pinned controls visible until explicitly unpinned', async () => {
    vi.useFakeTimers()
    const { visibility, wrapper } = mountVisibility()

    visibility.handleMiddleTap()
    visibility.togglePinned()
    await vi.advanceTimersByTimeAsync(3000)

    expect(visibility.isPinned.value).toBe(true)
    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)

    visibility.handleMiddleTap()
    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)

    visibility.togglePinned()
    expect(visibility.isPinned.value).toBe(false)
    expect(visibility.headerVisible.value).toBe(true)
    expect(visibility.footerVisible.value).toBe(true)

    await vi.advanceTimersByTimeAsync(3000)
    expect(visibility.headerVisible.value).toBe(false)
    expect(visibility.footerVisible.value).toBe(false)
    wrapper.unmount()
  })
})
