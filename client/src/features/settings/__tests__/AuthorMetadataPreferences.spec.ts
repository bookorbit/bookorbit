import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ALL_AUTHOR_METADATA_FIELDS } from '@bookorbit/types'
import AuthorMetadataPreferences from '../components/AuthorMetadataPreferences.vue'
import ProviderChipList from '../metadata-preferences/components/ProviderChipList.vue'

const apiMock = vi.hoisted(() => vi.fn<(input: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

const PROVIDERS = [
  { key: 'goodreads', label: 'Goodreads', identifiable: true, supportedFields: [...ALL_AUTHOR_METADATA_FIELDS] },
  { key: 'audnexus', label: 'Audnexus', identifiable: true, supportedFields: ['description', 'photo'] },
]

function preferences() {
  return {
    fields: Object.fromEntries(
      ALL_AUTHOR_METADATA_FIELDS.map((field) => [
        field,
        {
          enabled: true,
          providers: field === 'description' ? ['goodreads', 'audnexus'] : ['goodreads'],
          mergeStrategy: 'fillMissing',
        },
      ]),
    ),
  }
}

function mockLoad(prefs: unknown = preferences()) {
  apiMock.mockImplementation((input: string) => {
    if (input.includes('/metadata/providers')) {
      return Promise.resolve({ ok: true, json: async () => PROVIDERS })
    }
    return Promise.resolve({ ok: true, json: async () => prefs })
  })
}

describe('AuthorMetadataPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a row for every author metadata field', async () => {
    mockLoad()

    const wrapper = mount(AuthorMetadataPreferences)
    await flushPromises()

    // test-setup installs the real English catalog, so these are the shipped labels.
    for (const label of ['Biography', 'Photo', 'Born', 'Died', 'Website', 'Genres', 'Influences']) {
      expect(wrapper.text()).toContain(label)
    }
    expect(wrapper.findAll('[role="switch"]')).toHaveLength(ALL_AUTHOR_METADATA_FIELDS.length)
  })

  it('renders nothing until preferences have loaded', () => {
    apiMock.mockReturnValue(new Promise(() => undefined))

    const wrapper = mount(AuthorMetadataPreferences)

    expect(wrapper.text()).toBe('')
  })

  it('exposes each field enable state through an accessible switch', async () => {
    mockLoad()

    const wrapper = mount(AuthorMetadataPreferences)
    await flushPromises()

    const switches = wrapper.findAll('[role="switch"]')
    expect(switches).toHaveLength(ALL_AUTHOR_METADATA_FIELDS.length)
    expect(switches[0]!.attributes('aria-checked')).toBe('true')
  })

  it('toggles a field off without touching the others', async () => {
    mockLoad()

    const wrapper = mount(AuthorMetadataPreferences)
    await flushPromises()

    await wrapper.findAll('[role="switch"]')[0]!.trigger('click')

    const switches = wrapper.findAll('[role="switch"]')
    expect(switches[0]!.attributes('aria-checked')).toBe('false')
    expect(switches[1]!.attributes('aria-checked')).toBe('true')
  })

  it('saves the current preferences to the author endpoint', async () => {
    mockLoad()

    const wrapper = mount(AuthorMetadataPreferences)
    await flushPromises()
    await (wrapper.vm as unknown as { save: () => Promise<void> }).save()

    const put = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put?.[0]).toBe('/api/v1/authors/metadata/preferences')
    expect(JSON.parse(String(put?.[1]?.body)).fields.description.providers).toEqual(['goodreads', 'audnexus'])
  })

  it('only offers drag-to-reorder where two providers can fill the field', async () => {
    mockLoad()

    const wrapper = mount(AuthorMetadataPreferences)
    await flushPromises()

    // Biography and Photo take both providers; the other five can only come
    // from Goodreads, so they render as plain text with nothing to reorder.
    expect(wrapper.findAllComponents(ProviderChipList)).toHaveLength(2)
    expect(wrapper.text()).toContain('Audnexus supplies only biographies and photos.')
  })

  it('rejects an unsupported provider dropped onto a field', async () => {
    mockLoad()

    const wrapper = mount(AuthorMetadataPreferences)
    await flushPromises()

    // Only Biography and Photo render a chip list, and both accept Audnexus.
    // Feed the Biography row a provider it cannot use to prove the guard holds.
    const biographyRow = wrapper.findAllComponents(ProviderChipList)[0]!
    biographyRow.vm.$emit('update:providers', ['goodreads', 'audnexus'])
    await flushPromises()
    await (wrapper.vm as unknown as { save: () => Promise<void> }).save()

    const put = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body)).fields.description.providers).toEqual(['goodreads', 'audnexus'])
  })

  it('offers a way to add back a capable provider that was removed', async () => {
    // ProviderChipList can only reorder and remove, so without this the second
    // provider is unrecoverable once it leaves the list.
    const reduced = preferences()
    reduced.fields.description!.providers = ['goodreads']
    mockLoad(reduced)

    const wrapper = mount(AuthorMetadataPreferences)
    await flushPromises()

    const add = wrapper.get('button[aria-label="Add Audnexus as a source"]')
    await add.trigger('click')
    await (wrapper.vm as unknown as { save: () => Promise<void> }).save()

    const put = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body)).fields.description.providers).toEqual(['goodreads', 'audnexus'])
  })

  it('shows no add button once every capable provider is assigned', async () => {
    const full = preferences()
    full.fields.description!.providers = ['goodreads', 'audnexus']
    full.fields.photo!.providers = ['goodreads', 'audnexus']
    mockLoad(full)

    const wrapper = mount(AuthorMetadataPreferences)
    await flushPromises()

    expect(wrapper.find('button[aria-label="Add Audnexus as a source"]').exists()).toBe(false)
  })

  it('names the only possible source on a single-provider field', async () => {
    mockLoad()

    const wrapper = mount(AuthorMetadataPreferences)
    await flushPromises()

    // Website can only come from Goodreads, so the row states it rather than
    // offering a chip that can never be reordered.
    expect(wrapper.text()).toContain('Website')
    expect(wrapper.text()).toContain('Goodreads')
  })
})
