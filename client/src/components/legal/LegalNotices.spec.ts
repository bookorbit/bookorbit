import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import LegalNotices from './LegalNotices.vue'
import PublicLegalNotices from './PublicLegalNotices.vue'
import { useLegalNotices } from './useLegalNotices'

vi.mock('reka-ui', () => ({
  DialogRoot: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
  DialogPortal: { template: '<div><slot /></div>' },
  DialogOverlay: { template: '<div />' },
  DialogContent: { template: '<section class="legal-dialog"><slot /></section>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
  DialogDescription: { template: '<p><slot /></p>' },
}))

describe('LegalNotices', () => {
  beforeEach(() => {
    useLegalNotices().closeLegalNotices()
  })

  it('keeps the legal notice available without authentication or elevated permission', async () => {
    const wrapper = mount(LegalNotices)

    useLegalNotices().openLegalNotices()
    await nextTick()

    expect(wrapper.get('.legal-dialog').text()).toContain('Powered by BookOrbit')
    expect(wrapper.get('.legal-dialog').text()).toContain('Copyright (C) 2025-2026 neon.')
    expect(wrapper.get('.legal-dialog').text()).toContain('Additional copyright is held by the respective BookOrbit contributors.')
    expect(wrapper.get('.legal-dialog').text()).toContain('provided without warranty')
  })

  it('links attribution, source, license, and additional terms to the project', async () => {
    const wrapper = mount(LegalNotices)
    useLegalNotices().openLegalNotices()
    await nextTick()

    const links = wrapper.findAll('a')
    expect(links.map((link) => link.attributes('href'))).toEqual([
      'https://github.com/bookorbit/bookorbit',
      'https://github.com/bookorbit/bookorbit',
      'https://github.com/bookorbit/bookorbit/blob/main/LICENSE',
      'https://github.com/bookorbit/bookorbit/blob/main/ADDITIONAL_TERMS.md',
    ])
  })

  it('uses an inline linked attribution on public pages', async () => {
    const wrapper = mount(PublicLegalNotices)

    const attribution = wrapper.get('a')
    expect(attribution.text()).toBe('Powered by BookOrbit')
    expect(attribution.attributes('href')).toBe('https://github.com/bookorbit/bookorbit')
    expect(wrapper.classes()).not.toContain('fixed')

    await wrapper.get('button').trigger('click')
    expect(useLegalNotices().open.value).toBe(true)
  })
})
