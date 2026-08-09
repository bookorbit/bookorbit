import type { RefreshResponse } from '@bookorbit/types'

/**
 * Refresh this far ahead of `exp`. A token that survives the check still has to travel, reach a
 * gateway and be verified there, so "not expired yet" is not the same as "safe to hand out".
 */
const EXPIRY_SKEW_MS = 30_000

/** After a failed proactive refresh, stop trying for this long. Reactive 401 refreshes ignore it. */
const REFRESH_COOLDOWN_MS = 5_000

let _accessToken: string | null = null
let _accessTokenExpiresAt: number | null = null
let _onAuthFailure: (() => void) | null = null
let _refreshPromise: Promise<string> | null = null
let _refreshCooldownUntil = 0
let _sawAuthFailure = false
const _authRecoveryListeners = new Set<() => void>()

/**
 * Reads `exp` out of a JWT without verifying it. The signature is the server's business; the client
 * only needs to know when the token stops being worth sending. Anything unparseable reports `null`,
 * which is treated as "expiry unknown" and leaves the 401 path in charge.
 */
function readExpiry(token: string | null): number | null {
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const exp: unknown = (JSON.parse(atob(padded)) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

export function setAccessToken(token: string | null): void {
  _accessToken = token
  _accessTokenExpiresAt = readExpiry(token)
  _sawAuthFailure = false
  _refreshCooldownUntil = 0
}

export function getAccessToken(): string | null {
  return _accessToken
}

/** A token with an unknown expiry is never stale: only a decoded `exp` can condemn it. */
function isTokenStale(): boolean {
  if (_accessTokenExpiresAt === null) return false
  return Date.now() >= _accessTokenExpiresAt - EXPIRY_SKEW_MS
}

/**
 * Renews an expired token before it is used, so callers stop discovering the expiry one 401 at a
 * time. Deliberately silent: a proactive refresh that fails changes nothing, and the 401 path still
 * decides whether the session is actually gone.
 */
async function ensureFreshToken(): Promise<void> {
  if (!_accessToken || !isTokenStale()) return
  if (Date.now() < _refreshCooldownUntil) return
  try {
    await refreshAccessToken()
  } catch {
    _refreshCooldownUntil = Date.now() + REFRESH_COOLDOWN_MS
  }
}

/**
 * The token every non-`api()` consumer should use: websocket handshakes, upload requests, the
 * reader's token fetcher. `getAccessToken()` returns whatever is in memory, which after a sleeping
 * tab wakes up is routinely a token the server will reject.
 */
export async function getValidToken(): Promise<string | null> {
  await ensureFreshToken()
  return _accessToken
}

/**
 * Fires after a request was rejected as unauthenticated and a later refresh got the session back.
 * Views that gave up during the outage use it to reload; a routine refresh does not fire it.
 */
export function onAuthRecovered(listener: () => void): () => void {
  _authRecoveryListeners.add(listener)
  return () => {
    _authRecoveryListeners.delete(listener)
  }
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
  const recovered = _sawAuthFailure
  setAccessToken(data.accessToken)
  if (recovered) {
    for (const listener of _authRecoveryListeners) listener()
  }
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
  if (!isRetry) await ensureFreshToken()
  const res = await rawFetch(input, rest)

  if (res.status !== 401) return res
  _sawAuthFailure = true

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
