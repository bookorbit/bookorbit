import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ViewHeaderMobileMenu from './ViewHeaderMobileMenu.vue'

describe('ViewHeaderMobileMenu', () => {
  it('names its icon-only trigger', () => {
    const wrapper = mount(ViewHeaderMobileMenu, { props: { viewMode: 'grid' } })

    expect(wrapper.get('button').attributes('aria-label')).toBe('View options')
  })
})
