import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { MetadataFetchOptions } from '@bookorbit/types'
import AdvancedFetchOptions from '../components/AdvancedFetchOptions.vue'

function options(providerIdMode: MetadataFetchOptions['providerIdMode'] = 'preferExisting'): MetadataFetchOptions {
  return {
    genres: { mode: 'merge', blocklist: [], maxCount: null },
    saveProviderIds: true,
    providerIdMode,
  }
}

function identityModeSwitch(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('button[aria-labelledby="existing-provider-ids-only-label"]')
}

describe('AdvancedFetchOptions', () => {
  it('renders the existing-provider-id restriction with an accessible explanation', () => {
    const wrapper = mount(AdvancedFetchOptions, { props: { options: options() } })

    expect(wrapper.text()).toContain('Use existing provider IDs only')
    expect(wrapper.text()).toContain('Manual search and new-book discovery are unaffected.')
    expect(identityModeSwitch(wrapper).attributes('role')).toBe('switch')
    expect(identityModeSwitch(wrapper).attributes('aria-checked')).toBe('false')
  })

  it('enables and disables existing-only mode without changing other advanced options', async () => {
    const initial = options()
    const wrapper = mount(AdvancedFetchOptions, { props: { options: initial } })

    await identityModeSwitch(wrapper).trigger('click')
    expect(wrapper.emitted('change')?.[0]?.[0]).toEqual({ ...initial, providerIdMode: 'existingOnly' })

    await wrapper.setProps({ options: options('existingOnly') })
    expect(identityModeSwitch(wrapper).attributes('aria-checked')).toBe('true')
    await identityModeSwitch(wrapper).trigger('click')
    expect(wrapper.emitted('change')?.[1]?.[0]).toEqual({ ...initial, providerIdMode: 'preferExisting' })
  })

  it('disables the new setting while preferences are being saved', () => {
    const wrapper = mount(AdvancedFetchOptions, { props: { options: options('existingOnly'), disabled: true } })

    expect(identityModeSwitch(wrapper).attributes('disabled')).toBeDefined()
  })
})
