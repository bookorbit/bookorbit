import type { AnnotationItem } from '@bookorbit/types'

/**
 * What the shared stream needs to draw a group rule. Both the library hub and a book's
 * Highlights tab build their groups differently - the hub detects runs in a server-sorted
 * page, the book tab hangs loaded rows off the server's chapter aggregate - so they meet
 * here rather than sharing the grouping itself.
 */
export interface StreamGroup {
  key: string
  /** Already translated by the page, which owns the vocabulary for its own axes. */
  label: string
  /** Drawn as a dot before the label, for colour and source groupings. */
  swatch?: string | null
  /** Printed at the right of the rule. The book tab's counts come from the server aggregate. */
  count: number
  /** Only the library hub's by-book grouping sets this; it turns the rule into a book header. */
  book?: { bookId: number; title: string; author: string | null } | null
  items: AnnotationItem[]
}

export interface StreamViewOption {
  value: string
  label: string
}
