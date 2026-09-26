import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from '../EmptyState.vue'

describe('EmptyState', () => {
  it('renders the icon, title, hint, and actions', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'ListMusic', title: 'No episodes yet', hint: 'Follow a show to see its episodes here.' },
      slots: { actions: '<button type="button">Browse shows</button>' },
    })

    expect(wrapper.find('.lucide-list-music').exists()).toBe(true)
    expect(wrapper.get('h2').text()).toBe('No episodes yet')
    expect(wrapper.get('p').text()).toBe('Follow a show to see its episodes here.')
    expect(wrapper.get('button').text()).toBe('Browse shows')
  })

  it('collapses to the title alone when nothing else is supplied', () => {
    const wrapper = mount(EmptyState, { props: { title: 'Nothing here' } })

    expect(wrapper.get('h2').text()).toBe('Nothing here')
    expect(wrapper.get('h2').classes()).not.toContain('mt-4')
    expect(wrapper.find('p').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(false)
  })
})
