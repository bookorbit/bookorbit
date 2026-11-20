import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import BrowseHeader from './BrowseHeader.vue'

const stubs = { AppIcon: true, PageMenuButton: true, BrowseTitleSwitcher: { template: '<span data-testid="switcher" />' } }

function scroller(top: number) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: top })
  return el
}

describe('BrowseHeader', () => {
  it('lets a page supply its own eyebrow and title in place of the defaults', () => {
    const wrapper = mount(BrowseHeader, {
      props: { eyebrow: 'Browse', title: 'Fantasy', switcher: { kind: 'library', id: 1 } },
      slots: { eyebrow: '<a data-testid="eyebrow">Genres</a>', title: '<button data-testid="title">Fantasy</button>' },
      global: { stubs },
    })

    expect(wrapper.get('[data-testid="eyebrow"]').text()).toBe('Genres')
    expect(wrapper.get('[data-testid="title"]').text()).toBe('Fantasy')
    expect(wrapper.find('[data-testid="switcher"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Browse')
  })

  it('keeps the place switcher when no title is supplied', () => {
    const wrapper = mount(BrowseHeader, {
      props: { eyebrow: 'Library', title: 'Novels', switcher: { kind: 'library', id: 1 } },
      global: { stubs },
    })

    expect(wrapper.find('[data-testid="switcher"]').exists()).toBe(true)
  })

  it('renders the strip below the title and folds it away with the title row', async () => {
    const el = scroller(0)
    const wrapper = mount(BrowseHeader, {
      props: { eyebrow: 'Genres', title: 'Fantasy', scrollContainer: el },
      slots: { below: '<div data-testid="strip">Similar names</div>' },
      global: { stubs },
    })
    const strip = wrapper.get('[data-testid="strip"]')
    const fold = strip.element.parentElement!.parentElement!

    expect(fold.hasAttribute('inert')).toBe(false)

    el.scrollTop = 200
    el.dispatchEvent(new Event('scroll'))
    await nextTick()

    expect(fold.hasAttribute('inert')).toBe(true)
    expect(fold.className).toContain('grid-rows-[0fr]')
  })

  it('leaves no strip wrapper when a page has nothing below its title', () => {
    const wrapper = mount(BrowseHeader, { props: { eyebrow: 'Library', title: 'Novels' }, global: { stubs } })

    expect(wrapper.findAll('header > div.grid')).toHaveLength(1)
  })
})
