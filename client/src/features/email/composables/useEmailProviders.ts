import { ref } from 'vue'
import { api } from '@/lib/api'

export interface EmailProvider {
  id: number
  userId: number | null
  name: string
  host: string
  port: number
  username: string | null
  fromName: string | null
  fromAddress: string | null
  auth: boolean
  ssl: boolean
  startTls: boolean
  tlsRejectUnauthorized: boolean
  isDefault: boolean
  isShared: boolean
  isSystemProvider: boolean
  hasPassword: boolean
  createdAt: string
}

export interface EmailProviderForm {
  name: string
  host: string
  port: number
  username: string
  password: string
  fromName: string
  fromAddress: string
  auth: boolean
  ssl: boolean
  startTls: boolean
  tlsRejectUnauthorized: boolean
}

const providers = ref<EmailProvider[]>([])
let fetchPromise: Promise<void> | null = null

export function useEmailProviders() {
  async function fetchProviders(): Promise<void> {
    if (fetchPromise) return fetchPromise
    fetchPromise = api('/api/v1/email/providers')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load providers')
        providers.value = await res.json()
      })
      .finally(() => {
        fetchPromise = null
      })
    return fetchPromise
  }

  async function createProvider(form: EmailProviderForm): Promise<EmailProvider> {
    const res = await api('/api/v1/email/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to create provider')
    }
    const created: EmailProvider = await res.json()
    providers.value = [...providers.value, created]
    return created
  }

  async function updateProvider(id: number, form: Partial<EmailProviderForm>): Promise<EmailProvider> {
    const res = await api(`/api/v1/email/providers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to update provider')
    }
    const updated: EmailProvider = await res.json()
    providers.value = providers.value.map((p) => (p.id === id ? updated : p))
    return updated
  }

  async function deleteProvider(id: number): Promise<void> {
    const res = await api(`/api/v1/email/providers/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to delete provider')
    }
    providers.value = providers.value.filter((p) => p.id !== id)
  }

  async function setDefaultProvider(id: number): Promise<void> {
    const res = await api(`/api/v1/email/providers/${id}/default`, { method: 'PATCH' })
    if (!res.ok) throw new Error('Failed to set default')
    const updated: EmailProvider = await res.json()
    providers.value = providers.value.map((p) => ({ ...p, isDefault: p.id === updated.id ? updated.isDefault : false }))
  }

  async function toggleSharedProvider(id: number): Promise<void> {
    const res = await api(`/api/v1/email/providers/${id}/share`, { method: 'PATCH' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to toggle share')
    }
    const updated: EmailProvider = await res.json()
    providers.value = providers.value.map((p) => (p.id === id ? updated : p))
  }

  async function testProvider(id: number): Promise<{ success: boolean; error?: string }> {
    const res = await api(`/api/v1/email/providers/${id}/test`, { method: 'POST' })
    if (!res.ok) throw new Error('Failed to test connection')
    return res.json()
  }

  async function setSystemProvider(id: number): Promise<void> {
    const res = await api(`/api/v1/email/providers/${id}/system`, { method: 'PATCH' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to set system provider')
    }
    const updated: EmailProvider = await res.json()
    providers.value = providers.value.map((p) => ({ ...p, isSystemProvider: p.id === updated.id }))
  }

  async function clearSystemProvider(): Promise<void> {
    const res = await api('/api/v1/email/providers/system', { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { message?: string }).message ?? 'Failed to clear system provider')
    }
    providers.value = providers.value.map((p) => ({ ...p, isSystemProvider: false }))
  }

  return {
    providers,
    fetchProviders,
    createProvider,
    updateProvider,
    deleteProvider,
    setDefaultProvider,
    toggleSharedProvider,
    testProvider,
    setSystemProvider,
    clearSystemProvider,
  }
}
