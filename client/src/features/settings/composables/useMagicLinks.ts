import { ref } from 'vue'
import { api } from '@/lib/api'
import type { MagicLinkToken, MagicLinkTokenCreateResponse } from '@bookorbit/types'

const tokens = ref<MagicLinkToken[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

export function useMagicLinks() {
  async function loadTokens() {
    loading.value = true
    error.value = null
    try {
      const res = await api('/api/v1/auth/magic-links')
      if (!res.ok) throw new Error('Failed to load magic links')
      tokens.value = await res.json()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load'
    } finally {
      loading.value = false
    }
  }

  async function createToken(data: { userId: number; label: string; expiresAt?: string }): Promise<MagicLinkTokenCreateResponse> {
    const res = await api('/api/v1/auth/magic-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message ?? 'Failed to create magic link')
    }
    const result: MagicLinkTokenCreateResponse = await res.json()
    await loadTokens()
    return result
  }

  async function revokeToken(id: number) {
    const res = await api(`/api/v1/auth/magic-links/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message ?? 'Failed to revoke magic link')
    }
    await loadTokens()
  }

  async function setActive(id: number, isActive: boolean) {
    const res = await api(`/api/v1/auth/magic-links/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message ?? 'Failed to update magic link')
    }
    await loadTokens()
  }

  return { tokens, loading, error, loadTokens, createToken, revokeToken, setActive }
}
