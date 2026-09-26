import type { RefreshResponse } from '@bookorbit/types'
import { i18n } from '@/i18n'

/**
 * Refresh this far ahead of `exp`. A token that survives the check still has to travel, reach a
 * gateway and be verified there, so "not expired yet" is not the same as "safe to hand out".
 */
const EXPIRY_SKEW_MS = 30_000

/** After a failed proactive refresh, stop trying for this long. Reactive 401 refreshes ignore it. */
const REFRESH_COOLDOWN_MS = 5_000

const AUTH_PROXY_RELOAD_KEY = 'bookorbit:auth-proxy-reload-at'
const AUTH_PROXY_RELOAD_WINDOW_MS = 15_000

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

/**
 * A request that never reached the server: offline, connection refused, DNS failure, blocked origin.
 * `fetch` rejects these with a `TypeError` whose message is the browser's own untranslated English,
 * "Failed to fetch", and plenty of call sites render `reason.message` straight into a toast. The
 * rejection is retagged here, at the one place every request passes through, so no caller can leak it.
 */
export class NetworkError extends Error {
  /** The browser's own wording. Useful in a log line, never in the interface. */
  readonly browserMessage: string

  constructor(browserMessage: string) {
    super(i18n.global.t('errors.network'))
    this.name = 'NetworkError'
    this.browserMessage = browserMessage
  }
}

/**
 * True when a same-origin request came back redirected elsewhere. With `redirect: 'manual'` this is
 * how an edge auth proxy (Cloudflare Access, an OAuth2 gateway) shows up once its session cookie has
 * expired: it can't be told apart from a logged-out app any other way, since `fetch` either follows the
 * redirect into a CORS failure or throws before the caller ever sees a status code.
 */
export function isAuthProxyRedirect(res: Response): boolean {
  return res.type === 'opaqueredirect'
}

/**
 * A fetch can't complete a proxy's redirect to its login page itself. A full navigation can, so that's
 * the only way through. Normally returns a promise that never settles: the reload is about to tear down this
 * page, and letting the caller's `.then`/`.catch` run first (e.g. routing to the app's own login screen)
 * would just flash the wrong UI for a moment.
 */
export function reloadForAuthProxy(): Promise<never> {
  // If the reload is answered from the service worker cache again (e.g. the network failed), a second
  // reload would loop forever. Give up and let the caller surface an error instead. Without storage
  // the loop can't be detected, so don't risk the reload at all.
  const now = Date.now()
  let lastReload: number
  try {
    lastReload = Number(sessionStorage.getItem(AUTH_PROXY_RELOAD_KEY)) || 0
    sessionStorage.setItem(AUTH_PROXY_RELOAD_KEY, String(now))
  } catch {
    return Promise.reject(new NetworkError('auth proxy redirect'))
  }
  if (now - lastReload < AUTH_PROXY_RELOAD_WINDOW_MS) {
    return Promise.reject(new NetworkError('auth proxy redirect'))
  }
  window.location.reload()
  return new Promise<never>(() => {})
}

async function rawFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (_accessToken) headers.set('Authorization', `Bearer ${_accessToken}`)
  let res: Response
  try {
    res = await fetch(input, { ...init, headers, credentials: 'include', redirect: 'manual' })
  } catch (reason) {
    if (reason instanceof TypeError) throw new NetworkError(reason.message)
    throw reason
  }
  return isAuthProxyRedirect(res) ? reloadForAuthProxy() : res
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
