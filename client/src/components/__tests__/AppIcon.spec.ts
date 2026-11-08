import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Library } from '@lucide/vue'
import AppIcon from '../AppIcon.vue'

describe('AppIcon', () => {
  it('renders a custom icon as a mask built from the slug, without a list lookup', () => {
    const wrapper = mount(AppIcon, { props: { icon: 'custom:my-star', size: 24 } })
    const span = wrapper.find('span')
    expect(span.exists()).toBe(true)
    const style = span.attributes('style') ?? ''
    expect(style).toContain('/api/v1/custom-icons/my-star.svg')
    expect(style).toContain('24px')
  })

  it('renders nothing for an unknown lucide icon with no fallback', () => {
    const wrapper = mount(AppIcon, { props: { icon: 'ThisIconDoesNotExist1234' } })
    expect(wrapper.find('span').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('references a stored lucide name from its own icon file, with the class lucide components carry', () => {
    const wrapper = mount(AppIcon, { props: { icon: 'FolderOpen', size: 20 }, attrs: { class: 'text-primary' } })
    const svg = wrapper.find('svg')
    expect(svg.classes()).toEqual(expect.arrayContaining(['lucide', 'lucide-folder-open', 'text-primary']))
    expect(svg.attributes('width')).toBe('20')
    expect(svg.attributes('stroke')).toBe('currentColor')
    expect(wrapper.find('use').attributes('href')).toMatch(/\/assets\/lucide\/[^/]+\/folder-open\.svg#folder-open$/)
  })

  it('renders the old name of a renamed icon', () => {
    const wrapper = mount(AppIcon, { props: { icon: 'AlertTriangle' } })
    expect(wrapper.find('svg').classes()).toContain('lucide-triangle-alert')
  })

  it('renders a component fallback when the stored name is unknown', () => {
    const wrapper = mount(AppIcon, { props: { icon: 'NotAnIcon1234', fallback: Library, size: 18 } })
    expect(wrapper.find('use').exists()).toBe(false)
    expect(wrapper.find('svg').classes()).toContain('lucide-library')
  })

  it('prefers the stored name over a component fallback', () => {
    const wrapper = mount(AppIcon, { props: { icon: 'Star', fallback: Library } })
    expect(wrapper.find('svg').classes()).toContain('lucide-star')
  })

  it('resolves a fallback given as a name', () => {
    const wrapper = mount(AppIcon, { props: { icon: null, fallback: 'BookOpen' } })
    expect(wrapper.find('use').attributes('href')).toContain('book-open.svg#book-open')
  })
})
