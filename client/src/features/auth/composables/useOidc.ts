import type { OidcPublicConfig } from '@projectx/types'
import { api } from '@/lib/api'

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

export function useOidc() {
  async function getPublicConfig(): Promise<OidcPublicConfig | null> {
    try {
      const res = await fetch('/api/app-settings/oidc/public')
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  }

  async function initiateLogin(): Promise<void> {
    const config = await getPublicConfig()
    if (!config?.enabled || !config.issuerUri) {
      throw new Error('OIDC is not configured')
    }

    // Fetch discovery document on the client side
    let discRes: Response
    try {
      discRes = await fetch(`${config.issuerUri.replace(/\/$/, '')}/.well-known/openid-configuration`)
    } catch {
      throw new Error('Cannot reach OIDC provider - check the Issuer URI in settings')
    }
    if (!discRes.ok) throw new Error(`OIDC provider returned HTTP ${discRes.status} - check the Issuer URI in settings`)
    const disc = await discRes.json()

    const { codeVerifier, codeChallenge } = await generatePkce()
    const nonce = generateNonce()

    // Get server-side state (CSRF protection)
    const stateRes = await fetch('/api/auth/oidc/state', { method: 'POST', credentials: 'include' })
    if (!stateRes.ok) throw new Error('Failed to generate state')
    const { state } = await stateRes.json()

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

    window.location.href = `${disc.authorization_endpoint}?${params.toString()}`
  }

  async function exchangeCode(code: string, state: string) {
    const pkceJson = sessionStorage.getItem(`oidc_pkce_${state}`)
    if (!pkceJson) throw new Error('No PKCE data found for this state')

    const { codeVerifier, nonce } = JSON.parse(pkceJson) as { codeVerifier: string; nonce: string; state: string }
    sessionStorage.removeItem(`oidc_pkce_${state}`)

    const redirectUri = `${window.location.origin}/oauth2-callback`

    const res = await fetch('/api/auth/oidc/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ code, codeVerifier, redirectUri, nonce, state }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as any).message ?? 'OIDC login failed')
    }

    return res.json()
  }

  return { getPublicConfig, initiateLogin, exchangeCode }
}
