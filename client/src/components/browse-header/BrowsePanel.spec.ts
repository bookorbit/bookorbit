import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BrowsePanel from './BrowsePanel.vue'

function makeToken() {
  const token = document.createElement('span')
  token.innerHTML = '<button type="button">Read Status is Unread. Edit</button><button type="button">Remove</button>'
  document.body.appendChild(token)
  return { token, anchor: { getBoundingClientRect: () => token.getBoundingClientRect(), contextElement: token } }
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(BrowsePanel, {
    attachTo: document.body,
    props: { title: 'Filters', open: false, ...props },
    slots: {
      trigger: '<button type="button" data-testid="trigger">Filters</button>',
      default: '<input aria-label="Find a field" />',
    },
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('BrowsePanel', () => {
  it('keeps the same bar button when the panel moves onto a token', async () => {
    const wrapper = mountPanel()
    const before = wrapper.get('[data-testid="trigger"]').element

    await wrapper.setProps({ anchor: makeToken().anchor, open: true })
    await flushPromises()

    expect(wrapper.get('[data-testid="trigger"]').element).toBe(before)
    expect(before.getAttribute('aria-expanded')).toBe('true')
    wrapper.unmount()
  })

  it('hands focus back to the token that opened it', async () => {
    const { token, anchor } = makeToken()
    const wrapper = mountPanel({ anchor, open: true })
    await flushPromises()

    await wrapper.setProps({ open: false })
    await flushPromises()

    expect(document.activeElement).toBe(token.querySelector('button'))
    wrapper.unmount()
  })
})
