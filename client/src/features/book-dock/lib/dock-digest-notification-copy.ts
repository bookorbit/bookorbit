import { NotificationType } from '@bookorbit/types'

const COPY = 'notifications.bookDock'

export interface DockDigestNotificationCopy {
  title: string
  message: string
}

function count(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key]
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Words a dock digest in the reader's locale from its `meta`. Null for any other type, or one
 * stored without the counts this needs; the server's English text shows then.
 */
export function dockDigestNotificationCopy(
  notification: { type: string; meta: Record<string, unknown> | null },
  t: (key: string, values?: Record<string, unknown>) => string,
): DockDigestNotificationCopy | null {
  if (notification.type !== NotificationType.BookDockDigest && notification.type !== NotificationType.BookDockDigestNeedsReview) return null
  const meta = notification.meta
  if (!meta || !('dockId' in meta)) return null
  const filed = count(meta, 'filed')
  const held = count(meta, 'held')
  if (filed === null || held === null) return null

  const title =
    meta.dockId === null
      ? t(`${COPY}.digestTitleUnsorted`)
      : typeof meta.libraryName === 'string'
        ? t(`${COPY}.digestTitle`, { library: meta.libraryName })
        : t(`${COPY}.digestTitleUnknown`)
  const message =
    held === 0
      ? t(`${COPY}.digestFiled`, { filed })
      : filed === 0
        ? t(`${COPY}.digestHeld`, { held })
        : t(`${COPY}.digestFiledAndHeld`, { filed, held })
  return { title, message }
}
