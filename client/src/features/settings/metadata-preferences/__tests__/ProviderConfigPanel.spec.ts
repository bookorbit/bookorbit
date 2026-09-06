import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ProviderConfigurations, ProviderStatus } from '@bookorbit/types'
import ProviderConfigPanel from '../components/ProviderConfigPanel.vue'

/**
 * The Metadata tab is the default settings surface that holds saved provider
 * secrets. While these rendered as `input[type="password"]`, every settings tab
 * click unmounted a populated password form during a `history.pushState`, which
 * is exactly Chrome's heuristic for a submitted login form: it popped the
 * "Update password?" bubble. These tests pin the field shape that keeps the
 * panel out of Chrome's password manager.
 */
function makeConfig(overrides: Partial<ProviderConfigurations> = {}): ProviderConfigurations {
  return {
    google: { enabled: true, apiKey: 'google-secret-key' },
    amazon: { enabled: true, domain: 'amazon.com', cookie: 'amazon-session-cookie' },
    goodreads: { enabled: false },
    hardcover: { enabled: true, apiKey: 'hardcover-secret-key' },
    openLibrary: { enabled: false },
    itunes: { enabled: false, coverResolution: 'high' },
    audible: { enabled: false, domain: 'audible.com' },
    audnexus: { enabled: false },
    librofm: { enabled: false },
    comicvine: { enabled: true, apiKey: 'comicvine-secret-key' },
    ranobedb: { enabled: false },
    kobo: { enabled: false, country: 'us', language: 'en' },
    lubimyczytac: { enabled: false },
    aladin: { enabled: true, ttbKey: 'aladin-ttb-key' },
    mangabaka: { enabled: false },
    ...overrides,
  }
}

const SECRET_FIELD_NAMES = [
  'metadata-google-apiKey',
  'metadata-amazon-cookie',
  'metadata-hardcover-apiKey',
  'metadata-comicvine-apiKey',
  'metadata-aladin-ttbKey',
]

function mountPanel(config: ProviderConfigurations = makeConfig(), statuses: ProviderStatus[] = []) {
  return mount(ProviderConfigPanel, { props: { config, statuses, saving: false } })
}

function secretField(wrapper: VueWrapper, name: string) {
  return wrapper.get(`input[name="${name}"]`)
}

describe('ProviderConfigPanel secret fields', () => {
  it('renders no password input at all', () => {
    const wrapper = mountPanel()

    expect(wrapper.findAll('input[type="password"]')).toHaveLength(0)
  })

  it('renders every provider secret as a masked text input', () => {
    const wrapper = mountPanel()

    const rendered = SECRET_FIELD_NAMES.map((name) => {
      const field = secretField(wrapper, name)
      return { name, type: field.attributes('type'), masked: field.classes().includes('input-secret') }
    })

    expect(rendered).toEqual(SECRET_FIELD_NAMES.map((name) => ({ name, type: 'text', masked: true })))
  })

  it('opts every provider secret out of browser and manager autofill', () => {
    const wrapper = mountPanel()

    const rendered = SECRET_FIELD_NAMES.map((name) => {
      const attrs = secretField(wrapper, name).attributes()
      return {
        name,
        autocomplete: attrs.autocomplete,
        autocorrect: attrs.autocorrect,
        autocapitalize: attrs.autocapitalize,
        spellcheck: attrs.spellcheck,
        lastPass: attrs['data-lpignore'],
        onePassword: attrs['data-1p-ignore'],
        formType: attrs['data-form-type'],
      }
    })

    expect(rendered).toEqual(
      SECRET_FIELD_NAMES.map((name) => ({
        name,
        autocomplete: 'off',
        autocorrect: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        lastPass: 'true',
        onePassword: 'true',
        formType: 'other',
      })),
    )
  })

  it('still populates each secret from the saved configuration', () => {
    const wrapper = mountPanel()

    expect((secretField(wrapper, 'metadata-google-apiKey').element as HTMLInputElement).value).toBe('google-secret-key')
    expect((secretField(wrapper, 'metadata-amazon-cookie').element as HTMLInputElement).value).toBe('amazon-session-cookie')
    expect((secretField(wrapper, 'metadata-aladin-ttbKey').element as HTMLInputElement).value).toBe('aladin-ttb-key')
  })

  it('leaves non-secret fields unmasked', () => {
    const wrapper = mountPanel()

    const maskedNonSecrets = wrapper
      .findAll('input')
      .filter((field) => !SECRET_FIELD_NAMES.includes(field.attributes('name') ?? ''))
      .filter((field) => field.classes().includes('input-secret'))
      .map((field) => field.attributes('name') ?? '(unnamed)')

    expect(maskedNonSecrets).toEqual([])
  })

  it('keeps the secret editable and saves the edited value', async () => {
    const wrapper = mountPanel()

    await secretField(wrapper, 'metadata-google-apiKey').setValue('rotated-google-key')
    await wrapper.get('form').trigger('submit')

    const saved = wrapper.emitted('save')?.[0]?.[0] as ProviderConfigurations
    expect(saved.google.apiKey).toBe('rotated-google-key')
    expect(saved.hardcover.apiKey).toBe('hardcover-secret-key')
  })

  it('reflects a configuration reload back into the masked field', async () => {
    const wrapper = mountPanel()

    await wrapper.setProps({ config: makeConfig({ google: { enabled: true, apiKey: 'reloaded-key' } }) })

    const field = secretField(wrapper, 'metadata-google-apiKey')
    expect((field.element as HTMLInputElement).value).toBe('reloaded-key')
    expect(field.attributes('type')).toBe('text')
    expect(field.classes()).toContain('input-secret')
  })

  it('disables a secret field the row cannot edit without unmasking it', () => {
    const wrapper = mountPanel(makeConfig({ amazon: { enabled: false, domain: 'amazon.com', cookie: 'amazon-session-cookie' } }))

    const field = secretField(wrapper, 'metadata-amazon-cookie')
    expect(field.attributes('disabled')).toBeDefined()
    expect(field.classes()).toContain('input-secret')
    expect(field.attributes('type')).toBe('text')
  })
})
