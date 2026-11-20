import { NotificationType } from '@bookorbit/types'

const NOTIFICATIONS = 'notifications.bulkRuns'
const BULK_RUN = 'jobsArea.types.bulk-run'

export interface BulkRunNotificationCopy {
  title: string
  message: string | null
}

function count(meta: Record<string, unknown>, key: string): number {
  const value = meta[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Words a bulk run notification in the reader's locale from its `meta`, using the Jobs area's names
 * for each kind and reason so both read the same. Null for any other type, or one stored without
 * the fields this needs; the server's English text shows then.
 */
export function bulkRunNotificationCopy(
  notification: { type: string; meta: Record<string, unknown> | null },
  t: (key: string, values?: Record<string, unknown>) => string,
  te: (key: string) => boolean,
): BulkRunNotificationCopy | null {
  const meta = notification.meta
  if (!meta || typeof meta.kind !== 'string') return null
  const kindKey = `${BULK_RUN}.titles.${meta.kind}`
  const action = t(te(kindKey) ? kindKey : `${BULK_RUN}.title`)
  const total = count(meta, 'total')
  switch (notification.type) {
    case NotificationType.BulkRunCompleted:
      return { title: t(`${NOTIFICATIONS}.completedTitle`, { action }), message: t(`${NOTIFICATIONS}.completedMessage`, { count: total }) }
    case NotificationType.BulkRunCompletedWithErrors:
      return {
        title: t(`${NOTIFICATIONS}.completedWithErrorsTitle`, { action }),
        message: t(`${NOTIFICATIONS}.completedWithErrorsMessage`, { total, failed: count(meta, 'failed') }),
      }
    case NotificationType.BulkRunFailed: {
      const reasonKey = typeof meta.code === 'string' ? `${BULK_RUN}.reasons.${meta.code}` : null
      return {
        title: t(`${NOTIFICATIONS}.failedTitle`, { action }),
        message: t(reasonKey && te(reasonKey) ? reasonKey : `${BULK_RUN}.failedDefault`),
      }
    }
    case NotificationType.BulkRunInterrupted:
      return { title: t(`${NOTIFICATIONS}.interruptedTitle`, { action }), message: t(`${BULK_RUN}.reasons.interrupted`) }
    default:
      return null
  }
}
