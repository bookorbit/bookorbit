import { ref } from 'vue'
import type {
  CreateMetadataHttpProviderPayload,
  MetadataFetchPreferences,
  MetadataField,
  MetadataHttpProviderTestResult,
  MetadataHttpProviderView,
  UpdateMetadataHttpProviderPayload,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { registerProviderAppearance } from '@/lib/provider-appearance'

/** What a failed call said, so the panel can show translated copy for the codes it knows. */
export interface ExternalProviderError {
  code: string | null
  message: string | null
}

export type ExternalProviderResult<T> = { ok: true; value: T } | { ok: false; error: ExternalProviderError }

/** Field rules a provider can fill when its info does not list them: everything the spec maps. */
const SPEC_BOOK_FIELDS: MetadataField[] = [
  'title',
  'subtitle',
  'description',
  'cover',
  'authors',
  'publisher',
  'isbn',
  'publishedYear',
  'language',
  'pageCount',
  'seriesName',
  'seriesIndex',
  'genres',
]
const SPEC_AUDIOBOOK_FIELDS: MetadataField[] = ['audioCover', 'narrators', 'duration']

async function readError(res: Response): Promise<ExternalProviderError> {
  const body = (await res.json().catch(() => null)) as { errorCode?: unknown; message?: unknown } | null
  return {
    code: typeof body?.errorCode === 'string' ? body.errorCode : null,
    message: typeof body?.message === 'string' ? body.message : null,
  }
}

async function send<T>(url: string, init?: RequestInit): Promise<ExternalProviderResult<T>> {
  try {
    const res = await api(url, init)
    if (!res.ok) return { ok: false, error: await readError(res) }
    // Some endpoints answer a successful write with an empty body.
    const text = await res.text()
    return { ok: true, value: (text ? JSON.parse(text) : null) as T }
  } catch {
    return { ok: false, error: { code: null, message: null } }
  }
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }
}

function appearanceOf(provider: MetadataHttpProviderView) {
  return { key: provider.key, iconUrl: provider.iconUrl, color: provider.info?.color ?? null }
}

/** The fields a provider says it fills, or every spec field for its media when it does not say. */
export function supportedFieldsOf(provider: MetadataHttpProviderView): MetadataField[] {
  const declared = provider.info?.supportedFields
  if (declared) return declared
  const audio = provider.info?.mediaTypes.includes('audiobook') ?? false
  return [...SPEC_BOOK_FIELDS, ...(audio ? SPEC_AUDIOBOOK_FIELDS : [])]
}

export function useExternalProviders() {
  const providers = ref<MetadataHttpProviderView[]>([])
  const loaded = ref(false)

  async function fetchProviders(): Promise<void> {
    const result = await send<MetadataHttpProviderView[]>('/api/v1/metadata-http-providers')
    if (result.ok) {
      providers.value = result.value
      registerProviderAppearance(result.value.map(appearanceOf))
    }
    loaded.value = true
  }

  function replace(provider: MetadataHttpProviderView): void {
    const index = providers.value.findIndex((entry) => entry.id === provider.id)
    providers.value = index >= 0 ? providers.value.map((entry) => (entry.id === provider.id ? provider : entry)) : [...providers.value, provider]
    registerProviderAppearance([appearanceOf(provider)])
  }

  async function createProvider(payload: CreateMetadataHttpProviderPayload): Promise<ExternalProviderResult<MetadataHttpProviderView>> {
    const result = await send<MetadataHttpProviderView>('/api/v1/metadata-http-providers', jsonInit('POST', payload))
    if (result.ok) replace(result.value)
    return result
  }

  async function updateProvider(id: number, payload: UpdateMetadataHttpProviderPayload): Promise<ExternalProviderResult<MetadataHttpProviderView>> {
    const result = await send<MetadataHttpProviderView>(`/api/v1/metadata-http-providers/${id}`, jsonInit('PATCH', payload))
    if (result.ok) replace(result.value)
    return result
  }

  async function removeProvider(id: number, purge: boolean): Promise<ExternalProviderResult<unknown>> {
    const result = await send<unknown>(`/api/v1/metadata-http-providers/${id}${purge ? '?purge=true' : ''}`, { method: 'DELETE' })
    if (result.ok) providers.value = providers.value.filter((entry) => entry.id !== id)
    return result
  }

  async function testProvider(id: number): Promise<ExternalProviderResult<MetadataHttpProviderTestResult>> {
    const result = await send<MetadataHttpProviderTestResult>(`/api/v1/metadata-http-providers/${id}/test`, jsonInit('POST', {}))
    // A test also refreshes what BookOrbit knows about the provider, status included.
    await fetchProviders()
    return result
  }

  /**
   * Appends the provider to the end of every global field rule it can fill. Nothing does this on
   * its own: a new provider takes part in auto-fetch only once an admin asks for it.
   */
  async function addToFieldRules(provider: MetadataHttpProviderView): Promise<ExternalProviderResult<number>> {
    const current = await send<MetadataFetchPreferences>('/api/v1/metadata-preferences/global')
    if (!current.ok) return current
    const preferences = current.value
    let added = 0
    for (const field of supportedFieldsOf(provider)) {
      const rule = preferences.fields[field]
      if (!rule || rule.providers.includes(provider.key)) continue
      rule.providers = [...rule.providers, provider.key]
      added++
    }
    if (added === 0) return { ok: true, value: 0 }
    const saved = await send<unknown>('/api/v1/metadata-preferences/global', jsonInit('PUT', preferences))
    return saved.ok ? { ok: true, value: added } : saved
  }

  return { providers, loaded, fetchProviders, createProvider, updateProvider, removeProvider, testProvider, addToFieldRules }
}
