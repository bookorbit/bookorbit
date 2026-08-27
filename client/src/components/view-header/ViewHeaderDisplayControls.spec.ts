import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ViewHeaderDisplayControls from './ViewHeaderDisplayControls.vue'

function mountControls(overrides: Partial<InstanceType<typeof ViewHeaderDisplayControls>['$props']> = {}) {
  return mount(ViewHeaderDisplayControls, {
    props: {
      viewMode: 'grid',
      coverSize: 120,
      gridGap: 24,
      ...overrides,
    },
  })
}

describe('ViewHeaderDisplayControls', () => {
  it('renders the jump rail checkbox in grid mode and emits changes', async () => {
    const wrapper = mountControls({ showJumpRailToggle: true, showJumpRails: true })
    const checkbox = wrapper.get('input[type="checkbox"]')

    expect(wrapper.text()).toContain('Show jump rails')
    expect((checkbox.element as HTMLInputElement).checked).toBe(true)

    await checkbox.setValue(false)

    expect(wrapper.emitted('update:showJumpRails')).toEqual([[false]])
  })

  it('renders the cover fallback checkbox only for views that offer it', async () => {
    // A declared Boolean prop is false, not undefined, so presence must be its own
    // flag or this control leaks into every view that renders these settings.
    expect(mountControls({ coverFallback: true }).find('input[type="checkbox"]').exists()).toBe(false)

    const wrapper = mountControls({ showCoverFallbackToggle: true, coverFallback: true })
    const checkbox = wrapper.get('input[type="checkbox"]')

    expect((checkbox.element as HTMLInputElement).checked).toBe(true)
    await checkbox.setValue(false)
    expect(wrapper.emitted('update:coverFallback')).toEqual([[false]])
  })

  it('omits the jump rail checkbox when unsupported or outside grid mode', () => {
    expect(mountControls().find('input[type="checkbox"]').exists()).toBe(false)
    expect(mountControls({ viewMode: 'list', showJumpRailToggle: true, showJumpRails: true }).find('input[type="checkbox"]').exists()).toBe(false)
    expect(mountControls({ viewMode: 'table', showJumpRailToggle: true, showJumpRails: true }).find('input[type="checkbox"]').exists()).toBe(false)
  })
})
