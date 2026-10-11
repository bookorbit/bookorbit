import { BookOpen, Headphones } from '@lucide/vue'
import type { StoredBookRequestMediaKind } from '@bookorbit/types'

/**
 * The icon for a request's medium. An old request can still carry a retired medium, and it reads
 * as a book: the label beside it says which.
 */
export function requestMediaIcon(mediaKind: StoredBookRequestMediaKind) {
  return mediaKind === 'audiobook' ? Headphones : BookOpen
}

/** Literal classes, because Tailwind reads this file as text and never sees a class built at runtime. */
export function requestMediaColor(mediaKind: StoredBookRequestMediaKind): string {
  if (mediaKind === 'audiobook') return 'text-[var(--pill-media-audiobook)]'
  if (mediaKind === 'ebook') return 'text-[var(--pill-media-ebook)]'
  return 'text-muted-foreground'
}
