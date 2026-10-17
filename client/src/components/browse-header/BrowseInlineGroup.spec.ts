import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, ref } from 'vue'
import BrowseInlineGroup from './BrowseInlineGroup.vue'
import { BROWSE_BAR_KEY } from './browse-header'

const passthrough = { template: '<div><slot /></div>' }
const stubs = { Popover: passthrough, PopoverTrigger: passthrough, PopoverContent: { template: '<div data-testid="popover"><slot /></div>' } }

let resizeCallbacks: (() => void)[] = []

class MockResizeObserver {
  constructor(callback: () => void) {
    resizeCallbacks.push(callback)
  }
  observe = vi.fn<(target: Element) => void>()
  unobserve = vi.fn<(target: Element) => void>()
  disconnect = vi.fn<() => void>()
}

/**
 * A bar of `barWidth` holding a 200px sibling and the search field, with the group's natural width
 * reported by its measurer. Only widths matter to the fit, so layout is faked rather than rendered.
 */
function mountInBar(barWidth: number, naturalWidth: number) {
  const Host = defineComponent({
    setup() {
      const bar = ref<HTMLElement | null>(null)
      provide(BROWSE_BAR_KEY, bar)
      return () =>
        h('div', { ref: bar, 'data-testid': 'bar' }, [
          h('span', { 'data-testid': 'sibling' }),
          h('div', { 'data-browse-grow': '' }),
          h(BrowseInlineGroup, { label: 'Format', value: null }, { default: () => h('button', { class: 'chip' }, 'EPUB 380') }),
        ])
    },
  })
  const wrapper = mount(Host, { attachTo: document.body, global: { stubs } })
  const barEl = wrapper.get('[data-testid="bar"]').element as HTMLElement
  Object.defineProperty(barEl, 'clientWidth', { configurable: true, get: () => barWidth })
  for (const child of Array.from(barEl.children) as HTMLElement[]) {
    Object.defineProperty(child, 'offsetParent', { configurable: true, get: () => barEl })
  }
  const sibling = wrapper.get('[data-testid="sibling"]').element as HTMLElement
  sibling.getBoundingClientRect = () => ({ width: 200 }) as DOMRect
  const measurer = barEl.querySelector('[inert]') as HTMLElement
  Object.defineProperty(measurer, 'scrollWidth', { configurable: true, get: () => naturalWidth })
  return wrapper
}

async function remeasure() {
  for (const callback of resizeCallbacks) callback()
  await nextTick()
}

beforeEach(() => {
  resizeCallbacks = []
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('BrowseInlineGroup', () => {
  it('sits inline when it fits beside a usable search field', async () => {
    // 1000 - 200 sibling - 240 search floor leaves 560 for a 400px group.
    const wrapper = mountInBar(1000, 400)
    await remeasure()

    expect(wrapper.find('[role="group"][aria-label="Format"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="popover"]').exists()).toBe(false)
  })

  it('folds into a dropdown in the same place when it does not', async () => {
    const wrapper = mountInBar(700, 400)
    await remeasure()

    expect(wrapper.find('[data-testid="popover"]').exists()).toBe(true)
    expect(wrapper.find('button[title="Format"]').exists()).toBe(true)
  })

  it('needs some spare room before unfolding, so it does not flicker at the edge', async () => {
    // 840 - 200 - 240 = 400 exactly: an inline group stays, a folded one waits for headroom.
    const wrapper = mountInBar(840, 400)
    await remeasure()
    expect(wrapper.find('[data-testid="popover"]').exists()).toBe(true)
  })
})
