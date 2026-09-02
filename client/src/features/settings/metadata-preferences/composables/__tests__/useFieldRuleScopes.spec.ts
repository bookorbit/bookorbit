import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { ALL_METADATA_FIELDS } from '@bookorbit/types'
import type { FieldPreference, MetadataField, MetadataFetchPreferences, MetadataProviderKey } from '@bookorbit/types'
import { GLOBAL_SCOPE, useFieldRuleScopes } from '../useFieldRuleScopes'

const key = (value: string) => value as MetadataProviderKey

function makePrefs(providers: MetadataProviderKey[] = [key('goodreads'), key('google')]): MetadataFetchPreferences {
  const fields = ALL_METADATA_FIELDS.reduce<Record<MetadataField, FieldPreference>>(
    (result, field) => {
      result[field] = { enabled: true, providers: [...providers], mergeStrategy: 'overwriteIfProvided' }
      return result
    },
    {} as Record<MetadataField, FieldPreference>,
  )
  return {
    fields,
    options: { genres: { mode: 'merge', blocklist: [], maxCount: null }, saveProviderIds: true, providerIdMode: 'preferExisting' },
  }
}

const LIBRARIES = [
  { id: 1, name: 'Novels' },
  { id: 2, name: 'Comics' },
]

const requests: { url: string; method: string; body: unknown }[] = []

vi.mock('@/lib/api', () => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>((url, init) => {
    const method = init?.method ?? 'GET'
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })

    if (url.endsWith('/metadata-preferences/global') && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(makePrefs()) })
    }
    if (url.includes('/metadata-preferences/libraries/') && method === 'GET') {
      const libraryId = Number(url.split('/').pop())
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            libraryId,
            // Comics already overrides `cover`; Novels inherits everything.
            overrides: libraryId === 2 ? { cover: { enabled: true, providers: [key('amazon')], mergeStrategy: 'overwrite' } } : {},
            effective: makePrefs(),
          }),
      })
    }
    if (url === '/api/v1/libraries') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(LIBRARIES) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }),
}))

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() } }))

// useLibraries caches across callers, so each test needs a clean module registry.
async function setup() {
  const { resetLibraries } = await import('@/features/library/composables/useLibraries')
  resetLibraries()

  let api!: ReturnType<typeof useFieldRuleScopes>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useFieldRuleScopes()
        return () => null
      },
    }),
  )
  await api.load()
  await nextTick()
  return { api, wrapper }
}

