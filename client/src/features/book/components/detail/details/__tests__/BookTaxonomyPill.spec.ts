import { describe, expect, it } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import BookTaxonomyPill from '../BookTaxonomyPill.vue'

function mountPill(props: InstanceType<typeof BookTaxonomyPill>['$props']) {
  return mount(BookTaxonomyPill, { props, global: { stubs: { RouterLink: RouterLinkStub } } })
}

describe('BookTaxonomyPill', () => {
  it('links a genre with an id to its page', () => {
    const wrapper = mountPill({ kind: 'genre', name: 'Fantasy', id: 31 })

    const link = wrapper.getComponent(RouterLinkStub)
    expect(link.props('to')).toEqual({ name: 'genre-detail', params: { id: 31 } })
    expect(link.text()).toBe('Fantasy')
    expect(link.classes()).toEqual(expect.arrayContaining(['book-taxonomy-pill', 'is-link', 'chip-genre']))
  })

  it('prefixes a tag with # and links it to the tag page', () => {
    const wrapper = mountPill({ kind: 'tag', name: 'favorites', id: 4 })

    const link = wrapper.getComponent(RouterLinkStub)
    expect(link.props('to')).toEqual({ name: 'tag-detail', params: { id: 4 } })
    expect(link.text()).toBe('#favorites')
    expect(link.classes()).toEqual(expect.arrayContaining(['chip-tag', 'border']))
  })

  it('stays plain text without an id', () => {
    const wrapper = mountPill({ kind: 'genre', name: 'Fantasy' })

    expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(false)
    expect(wrapper.element.tagName).toBe('SPAN')
    expect(wrapper.classes()).not.toContain('is-link')
  })

  it('tells its container when it is followed, so a popover holding it can close', async () => {
    const wrapper = mountPill({ kind: 'genre', name: 'Fantasy', id: 31 })

    await wrapper.getComponent(RouterLinkStub).trigger('click')

    expect(wrapper.emitted('navigate')).toHaveLength(1)
  })
})
