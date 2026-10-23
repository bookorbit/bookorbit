import { useI18n } from 'vue-i18n'
import type { EmailSendLogEntry } from '@bookorbit/types'

import { formatBytes } from '@/lib/formatting'
import { formatRelativeFromNow } from '@/i18n/formatters'
import { deliveryKind, deliveryReason } from '../lib/email-delivery'

/** The sentences a failed or retrying send is explained with, shared by the history and the attention band. */
export function useDeliveryWords() {
  const { t } = useI18n()

  function lead(entry: EmailSendLogEntry, serverName?: string | null, serverHost?: string | null): string {
    const server = serverName ?? t('email.reason.server')
    const size = entry.fileSizeBytes ? formatBytes(entry.fileSizeBytes) : ''
    switch (deliveryReason(entry)) {
      case 'tooLarge':
        return serverHost && /gmail\.com$|googlemail\.com$/i.test(serverHost)
          ? t('email.reason.tooLargeGmail', { size })
          : t('email.reason.tooLarge', { size, server })
      case 'signIn':
        return t('email.reason.signIn', { server })
      case 'unreachable':
        return t('email.reason.unreachable', { server })
      case 'unconfirmed':
        return t('email.reason.unconfirmed')
      case 'interrupted':
        return t('email.reason.interrupted')
      case 'preparation':
        return t('email.reason.preparation')
      case 'other':
        return t('email.reason.other')
      default:
        return ''
    }
  }

  function fix(entry: EmailSendLogEntry): string {
    if (deliveryKind(entry) === 'retrying' && entry.nextRetryAt)
      return t('email.reason.retryAt', { time: formatRelativeFromNow(new Date(entry.nextRetryAt)) })
    switch (deliveryReason(entry)) {
      case 'tooLarge':
        return t('email.reason.tooLargeFix')
      case 'signIn':
        return t('email.reason.signInFix')
      case 'unconfirmed':
        return t('email.reason.unconfirmedFix')
      case 'interrupted':
        return t('email.reason.interruptedFix')
      default:
        return ''
    }
  }

  return { lead, fix }
}
