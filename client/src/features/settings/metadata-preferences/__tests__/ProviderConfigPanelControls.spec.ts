import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfigurations, ProviderStatus } from '@bookorbit/types'
import ProviderConfigPanel from '../components/ProviderConfigPanel.vue'

const toastSuccess = vi.hoisted(() => vi.fn<(message: string) => void>())
const toastError = vi.hoisted(() => vi.fn<(message: string) => void>())

vi.mock('vue-sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}))

function makeConfig(overrides: Partial<ProviderConfigurations> = {}): ProviderConfigurations {
  return {
    google: { enabled: true, apiKey: 'google-key' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: 'cookie' },
    goodreads: { enabled: false },
    hardcover: { enabled: false, apiKey: '' },
    openLibrary: { enabled: false },
    itunes: { enabled: false, coverResolution: 'high' },
    audible: { enabled: false, domain: 'audible.com' },
    audnexus: { enabled: false },
    librofm: { enabled: false },
    comicvine: { enabled: false, apiKey: '' },
    ranobedb: { enabled: false },
    kobo: { enabled: false, country: 'us', language: 'en' },
    lubimyczytac: { enabled: false },
    aladin: { enabled: false, ttbKey: '' },
    ...overrides,
  }
}

/** Mirrors what the server reports for `makeConfig()`: only the two keyless secrets are unset. */
function makeStatuses(): ProviderStatus[] {
  const configured = (key: string, enabled: boolean, isConfigured = true) =>
    ({ key, label: key, enabled, configured: isConfigured }) as ProviderStatus
  return [
    configured('google', true),
    configured('amazon', true),
    configured('goodreads', false),
    configured('hardcover', false, false),
    configured('openLibrary', false),
    configured('itunes', false),
    configured('audible', false),
    configured('audnexus', false),
    configured('librofm', false),
    configured('comicvine', false, false),
    configured('ranobedb', false),
    configured('kobo', false),
    configured('lubimyczytac', false),
    configured('aladin', false, false),
  ]
}

function mountPanel(config: ProviderConfigurations = makeConfig(), statuses: ProviderStatus[] = makeStatuses()) {
  return mount(ProviderConfigPanel, { props: { config, statuses, saving: false }, attachTo: document.body })
}

function providerNames(wrapper: VueWrapper): string[] {
  return wrapper.findAll('[role="switch"]').map((toggle) => {
    const labelledBy = toggle.attributes('aria-labelledby') ?? ''
    return wrapper.get(`#${labelledBy}`).text()
  })
}

function clickFilter(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  if (!button) throw new Error(`No filter button labelled "${label}"`)
  return button.trigger('click')
}

function rowFor(wrapper: VueWrapper, name: string) {
  const toggle = wrapper.findAll('[role="switch"]').find((candidate) => {
    const labelledBy = candidate.attributes('aria-labelledby') ?? ''
    return wrapper.get(`#${labelledBy}`).text() === name
  })
  if (!toggle) throw new Error(`No row for "${name}"`)
  return toggle
}

function configureButtonFor(wrapper: VueWrapper, name: string) {
  const row = rowFor(wrapper, name).element.closest('div.relative')
  const button = row?.querySelector('button[aria-expanded]')
  if (!button) throw new Error(`No configure button for "${name}"`)
  return wrapper.find(`#${CSS.escape(button.getAttribute('aria-controls') ?? '')}`)
}

beforeEach(() => {
  toastError.mockClear()
})

describe('ProviderConfigPanel browsing', () => {
  it('sections every source under the medium it supplies', () => {
    const wrapper = mountPanel()

    const headings = wrapper.findAll('h3').map((heading) => heading.text())
    expect(headings).toEqual(['General book catalogues', 'Audiobooks', 'Comics & light novels', 'Regional catalogues'])
    wrapper.unmount()
  })

  it('narrows to the sources that are switched on', async () => {
    const wrapper = mountPanel()

    await clickFilter(wrapper, 'Enabled')

    expect(providerNames(wrapper)).toEqual(['Google Books', 'Amazon'])
    wrapper.unmount()
  })

  it('narrows to the sources that cannot be switched on yet', async () => {
    const wrapper = mountPanel()

    await clickFilter(wrapper, 'Needs setup')

    expect(providerNames(wrapper)).toEqual(['Hardcover', 'ComicVine', 'Aladin'])
    wrapper.unmount()
  })

  it('searches names and descriptions, and offers a way back from an empty result', async () => {
    const wrapper = mountPanel()
    const search = wrapper.get('input[type="search"]')

    await search.setValue('kobo')
    expect(providerNames(wrapper)).toEqual(['Kobo'])

    await search.setValue('korean')
    expect(providerNames(wrapper)).toEqual(['Aladin'])

    await search.setValue('nothing matches this')
    expect(wrapper.findAll('[role="switch"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('No sources match this filter')

    const clear = wrapper.findAll('button').find((candidate) => candidate.text() === 'Clear filters')
    await clear?.trigger('click')
    expect(wrapper.findAll('[role="switch"]')).toHaveLength(14)
    wrapper.unmount()
  })
})

describe('ProviderConfigPanel unsaved changes', () => {
  it('stays quiet until something changes, then names what changed', async () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).not.toContain('unsaved')

    await rowFor(wrapper, 'Open Library').trigger('click')
    await rowFor(wrapper, 'AudNexus').trigger('click')

    expect(wrapper.text()).toContain('2 unsaved changes')
    expect(wrapper.text()).toContain('Open Library')
    expect(wrapper.text()).toContain('AudNexus')
    wrapper.unmount()
  })

  it('puts every edit back the way the server has it', async () => {
    const wrapper = mountPanel()

    await rowFor(wrapper, 'Open Library').trigger('click')
    expect(rowFor(wrapper, 'Open Library').attributes('aria-checked')).toBe('true')

    const discard = wrapper.findAll('button').find((candidate) => candidate.text() === 'Discard')
    await discard?.trigger('click')

    expect(rowFor(wrapper, 'Open Library').attributes('aria-checked')).toBe('false')
    expect(wrapper.text()).not.toContain('unsaved')
    wrapper.unmount()
  })

  it('submits the whole draft', async () => {
    const wrapper = mountPanel()

    await rowFor(wrapper, 'Open Library').trigger('click')
    await wrapper.get('form').trigger('submit')

    const saved = wrapper.emitted('save')?.[0]?.[0] as ProviderConfigurations
    expect(saved.openLibrary.enabled).toBe(true)
    wrapper.unmount()
  })
})

describe('ProviderConfigPanel enable requirements', () => {
  it('refuses a source that is not configured, says why, and opens its settings', async () => {
    const wrapper = mountPanel()

    expect(configureButtonFor(wrapper, 'Hardcover').isVisible()).toBe(false)

    await rowFor(wrapper, 'Hardcover').trigger('click')

    expect(rowFor(wrapper, 'Hardcover').attributes('aria-checked')).toBe('false')
    expect(toastError).toHaveBeenCalledWith('Hardcover requires an API key before it can be enabled')
    expect(configureButtonFor(wrapper, 'Hardcover').isVisible()).toBe(true)
    wrapper.unmount()
  })

  it('lets a configured source through', async () => {
    const wrapper = mountPanel()

    await rowFor(wrapper, 'Kobo').trigger('click')

    expect(rowFor(wrapper, 'Kobo').attributes('aria-checked')).toBe('true')
    expect(toastError).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('marks a source active only once it is both configured and switched on', () => {
    const wrapper = mountPanel()

    const googleRow = rowFor(wrapper, 'Google Books').element.closest('div.relative')
    const koboRow = rowFor(wrapper, 'Kobo').element.closest('div.relative')

    expect(googleRow?.textContent).toContain('Active')
    expect(koboRow?.textContent).toContain('Ready')
    wrapper.unmount()
  })
})
