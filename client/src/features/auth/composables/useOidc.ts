import type { OidcCallbackResponse, OidcPublicConfig } from '@projectx/types'

async function generatePkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return { codeVerifier, codeChallenge }
}

function generateNonce(): string {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export class OidcLoginError extends Error {
  constructor(
    public readonly errorCode: string | undefined,
    message: string,
  ) {
    super(message)
  }
}

export function useOidc() {
  async function getPublicConfig(): Promise<OidcPublicConfig | null> {
    try {
      const res = await fetch('/api/v1/app-settings/oidc/public')
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  async function initiateLogin(): Promise<void> {
    const config = await getPublicConfig()
    if (!config?.enabled) {
      throw new OidcLoginError(undefined, 'OIDC is not configured')
    }

    const { codeVerifier, codeChallenge } = await generatePkce()
    const nonce = generateNonce()

    // Save any redirect target before leaving the page (P1-1: capture redirect for post-login navigation)
    sessionStorage.removeItem('oidc_redirect')
    const redirectTarget = new URLSearchParams(window.location.search).get('redirect')
    if (redirectTarget && redirectTarget.startsWith('/') && !redirectTarget.startsWith('//')) {
      sessionStorage.setItem('oidc_redirect', redirectTarget)
    }

    // Get server-side state + authorizationEndpoint (server resolves discovery - avoids CORS issues)
    const stateRes = await fetch('/api/v1/auth/oidc/state', { method: 'POST', credentials: 'include' })
    if (!stateRes.ok) throw new OidcLoginError(undefined, 'Failed to generate state')
    const { state, authorizationEndpoint } = (await stateRes.json()) as { state: string; authorizationEndpoint: string }

    if (!authorizationEndpoint) {
      throw new OidcLoginError(undefined, 'OIDC provider is not reachable - check the Issuer URI in settings')
    }

    // Store PKCE data for the callback
    sessionStorage.setItem(`oidc_pkce_${state}`, JSON.stringify({ codeVerifier, nonce, state }))

    const redirectUri = `${window.location.origin}/oauth2-callback`

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    })

    window.location.href = `${authorizationEndpoint}?${params.toString()}`
  }

  async function exchangeCode(code: string, state: string) {
    const pkceJson = sessionStorage.getItem(`oidc_pkce_${state}`)
    if (!pkceJson) throw new OidcLoginError(undefined, 'No PKCE data found for this state')

    const { codeVerifier, nonce } = JSON.parse(pkceJson) as { codeVerifier: string; nonce: string; state: string }
    sessionStorage.removeItem(`oidc_pkce_${state}`)

    const redirectUri = `${window.location.origin}/oauth2-callback`

    const res = await fetch('/api/v1/auth/oidc/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code, codeVerifier, redirectUri, nonce, state }),
    })

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>
      throw new OidcLoginError(err['errorCode'] as string | undefined, (err['message'] as string) ?? 'OIDC login failed')
    }

    return res.json() as Promise<OidcCallbackResponse>
  }

  return { getPublicConfig, initiateLogin, exchangeCode }
}
