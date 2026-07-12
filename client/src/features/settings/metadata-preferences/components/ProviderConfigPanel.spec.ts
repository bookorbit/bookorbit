import { mount } from '@vue/test-utils'
import type { ProviderConfigurations } from '@bookorbit/types'
import { describe, expect, it } from 'vitest'

import ProviderConfigPanel from './ProviderConfigPanel.vue'

function legacyConfigWithoutLibroFm(): ProviderConfigurations {
  return {
    google: { enabled: false, apiKey: '' },
    amazon: { enabled: false, domain: 'amazon.com', cookie: '' },
    goodreads: { enabled: false },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: false },
    itunes: { enabled: false, coverResolution: 'high' },
    audible: { enabled: false, domain: 'com' },
    audnexus: { enabled: false },
    comicvine: { enabled: false, apiKey: '' },
    ranobedb: { enabled: false },
    kobo: { enabled: false, country: 'us', language: 'en' },
    lubimyczytac: { enabled: false },
    aladin: { enabled: false, ttbKey: '' },
  } as ProviderConfigurations
}

describe('ProviderConfigPanel', () => {
  it('does not render or submit providers missing from the backend contract', async () => {
    const wrapper = mount(ProviderConfigPanel, {
      props: {
        config: legacyConfigWithoutLibroFm(),
        statuses: [],
        saving: false,
      },
    })

    expect(wrapper.text()).not.toContain('Libro.fm')
    expect(wrapper.findAll('[role="switch"]')).toHaveLength(13)
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('save')?.[0]?.[0]).not.toHaveProperty('librofm')
    wrapper.unmount()
  })

  it('renders Libro.fm when the backend includes its configuration section', () => {
    const wrapper = mount(ProviderConfigPanel, {
      props: {
        config: { ...legacyConfigWithoutLibroFm(), librofm: { enabled: false } },
        statuses: [],
        saving: false,
      },
    })

    expect(wrapper.text()).toContain('Libro.fm')
    expect(wrapper.findAll('[role="switch"]')).toHaveLength(14)
    wrapper.unmount()
  })
})
