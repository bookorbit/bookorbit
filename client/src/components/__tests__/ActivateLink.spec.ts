import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import ActivateLink from '../ActivateLink.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/books/:bookId', name: 'book-detail', component: { template: '<div />' } }],
})

function mountLink(props: { claimModifiers?: boolean } = {}) {
  return mount(ActivateLink, {
    props: { to: { name: 'book-detail', params: { bookId: 7 } }, ...props },
    attrs: { class: 'card-link', 'data-testid': 'link' },
    slots: { default: 'Open book' },
    global: { plugins: [router] },
  })
}

function click(element: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
  element.dispatchEvent(event)
  return event
}

describe('ActivateLink', () => {
  it('renders an anchor to the route and forwards attributes to it', () => {
    const wrapper = mountLink()
    const link = wrapper.get('a')

    expect(link.attributes('href')).toBe('/books/7')
    expect(link.classes()).toContain('card-link')
    expect(link.attributes('data-testid')).toBe('link')
    expect(link.text()).toBe('Open book')
  })

  it('hands a plain click to the caller and stops the browser following the link', () => {
    const wrapper = mountLink()
    const event = click(wrapper.get('a').element)

    expect(wrapper.emitted('activate')).toHaveLength(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }])('leaves a %o click to the browser', (init) => {
    const wrapper = mountLink()
    const event = click(wrapper.get('a').element, init)

    expect(wrapper.emitted('activate')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })

  it('claims Ctrl+click when asked, but never a middle click', () => {
    const wrapper = mountLink({ claimModifiers: true })
    const ctrl = click(wrapper.get('a').element, { ctrlKey: true })

    expect(wrapper.emitted('activate')).toHaveLength(1)
    expect(ctrl.defaultPrevented).toBe(true)

    const middle = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    wrapper.get('a').element.dispatchEvent(middle)
    expect(wrapper.emitted('activate')).toHaveLength(1)
    expect(middle.defaultPrevented).toBe(false)
  })

  it('keeps clicks and middle clicks from reaching the card around it', () => {
    const onClick = vi.fn<() => void>()
    const onAuxClick = vi.fn<() => void>()
    const Parent = defineComponent({
      components: { ActivateLink },
      setup: () => ({ onClick, onAuxClick, to: { name: 'book-detail', params: { bookId: 7 } } }),
      template: '<div @click="onClick" @auxclick="onAuxClick"><ActivateLink :to="to">Open</ActivateLink></div>',
    })
    const wrapper = mount(Parent, { global: { plugins: [router] } })
    const anchor = wrapper.get('a').element

    click(anchor)
    click(anchor, { ctrlKey: true })
    anchor.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))

    expect(onClick).not.toHaveBeenCalled()
    expect(onAuxClick).not.toHaveBeenCalled()
  })
})
