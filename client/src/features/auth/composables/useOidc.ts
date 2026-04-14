import type { OidcCallbackResponse, OidcProviderPublic } from '@projectx/types'

export async function generatePkce(): Promise<{ codeVerifier: string; codeChallenge: string }> {
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
  async function getPublicProviders(): Promise<OidcProviderPublic[]> {
    try {
      const res = await fetch('/api/v1/app-settings/oidc/providers/public')
      if (!res.ok) return []
      return res.json()
    } catch {
      return []
    }
  }

  async function initiateLogin(provider: OidcProviderPublic): Promise<void> {
    if (!provider.enabled) {
      throw new OidcLoginError(undefined, 'OIDC provider is not enabled')
    }

    const { codeVerifier, codeChallenge } = await generatePkce()
    const nonce = generateNonce()

    sessionStorage.removeItem('oidc_redirect')
    const redirectTarget = new URLSearchParams(window.location.search).get('redirect')
    if (redirectTarget && redirectTarget.startsWith('/') && !redirectTarget.startsWith('//')) {
      sessionStorage.setItem('oidc_redirect', redirectTarget)
    }

    const stateRes = await fetch(`/api/v1/auth/oidc/${provider.slug}/state`, { method: 'POST', credentials: 'include' })
    if (!stateRes.ok) throw new OidcLoginError(undefined, 'Failed to generate state')
    const { state, authorizationEndpoint } = (await stateRes.json()) as { state: string; authorizationEndpoint: string }

    if (!authorizationEndpoint) {
      throw new OidcLoginError(undefined, 'OIDC provider is not reachable - check the Issuer URI in settings')
    }

    sessionStorage.setItem(`oidc_pkce_${state}`, JSON.stringify({ codeVerifier, nonce, state }))

    const redirectUri = `${window.location.origin}/oauth2-callback`

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: provider.clientId,
      redirect_uri: redirectUri,
      scope: provider.scopes,
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

  return { getPublicProviders, initiateLogin, exchangeCode }
}
