import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_METADATA_FIELDS } from '@bookorbit/types'
import type { FieldPreference, MetadataField, MetadataFetchPreferences, MetadataHttpProviderView, MetadataProviderKey } from '@bookorbit/types'
import { supportedFieldsOf, useExternalProviders } from '../useExternalProviders'

const key = (value: string) => value as MetadataProviderKey

function prefs(): MetadataFetchPreferences {
  const fields = ALL_METADATA_FIELDS.reduce<Record<MetadataField, FieldPreference>>(
    (result, field) => {
      result[field] = { enabled: true, providers: [key('google')], mergeStrategy: 'overwriteIfProvided' }
      return result
    },
    {} as Record<MetadataField, FieldPreference>,
  )
  fields.title.providers = [key('google'), key('fantlab')]
  return { fields }
}

function provider(overrides: Partial<MetadataHttpProviderView['info']> = {}): MetadataHttpProviderView {
  return {
    id: 1,
    key: key('fantlab'),
    baseUrl: 'http://fantlab:8080/',
    hasAuthorization: false,
    authorizationUnreadable: false,
    enabled: true,
    allowPrivateAddress: true,
    timeoutMs: 10_000,
    status: 'ok',
    lastError: null,
    info: {
      key: key('fantlab'),
      name: 'FantLab',
      version: '0.1.0',
      specVersion: '1',
      avatarUrl: null,
      authenticationRequired: false,
      mediaTypes: ['book'],
      lookup: true,
      supportedFields: null,
      searchParams: ['query', 'author', 'mediaType'],
      idMaxLength: 11,
      bookUrlTemplate: null,
      rateLimit: { maxConcurrency: 2, minIntervalMs: 0 },
      coverShape: null,
      ...overrides,
    },
    iconUrl: null,
    infoFetchedAt: null,
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
  }
}

const requests: { url: string; method: string; body: unknown }[] = []

vi.mock('@/lib/api', () => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>((url, init) => {
    const method = init?.method ?? 'GET'
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/metadata-preferences/global') && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(prefs())) })
    }
    // The real endpoint answers a successful save with an empty body.
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') })
  }),
}))

describe('useExternalProviders', () => {
  beforeEach(() => {
    requests.length = 0
  })

  it('appends the provider to the end of each rule it can fill, skipping rules that already have it', async () => {
    const { addToFieldRules } = useExternalProviders()

    const result = await addToFieldRules(provider({ supportedFields: ['title', 'description', 'publisher'] }))

    expect(result).toEqual({ ok: true, value: 2 })
    const saved = requests.find((request) => request.method === 'PUT')?.body as MetadataFetchPreferences
    expect(saved.fields.title.providers).toEqual(['google', 'fantlab'])
    expect(saved.fields.description.providers).toEqual(['google', 'fantlab'])
    expect(saved.fields.publisher.providers).toEqual(['google', 'fantlab'])
    expect(saved.fields.genres.providers).toEqual(['google'])
  })

  it('saves nothing when the provider is already in every rule it can fill', async () => {
    const { addToFieldRules } = useExternalProviders()
    await expect(addToFieldRules(provider({ supportedFields: ['title'] }))).resolves.toEqual({ ok: true, value: 0 })
    expect(requests.some((request) => request.method === 'PUT')).toBe(false)
  })

  it('uses every spec field for the provider media when the provider does not list its fields', () => {
    expect(supportedFieldsOf(provider())).toContain('seriesIndex')
    expect(supportedFieldsOf(provider())).not.toContain('narrators')
    expect(supportedFieldsOf(provider({ mediaTypes: ['book', 'audiobook'] }))).toContain('narrators')
  })
})
