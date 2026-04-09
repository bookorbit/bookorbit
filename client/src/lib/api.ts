import type { RefreshResponse } from '@projectx/types'

let _accessToken: string | null = null
let _onAuthFailure: (() => void) | null = null
let _refreshPromise: Promise<string> | null = null

export function setAccessToken(token: string | null): void {
  _accessToken = token
}

export function getAccessToken(): string | null {
  return _accessToken
}

export function setOnAuthFailure(fn: () => void): void {
  _onAuthFailure = fn
}

function rawFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (_accessToken) headers.set('Authorization', `Bearer ${_accessToken}`)
  return fetch(input, { ...init, headers, credentials: 'include' })
}

async function attemptRefresh(): Promise<string> {
  const res = await rawFetch('/api/v1/auth/refresh', { method: 'POST' })
  if (!res.ok) throw new Error('refresh failed')
  const data: RefreshResponse = await res.json()
  _accessToken = data.accessToken
  return data.accessToken
}

export async function refreshAccessToken(): Promise<string> {
  if (!_refreshPromise) {
    _refreshPromise = attemptRefresh().finally(() => {
      _refreshPromise = null
    })
  }
  return _refreshPromise
}

export async function api(input: RequestInfo | URL, init?: RequestInit & { _isRetry?: boolean }): Promise<Response> {
  const isRetry = init?._isRetry
  const { _isRetry: _, ...rest } = init ?? {}
  const res = await rawFetch(input, rest)

  if (res.status !== 401) return res

  if (isRetry) {
    _onAuthFailure?.()
    throw new Error('Session expired')
  }

  try {
    await refreshAccessToken()
  } catch {
    _onAuthFailure?.()
    throw new Error('Session expired')
  }

  return api(input, { ...rest, _isRetry: true })
}
