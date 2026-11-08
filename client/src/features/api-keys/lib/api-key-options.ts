import { API_KEY_DEFAULT_EXPIRY_DAYS, API_KEY_EXPIRY_PRESETS, type ApiKeySummary } from '@bookorbit/types'

const DAY_MS = 24 * 60 * 60 * 1000
const EXPIRING_SOON_MS = 7 * DAY_MS

export type ApiKeyState = 'active' | 'expiring' | 'expired' | 'revoked'

export function apiKeyState(key: Pick<ApiKeySummary, 'expiresAt' | 'revokedAt'>, now = Date.now()): ApiKeyState {
  if (key.revokedAt) return 'revoked'
  if (!key.expiresAt) return 'active'
  const remaining = new Date(key.expiresAt).getTime() - now
  if (remaining <= 0) return 'expired'
  return remaining <= EXPIRING_SOON_MS ? 'expiring' : 'active'
}

export interface ExpiryChoice {
  id: string
  /** The lifetime the key gets, or null for a key that never expires. */
  days: number | null
  /** What the request carries: a preset, null for never, or undefined to take the server default. */
  request: number | null | undefined
}

/**
 * The lifetimes a new key may be given. A server cap hides every preset above it, Never included.
 * When the cap leaves no preset at the default, the server's own default (the cap itself) is
 * offered instead, so a short cap never leaves the form with nothing to choose.
 */
export function expiryChoices(maxLifetimeDays: number | null): ExpiryChoice[] {
  const choices: ExpiryChoice[] = API_KEY_EXPIRY_PRESETS.filter((days) =>
    maxLifetimeDays === null ? true : days !== null && days <= maxLifetimeDays,
  ).map((days) => ({ id: days === null ? 'never' : String(days), days, request: days }))

  const serverDefault = Math.min(API_KEY_DEFAULT_EXPIRY_DAYS, maxLifetimeDays ?? API_KEY_DEFAULT_EXPIRY_DAYS)
  if (!choices.some((choice) => choice.days === serverDefault)) {
    choices.push({ id: 'server-default', days: serverDefault, request: undefined })
    choices.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity))
  }
  return choices
}

/** The choice a new key starts on: the default lifetime, or the longest one the cap allows below it. */
export function defaultExpiryChoice(choices: readonly ExpiryChoice[]): string {
  const fallback = choices.filter((choice) => choice.days !== null && choice.days <= API_KEY_DEFAULT_EXPIRY_DAYS).at(-1)
  return (fallback ?? choices[0])?.id ?? 'server-default'
}

/** How the token is shown once it is gone: the prefix, an ellipsis and its last characters. */
export function maskedToken(hint: string): string {
  return `bok_…${hint}`
}
