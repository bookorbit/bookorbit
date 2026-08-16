import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'

import { useWidgetData, WIDGET_RETRY_DELAYS_MS } from '../useWidgetData'

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
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  /** Drains the retry backoff so a permanently failing widget reaches its error state. */
  async function runOutRetries(): Promise<void> {
    for (let i = 0; i <= WIDGET_RETRY_DELAYS_MS.length; i++) {
      await vi.runAllTimersAsync()
    }
  }

  it('loads on mount', async () => {
    const fetcher = vi.fn<() => Promise<{ streak: number }>>().mockResolvedValue({ streak: 7 })
    const { widget } = mountWidget(fetcher)
    await vi.waitFor(() => expect(widget.loading.value).toBe(false))

    expect(widget.data.value).toEqual({ streak: 7 })
    expect(widget.error.value).toBe(false)
  })

  it('retries a request that did not come back before giving up', async () => {
    const fetcher = vi.fn<() => Promise<{ streak: number }>>().mockRejectedValueOnce(new Error('NetworkError')).mockResolvedValue({ streak: 7 })
    const { widget } = mountWidget(fetcher)
    await runOutRetries()

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(widget.data.value).toEqual({ streak: 7 })
    expect(widget.error.value).toBe(false)
    expect(widget.loading.value).toBe(false)
  })

  it('reports a failure without leaving the widget stuck loading', async () => {
    const fetcher = vi.fn<() => Promise<{ streak: number }>>().mockRejectedValue(new Error('Session expired'))
    const { widget } = mountWidget(fetcher)
    await runOutRetries()

    expect(fetcher).toHaveBeenCalledTimes(WIDGET_RETRY_DELAYS_MS.length + 1)
    expect(widget.loading.value).toBe(false)
    expect(widget.error.value).toBe(true)
    expect(widget.data.value).toBeNull()
  })

  it('reloads a failed widget once the session comes back', async () => {
    const fetcher = vi.fn<() => Promise<{ streak: number }>>().mockRejectedValue(new Error('Session expired'))
    const { widget } = mountWidget(fetcher)
    await runOutRetries()
    expect(widget.error.value).toBe(true)

    fetcher.mockResolvedValue({ streak: 7 })
    recoverSession()
    await vi.runAllTimersAsync()

    expect(widget.error.value).toBe(false)
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

  it('stops retrying and listening when the widget goes away', async () => {
    const fetcher = vi.fn<() => Promise<{ streak: number }>>().mockRejectedValue(new Error('Session expired'))
    const { wrapper, widget } = mountWidget(fetcher)
    await runOutRetries()
    expect(widget.error.value).toBe(true)

    const callsBeforeUnmount = fetcher.mock.calls.length
    wrapper.unmount()
    recoverSession()
    await vi.runAllTimersAsync()

    expect(fetcher).toHaveBeenCalledTimes(callsBeforeUnmount)
    expect(recoveryListeners.size).toBe(0)
  })
})
