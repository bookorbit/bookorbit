import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import BookCardLabel from './BookCardLabel.vue'

enableAutoUnmount(afterEach)

const title = 'The Science of Discworld IV: Judgement Day'

describe('BookCardLabel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('reveals the full link text on hover only when it is clipped', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/books/:bookId', component: { template: '<div />' } }],
    })
    await router.push('/books/7')
    const wrapper = mount(BookCardLabel, {
      attachTo: document.body,
      props: { text: title, to: '/books/7' },
      global: { plugins: [router] },
    })
    const link = wrapper.get('a[href="/books/7"]')
    const measureWidth = vi.fn<() => number>(() => 240)
    Object.defineProperties(link.get('span').element, {
      clientWidth: { get: measureWidth },
      scrollWidth: { value: 240 },
    })

    await link.trigger('pointermove')
    await vi.waitFor(() => expect(measureWidth).toHaveBeenCalled())
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()

    await link.trigger('pointerleave')
    measureWidth.mockReturnValue(100)
    await link.trigger('pointermove')
    await vi.waitFor(() => expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(title))
  })

  it('reveals clipped button text on keyboard focus and dismisses it on Escape', async () => {
    const wrapper = mount(BookCardLabel, { attachTo: document.body, props: { text: title } })
    const button = wrapper.get('button')
    Object.defineProperties(button.get('span').element, {
      clientWidth: { value: 100 },
      scrollWidth: { value: 240 },
    })

    button.element.focus()
    await nextTick()
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(title)

    await button.trigger('keydown', { key: 'Escape' })
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('reveals a title clipped by its two-line limit', async () => {
    const wrapper = mount(BookCardLabel, { attachTo: document.body, props: { text: title, as: 'p', lines: 2 } })
    const paragraph = wrapper.get('p')
    Object.defineProperties(paragraph.get('span').element, {
      clientWidth: { value: 80 },
      scrollWidth: { value: 80 },
      clientHeight: { value: 30 },
      scrollHeight: { value: 60 },
    })

    paragraph.element.focus()
    await nextTick()
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(title)
  })
})
