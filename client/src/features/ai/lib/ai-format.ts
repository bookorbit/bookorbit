import { isAiApiType } from '@bookorbit/types'

import { i18n } from '@/i18n'
import { formatDate, formatListParts, formatNumber } from '@/i18n/formatters'
import { ApiError, errorMessage } from '@/lib/api-json'

const MICROS_PER_DOLLAR = 1_000_000

/** The smallest cost four places can show; anything above zero and below it reads "< $0.0001". */
const SMALLEST_SHOWN_MICROS = 100

/** Dollars with cents, or with four places when a cost is under a cent, so a small test never reads $0.00. */
export function formatAiCost(micros: number): string {
  if (micros > 0 && micros < SMALLEST_SHOWN_MICROS) {
    return i18n.global.t('settings.admin.ai.costBelow', { cost: formatAiCost(SMALLEST_SHOWN_MICROS) })
  }
  const dollars = micros / MICROS_PER_DOLLAR
  const small = micros > 0 && micros < 10_000
  return formatNumber(dollars, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: small ? 4 : 2,
    maximumFractionDigits: small ? 4 : 2,
  })
}

/** Dollars as the API sends them, shown the way micro-dollar costs are. */
export function formatAiDollars(dollars: number): string {
  return formatAiCost(Math.round(dollars * MICROS_PER_DOLLAR))
}

/** How long a build took: seconds under a minute, minutes and seconds under an hour, else hours and minutes. */
export function formatBuildTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const t = i18n.global.t
  if (total < 60) return t('aiArea.storyGuides.time.seconds', { seconds: formatNumber(total) })
  if (total < 3600) {
    return t('aiArea.storyGuides.time.minutes', { minutes: formatNumber(Math.floor(total / 60)), seconds: formatNumber(total % 60) })
  }
  return t('aiArea.storyGuides.time.hours', { hours: formatNumber(Math.floor(total / 3600)), minutes: formatNumber(Math.floor((total % 3600) / 60)) })
}

/** The models a build ran on: one name when both slots used the same model. */
export function modelPairLabel(fast: string | null | undefined, careful: string | null | undefined): string | null {
  if (fast && careful && fast !== careful) return i18n.global.t('aiArea.storyGuides.modelPair', { fast, careful })
  return fast || careful || null
}

/** A model's price per million tokens: cents at least, and up to four places for the cheapest models. */
export function formatTokenPrice(value: number): string {
  return formatNumber(value, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

/** A price in a table cell: whole dollars without cents, so "$2 / $10" stays narrow. */
export function formatTokenPriceShort(value: number): string {
  const whole = Number.isInteger(value)
  return formatNumber(value, { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 4 })
}

export function formatDollars(value: number): string {
  return formatNumber(value, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** The host and port a connection calls, which is what tells two connections apart at a glance. */
export function connectionHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

export function maskedHint(hint: string): string {
  return `••••${hint}`
}

export function apiTypeLabel(apiType: string): string {
  return isAiApiType(apiType) ? i18n.global.t(`settings.admin.ai.apiTypes.${apiType}`) : i18n.global.t('settings.admin.ai.apiTypes.unknown')
}

/** Ledger feature ids include the admin's own tests, which are not features but still cost money. */
export function usageFeatureLabel(feature: string): string {
  const key = `settings.admin.ai.featureNames.${feature}`
  return i18n.global.te(key) ? i18n.global.t(key) : feature
}

/** A feature's name in a settings table, shorter than the usage view's; an unknown id keeps its usage label. */
export function featureShortName(feature: string): string {
  const key = `settings.admin.ai.features.shortNames.${feature}`
  return i18n.global.te(key) ? i18n.global.t(key) : usageFeatureLabel(feature)
}

export function slotLabel(slot: string): string {
  const key = `settings.admin.ai.slots.${slot}`
  return i18n.global.te(key) ? i18n.global.t(key) : slot
}

/** Slots named in a sentence: "Fast and Careful". */
export function slotList(slots: readonly string[]): string {
  return formatListParts(slots.map(slotLabel))
    .map((part) => part.value)
    .join('')
}

export interface AiFailureDetails {
  retryAfterSeconds?: number
  /** The provider's own words, already scrubbed of keys and header values by the server. */
  message?: string | null
}

/**
 * What a failure code means and what to do about it. A code this build does not know shows the
 * provider's own message, which is better than a generic line.
 */
export function failureText(code: string | null | undefined, details: AiFailureDetails = {}): string {
  if (code === 'rate-limited' && details.retryAfterSeconds) {
    return i18n.global.t('settings.admin.ai.failures.rateLimitedRetry', { seconds: details.retryAfterSeconds })
  }
  const key = code ? `settings.admin.ai.failures.${code}` : null
  if (key && i18n.global.te(key)) return i18n.global.t(key)
  return details.message?.trim() || i18n.global.t('settings.admin.ai.failures.unknown')
}

/** A Try it name's kind; the server sends one of four and falls back to `thing`, but an older one may not. */
export function tryKindLabel(kind: string): string {
  const key = `settings.admin.ai.models.kinds.${kind}`
  return i18n.global.te(key) ? i18n.global.t(key) : kind
}

/**
 * Why Try it failed. A provider failure says what it means and what to do; a client code says what
 * stopped the request before or after it reached the provider.
 */
export function tryFailureText(reason: unknown): { text: string; providerMessage: string | null } {
  if (!(reason instanceof ApiError) || reason.errorCode !== 'AI_TRY_FAILED') {
    return { text: errorMessage(reason, 'settings.admin.ai.models.tryFailed'), providerMessage: null }
  }
  const failure = typeof reason.errorMeta.failure === 'string' ? reason.errorMeta.failure : null
  const code = typeof reason.errorMeta.code === 'string' ? reason.errorMeta.code : null
  const message = typeof reason.errorMeta.providerMessage === 'string' ? reason.errorMeta.providerMessage.trim() : ''
  let text: string
  if (failure) text = failureText(failure, { message })
  else if (code && i18n.global.te(`settings.admin.ai.models.tryErrors.${code}`)) text = i18n.global.t(`settings.admin.ai.models.tryErrors.${code}`)
  else text = message || reason.message
  return { text, providerMessage: message && message !== text ? message : null }
}

/** A ledger outcome: `ok`, a named stop such as `length`, or `error:<code>` for a client failure code. */
export function outcomeLabel(outcome: string): string {
  if (outcome.startsWith('error:')) {
    const code = outcome.slice('error:'.length)
    const key = `settings.admin.ai.usage.errorCodes.${code}`
    return i18n.global.te(key) ? i18n.global.t(key) : code
  }
  const key = `settings.admin.ai.usage.outcomes.${outcome}`
  return i18n.global.te(key) ? i18n.global.t(key) : outcome
}

/** `2026-11` as the month's name in the reader's language. */
export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return month
  return formatDate(new Date(Number(match[1]), Number(match[2]) - 1, 1), { month: 'short', year: 'numeric' })
}
