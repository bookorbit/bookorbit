import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import type { ApiKeySettings, ApiKeySummary, CreateApiKeyRequest, CreatedApiKey, RevokeApiKeysResponse } from '@bookorbit/types'
import { apiJson, apiSend, errorMessage, jsonBody } from '@/lib/api-json'

/**
 * The API keys of the signed-in user, or of `ownerId` when an administrator manages someone else's.
 * Administrators can list, issue and revoke another person's keys but never rename or regenerate
 * them, so those two always act on the signed-in user's own keys.
 */
export function useApiKeys(ownerId?: MaybeRefOrGetter<number | null | undefined>) {
  const keys = ref<ApiKeySummary[]>([])
  const settings = ref<ApiKeySettings | null>(null)
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const basePath = computed(() => {
    const id = toValue(ownerId)
    return id ? `/api/v1/users/${id}/api-keys` : '/api/v1/api-keys'
  })

  async function load(): Promise<void> {
    if (!loaded.value) loading.value = true
    error.value = null
    try {
      keys.value = await apiJson<ApiKeySummary[]>(basePath.value, undefined, 'apiKeys.errors.load')
      loaded.value = true
    } catch (reason) {
      error.value = errorMessage(reason, 'apiKeys.errors.load')
    } finally {
      loading.value = false
    }
  }

  async function loadSettings(): Promise<void> {
    try {
      settings.value = await apiJson<ApiKeySettings>('/api/v1/api-keys/settings', undefined, 'apiKeys.errors.load')
    } catch (reason) {
      error.value = errorMessage(reason, 'apiKeys.errors.load')
    }
  }

  async function create(request: CreateApiKeyRequest): Promise<CreatedApiKey> {
    const created = await apiJson<CreatedApiKey>(basePath.value, jsonBody('POST', request), 'apiKeys.errors.create')
    await load()
    return created
  }

  async function rename(keyId: number, name: string): Promise<ApiKeySummary> {
    const renamed = await apiJson<ApiKeySummary>(`/api/v1/api-keys/${keyId}`, jsonBody('PATCH', { name }), 'apiKeys.errors.rename')
    keys.value = keys.value.map((key) => (key.id === renamed.id ? renamed : key))
    return renamed
  }

  async function regenerate(keyId: number): Promise<CreatedApiKey> {
    const created = await apiJson<CreatedApiKey>(`/api/v1/api-keys/${keyId}/regenerate`, { method: 'POST' }, 'apiKeys.errors.regenerate')
    await load()
    return created
  }

  async function revoke(keyId: number): Promise<void> {
    await apiSend(`${basePath.value}/${keyId}`, { method: 'DELETE' }, 'apiKeys.errors.revoke')
    await load()
  }

  async function revokeAll(): Promise<number> {
    const { revoked } = await apiJson<RevokeApiKeysResponse>(basePath.value, { method: 'DELETE' }, 'apiKeys.errors.revokeAll')
    await load()
    return revoked
  }

  return { keys, settings, loading, loaded, error, load, loadSettings, create, rename, regenerate, revoke, revokeAll }
}
