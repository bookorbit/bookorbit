import { ref } from 'vue'
import type { AuthUser, AuthResponse } from '@projectx/types'
import { api, setAccessToken, setOnAuthFailure } from '@/lib/api'
import router from '@/router'
import { useSetupStatus } from './useSetupStatus'
import { disconnectAuthorEnrichmentSocket } from '@/features/settings/composables/useAuthorEnrichmentStatus'
import { disconnectBookMetadataFetchSocket } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchStatus'

const user = ref<AuthUser | null>(null)
const isLoading = ref(false)

function clearAuth() {
  user.value = null
  setAccessToken(null)
  disconnectAuthorEnrichmentSocket()
  disconnectBookMetadataFetchSocket()
}

setOnAuthFailure(() => {
  clearAuth()
  const { needsSetup } = useSetupStatus()
  router.push(needsSetup.value ? '/setup' : '/login')
})

async function me(): Promise<void> {
  const res = await api('/api/v1/auth/me')
  if (!res.ok) throw new Error('Failed to load user')
  user.value = await res.json()
}

export function useAuth() {
  async function init(): Promise<void> {
    isLoading.value = true
    try {
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
      if (!res.ok) return
      const { accessToken } = await res.json()
      setAccessToken(accessToken)
      await me()
    } catch {
      // no valid session
    } finally {
      isLoading.value = false
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message ?? 'Invalid credentials')
    }

    const data: AuthResponse = await res.json()
    setAccessToken(data.accessToken)
    user.value = data.user

    if (data.user.isDefaultPassword) {
      router.push('/')
    } else {
      const redirect = router.currentRoute.value.query.redirect as string | undefined
      router.push(redirect ?? '/')
    }
  }

  async function setup(payload: { username: string; name: string; email: string; password: string; setupToken?: string }): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (payload.setupToken) {
      headers['x-setup-token'] = payload.setupToken
    }

    const res = await fetch('/api/v1/auth/setup', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        username: payload.username,
        name: payload.name,
        email: payload.email,
        password: payload.password,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message ?? 'Failed to complete setup')
    }

    const data: AuthResponse = await res.json()
    setAccessToken(data.accessToken)
    user.value = data.user

    useSetupStatus().markSetupComplete()
    router.push('/')
  }

  async function logout(): Promise<void> {
    try {
      const res = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' })
      clearAuth()
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data?.logoutUrl) {
          window.location.href = data.logoutUrl
          return
        }
      }
    } catch {
      clearAuth()
    }
    router.push('/login')
  }

  return { user, isLoading, init, login, logout, me, setup }
}
