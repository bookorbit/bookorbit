import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
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
  })
})
