import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'

import { useWidgetData } from '../useWidgetData'

const { recoveryListeners } = vi.hoisted(() => ({ recoveryListeners: new Set<() => void>() }))

vi.mock('@/lib/api', () => ({
  onAuthRecovered: (listener: () => void) => {
    recoveryListeners.add(listener)
    return () => recoveryListeners.delete(listener)
  },
}))

function recoverSession(): void {
  for (const listener of new Set(recoveryListeners)) listener()
}

function mountWidget<T>(fetcher: () => Promise<T>) {
  let widget!: ReturnType<typeof useWidgetData<T>>
  const wrapper = mount(
    defineComponent({
      setup() {
        widget = useWidgetData(fetcher)
        return () => null
      },
    }),
  )
  return { wrapper, widget }
}

describe('useWidgetData', () => {
  beforeEach(() => {
    recoveryListeners.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads on mount', async () => {
    const fetcher = vi.fn<() => Promise<{ streak: number }>>().mockResolvedValue({ streak: 7 })
    const { widget } = mountWidget(fetcher)
    await vi.waitFor(() => expect(widget.loading.value).toBe(false))

    expect(widget.data.value).toEqual({ streak: 7 })
    expect(widget.error.value).toBe(false)
  })

  it('reports a failure without leaving the widget stuck loading', async () => {
    const fetcher = vi.fn<() => Promise<{ streak: number }>>().mockRejectedValue(new Error('Session expired'))
    const { widget } = mountWidget(fetcher)
    await vi.waitFor(() => expect(widget.loading.value).toBe(false))

    expect(widget.error.value).toBe(true)
    expect(widget.data.value).toBeNull()
  })

  it('reloads a failed widget once the session comes back', async () => {
    const fetcher = vi.fn<() => Promise<{ streak: number }>>().mockRejectedValueOnce(new Error('Session expired')).mockResolvedValue({ streak: 7 })
    const { widget } = mountWidget(fetcher)
    await vi.waitFor(() => expect(widget.error.value).toBe(true))

    recoverSession()
    await vi.waitFor(() => expect(widget.error.value).toBe(false))

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(widget.data.value).toEqual({ streak: 7 })
  })

  it('leaves a widget that loaded alone', async () => {
    const fetcher = vi.fn<() => Promise<{ streak: number }>>().mockResolvedValue({ streak: 7 })
    const { widget } = mountWidget(fetcher)
    await vi.waitFor(() => expect(widget.loading.value).toBe(false))

    recoverSession()
    await Promise.resolve()

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('stops listening when the widget goes away', async () => {
    const fetcher = vi.fn<() => Promise<{ streak: number }>>().mockRejectedValue(new Error('Session expired'))
    const { wrapper, widget } = mountWidget(fetcher)
    await vi.waitFor(() => expect(widget.error.value).toBe(true))

    wrapper.unmount()
    recoverSession()
    await Promise.resolve()

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(recoveryListeners.size).toBe(0)
  })
})
