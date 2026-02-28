import type { RefreshResponse } from '@projectx/types'

let _accessToken: string | null = null
let _onAuthFailure: (() => void) | null = null
let _refreshPromise: Promise<void> | null = null

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

async function attemptRefresh(): Promise<void> {
  const res = await rawFetch('/api/v1/auth/refresh', { method: 'POST' })
  if (!res.ok) throw new Error('refresh failed')
  const data: RefreshResponse = await res.json()
  _accessToken = data.accessToken
}

export async function api(input: RequestInfo | URL, init?: RequestInit & { _isRetry?: boolean }): Promise<Response> {
  const res = await rawFetch(input, init)

  if (res.status !== 401) return res

  if (init?._isRetry) {
    _onAuthFailure?.()
    throw new Error('Session expired')
  }

  if (!_refreshPromise) {
    _refreshPromise = attemptRefresh().finally(() => {
      _refreshPromise = null
    })
  }

  try {
    await _refreshPromise
  } catch {
    _onAuthFailure?.()
    throw new Error('Session expired')
  }

  return rawFetch(input, { ...init, _isRetry: true })
}
