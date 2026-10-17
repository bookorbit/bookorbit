import { isAudioFormat, type BookFileRef, type EmailRecipient } from '@bookorbit/types'

import { rankedContentFiles } from '@/features/book/lib/book-formats'
import { hasReadAlong } from '@/features/book/lib/file-capabilities'

/** What Amazon's Send to Kindle takes by email since 2023, among the formats a recipient can prefer. */
export const KINDLE_EMAIL_FORMATS = ['epub', 'pdf'] as const
export const RECIPIENT_FORMATS = ['epub', 'pdf', 'mobi', 'azw3', 'cbz', 'cbr', 'djvu'] as const

const MB = 1024 * 1024
const KINDLE_LIMIT_BYTES = 50 * MB
/** Gmail's attachment ceiling, the one most self-hosters meet first. */
const GMAIL_LIMIT_BYTES = 25 * MB

export function formatsFor(deviceType: string | null | undefined): readonly string[] {
  return deviceType === 'kindle' ? KINDLE_EMAIL_FORMATS : RECIPIENT_FORMATS
}

export function kindleAccepts(format: string): boolean {
  return (KINDLE_EMAIL_FORMATS as readonly string[]).includes(format.toLowerCase())
}

/** The editions an email can carry, in the order the server ranks them: never audiobook tracks. */
export function sendableFiles(files: readonly BookFileRef[], formatPriority?: readonly string[] | null): BookFileRef[] {
  return rankedContentFiles(files, formatPriority).filter((file) => file.format && !isAudioFormat(file.format))
}

export type PlannedRecipient = Pick<EmailRecipient, 'deviceType' | 'preferredFormat' | 'readAloudDelivery'>

export interface PlannedFile {
  file: BookFileRef
  /** The format the recipient prefers when the book has no edition in it. */
  missingFormat: string | null
  /** The narrated EPUB, sent because the recipient asked for originals. */
  readAlong: boolean
}

/**
 * The edition one recipient would get, following EmailFileSelector: an explicit choice first, then
 * the recipient's format, then the book's primary. A recipient set to original read-along EPUBs gets
 * the narrated copy, which a Kindle never does.
 */
export function planFile(files: readonly BookFileRef[], recipient: PlannedRecipient, chosenFormat: string | null): PlannedFile | null {
  const plain = files.filter((file) => !hasReadAlong(file))
  const pool = plain.length > 0 ? plain : files
  const first = pool[0]
  if (!first) return null
  const byFormat = (format: string) =>
    pool.find((file) => file.format?.toLowerCase() === format) ?? files.find((file) => file.format?.toLowerCase() === format)

  if (chosenFormat) {
    const chosen = byFormat(chosenFormat)
    return chosen
      ? { file: chosen, missingFormat: null, readAlong: hasReadAlong(chosen) }
      : { file: first, missingFormat: chosenFormat, readAlong: false }
  }

  const wanted = recipient.preferredFormat?.toLowerCase() ?? null
  if (recipient.readAloudDelivery === 'original' && recipient.deviceType !== 'kindle' && (!wanted || wanted === 'epub')) {
    const narrated = files.find(hasReadAlong)
    if (narrated) return { file: narrated, missingFormat: null, readAlong: true }
  }
  if (wanted) {
    const match = byFormat(wanted)
    if (match) return { file: match, missingFormat: null, readAlong: hasReadAlong(match) }
    return { file: first, missingFormat: wanted, readAlong: false }
  }
  return { file: first, missingFormat: null, readAlong: false }
}

export type SizeLimit = 'kindle' | 'gmail'

/** The first limit this attachment is over, or null. A Kindle's own limit wins over the server's. */
export function sizeLimitExceeded(
  sizeBytes: number | null,
  deviceType: string | null | undefined,
  serverHost: string | null | undefined,
): SizeLimit | null {
  if (!sizeBytes) return null
  if (deviceType === 'kindle' && sizeBytes > KINDLE_LIMIT_BYTES) return 'kindle'
  if (serverHost && /(^|\.)gmail\.com$|googlemail\.com$/i.test(serverHost) && sizeBytes > GMAIL_LIMIT_BYTES) return 'gmail'
  return null
}