beforeEach(() => {
  requests.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useFieldRuleScopes', () => {
  it('starts on the global scope and lists every library after it', async () => {
    const { api } = await setup()
    expect(api.activeScopeId.value).toBe(GLOBAL_SCOPE)
    expect(api.scopes.value.map((scope) => scope.name)).toEqual(['Global defaults', 'Novels', 'Comics'])
    expect(api.isGlobalScope.value).toBe(true)
  })

  it('does not fetch a library until its scope is opened', async () => {
    const { api } = await setup()
    expect(requests.some((request) => request.url.includes('/libraries/2'))).toBe(false)

    api.activeScopeId.value = 2
    await nextTick()
    await nextTick()
    expect(requests.some((request) => request.url.includes('/metadata-preferences/libraries/2'))).toBe(true)
  })

  it('tracks an edit as unsaved without touching the server', async () => {
    const { api } = await setup()
    expect(api.isDirty.value).toBe(false)

    api.patchField('title', { providers: [key('amazon')] })
    await nextTick()

    expect(api.isDirty.value).toBe(true)
    expect([...api.unsavedFields.value]).toEqual(['title'])
    expect(api.activeFields.value?.title.providers).toEqual(['amazon'])
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)
  })

  it('keeps a draft when switching scope and back', async () => {
    const { api } = await setup()
    api.patchField('title', { providers: [key('amazon')] })
    await nextTick()

    api.activeScopeId.value = 1
    await nextTick()
    expect(api.isDirty.value).toBe(false)

    api.activeScopeId.value = GLOBAL_SCOPE
    await nextTick()
    expect(api.activeFields.value?.title.providers).toEqual(['amazon'])
    expect(api.isDirty.value).toBe(true)
  })

  it('discards a draft back to the server state', async () => {
    const { api } = await setup()
    api.patchField('title', { providers: [key('amazon')] })
    await nextTick()

    api.discard()
    await nextTick()

    expect(api.isDirty.value).toBe(false)
    expect(api.activeFields.value?.title.providers).toEqual(['goodreads', 'google'])
  })

  it('sends the whole preference document when saving the global scope', async () => {
    const { api } = await setup()
    api.patchField('title', { providers: [key('amazon')] })
    await nextTick()

    await api.save()

    const put = requests.find((request) => request.method === 'PUT')
    expect(put?.url).toContain('/metadata-preferences/global')
    const body = put?.body as MetadataFetchPreferences
    expect(body.fields.title.providers).toEqual(['amazon'])
    expect(body.fields.cover.providers).toEqual(['goodreads', 'google'])
    expect(api.isDirty.value).toBe(false)
  })

  it('sends only overrides when saving a library, merging with the ones already stored', async () => {
    const { api } = await setup()
    api.activeScopeId.value = 2
    await nextTick()
    await nextTick()
    await nextTick()

    api.patchField('title', { providers: [key('amazon')] })
    await nextTick()
    await api.save()

    const put = requests.find((request) => request.method === 'PUT')
    expect(put?.url).toContain('/metadata-preferences/libraries/2')
    const body = put?.body as { overrides: Record<string, FieldPreference> }
    expect(Object.keys(body.overrides).sort()).toEqual(['cover', 'title'])
    expect(body.overrides.title.providers).toEqual(['amazon'])
  })

  it('reverting a library field drops the override instead of writing an empty one', async () => {
    const { api } = await setup()
    api.activeScopeId.value = 2
    await nextTick()
    await nextTick()
    await nextTick()

    expect(api.overriddenFields.value.has('cover')).toBe(true)

    api.revertField('cover')
    await nextTick()

    expect(api.overriddenFields.value.has('cover')).toBe(false)
    await api.save()

    const put = requests.find((request) => request.method === 'PUT')
    const body = put?.body as { overrides: Record<string, FieldPreference> }
    expect(body.overrides).toEqual({})
  })

  it('applies a provider action across every field in one edit', async () => {
    const { api } = await setup()
    api.applyProviderToAllFields(key('google'), 'first')
    await nextTick()

    expect(api.unsavedFields.value.size).toBe(ALL_METADATA_FIELDS.length)
    for (const field of ALL_METADATA_FIELDS) {
      expect(api.activeFields.value?.[field].providers).toEqual(['google', 'goodreads'])
    }
  })

  it('removing a provider everywhere leaves the other providers in order', async () => {
    const { api } = await setup()
    api.applyProviderToAllFields(key('goodreads'), 'remove')
    await nextTick()

    expect(api.activeFields.value?.title.providers).toEqual(['google'])
  })

  it('marks no field as unsaved when a bulk action changes nothing', async () => {
    const { api } = await setup()
    api.applyProviderToAllFields(key('amazon'), 'remove')
    await nextTick()

    expect(api.unsavedFields.value.size).toBe(0)
    expect(api.isDirty.value).toBe(false)
  })

  it('clears every provider without saving', async () => {
    const { api } = await setup()
    api.clearAllProviders()
    await nextTick()

    expect(api.activeFields.value?.title.providers).toEqual([])
    expect(api.isDirty.value).toBe(true)
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)
  })

  it('discards a changed advanced option back to the stored value', async () => {
    const { api } = await setup()
    api.setOptions({
      genres: { mode: 'firstProvider', blocklist: [], maxCount: 999 },
      saveProviderIds: false,
      providerIdMode: 'existingOnly',
    })
    await nextTick()

    api.discard()
    await nextTick()

    expect(api.isDirty.value).toBe(false)
    expect(api.optionsDraft.value?.genres.maxCount).toBeNull()
    expect(api.optionsDraft.value?.saveProviderIds).toBe(true)
    expect(api.optionsDraft.value?.providerIdMode).toBe('preferExisting')
  })

  it('counts a changed advanced option as unsaved on the global scope', async () => {
    const { api } = await setup()
    expect(api.isDirty.value).toBe(false)

    api.setOptions({
      genres: { mode: 'firstProvider', blocklist: [], maxCount: 12 },
      saveProviderIds: false,
      providerIdMode: 'existingOnly',
    })
    await nextTick()

    expect(api.isDirty.value).toBe(true)
    await api.save()
    const put = requests.find((request) => request.method === 'PUT')
    const body = put?.body as MetadataFetchPreferences
    expect(body.options?.genres.maxCount).toBe(12)
    expect(body.options?.providerIdMode).toBe('existingOnly')
  })
})
