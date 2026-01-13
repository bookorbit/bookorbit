import { ref } from 'vue'
import type { AuthUser, AuthResponse } from '@projectx/types'
import { api, setAccessToken, setOnAuthFailure } from '@/lib/api'
import router from '@/router'

const user = ref<AuthUser | null>(null)
const isLoading = ref(false)

function clearAuth() {
  user.value = null
  setAccessToken(null)
}

setOnAuthFailure(() => {
  clearAuth()
  router.push('/login')
})

async function me(): Promise<void> {
  const res = await api('/api/auth/me')
  if (!res.ok) throw new Error('Failed to load user')
  user.value = await res.json()
}

export function useAuth() {
  async function init(): Promise<void> {
    isLoading.value = true
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
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
    const res = await fetch('/api/auth/login', {
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
      router.push('/change-password')
    } else {
      const redirect = router.currentRoute.value.query.redirect as string | undefined
      router.push(redirect ?? '/')
    }
  }

  async function logout(): Promise<void> {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
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

  return { user, isLoading, init, login, logout, me }
}
