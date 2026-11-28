import type { ReadStatus } from '@bookorbit/types'
import { i18n } from '@/i18n'

const READ_STATUS_LABEL_KEYS: Record<ReadStatus, string> = {
  unread: 'book.readStatus.unread',
  want_to_read: 'book.readStatus.wantToRead',
  reading: 'book.readStatus.reading',
  on_hold: 'book.readStatus.onHold',
  rereading: 'book.readStatus.rereading',
  read: 'book.readStatus.read',
  skimmed: 'book.readStatus.skimmed',
  abandoned: 'book.readStatus.abandoned',
}

export function readStatusLabel(status: string): string | undefined {
  if (!Object.hasOwn(READ_STATUS_LABEL_KEYS, status)) return undefined
  return i18n.global.t(READ_STATUS_LABEL_KEYS[status as ReadStatus])
}
