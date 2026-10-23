import type { EmailSendLogEntry } from '@bookorbit/types'

export type DeliveryKind = 'sent' | 'sending' | 'retrying' | 'unconfirmed' | 'failed'

/** Every send gets three tries; see SEND_RETRY_DELAYS_MS on the server. */
export const MAX_SEND_ATTEMPTS = 3

/**
 * Failure codes for a send whose fate the server cannot know: the connection dropped after the
 * message was handed over, or the process stopped mid-send. Resending may deliver it twice.
 */
const UNCONFIRMED_CODES = new Set(['SMTP_OUTCOME_UNKNOWN', 'SMTP_ACCEPTED_LOG_FAILED', 'SEND_INTERRUPTED'])
const INTERRUPTED = /server restarted before send completed/i

type DeliveryFields = Pick<EmailSendLogEntry, 'status' | 'attemptCount' | 'failureCode' | 'errorMessage'>

export function deliveryKind(entry: DeliveryFields): DeliveryKind {
  if (entry.status === 'sent') return 'sent'
  if (entry.status === 'pending') return entry.attemptCount > 0 ? 'retrying' : 'sending'
  if ((entry.failureCode && UNCONFIRMED_CODES.has(entry.failureCode)) || INTERRUPTED.test(entry.errorMessage ?? '')) return 'unconfirmed'
  return 'failed'
}

export function needsAttention(entry: DeliveryFields): boolean {
  const kind = deliveryKind(entry)
  return kind === 'failed' || kind === 'unconfirmed'
}

export type DeliveryReason = 'tooLarge' | 'signIn' | 'unreachable' | 'unconfirmed' | 'interrupted' | 'preparation' | 'other'

const TOO_LARGE = /\b552\b|size limit|too large|exceeded .*size|message size/i
const SIGN_IN = /\b535\b|\b534\b|auth|password|credentials|username/i
const UNREACHABLE = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET|greeting never received|timed? ?out/i

/**
 * The plain-language cause of a failed or retrying send, read from what the server stored. The raw
 * server text stays available beside it; this only decides which sentence leads.
 */
export function deliveryReason(entry: DeliveryFields): DeliveryReason | null {
  if (deliveryKind(entry) === 'sent') return null
  if (INTERRUPTED.test(entry.errorMessage ?? '') || entry.failureCode === 'SEND_INTERRUPTED') return 'interrupted'
  if (entry.failureCode && UNCONFIRMED_CODES.has(entry.failureCode)) return 'unconfirmed'
  if (entry.failureCode === 'DELIVERY_PREPARATION_FAILED') return 'preparation'
  const message = entry.errorMessage ?? ''
  if (!message) return null
  if (TOO_LARGE.test(message)) return 'tooLarge'
  if (SIGN_IN.test(message)) return 'signIn'
  if (UNREACHABLE.test(message)) return 'unreachable'
  return 'other'
}
