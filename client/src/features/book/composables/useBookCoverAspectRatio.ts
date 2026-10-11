import { computed, inject, ref, type ComputedRef } from 'vue'
import type { CoverAspectRatio } from '@bookorbit/types'

import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../lib/cover-aspect-ratio'

/**
 * The frame of a book's face. The server sends it per book, following the primary file's medium;
 * the surrounding view's shape (the library's) serves only until the book has loaded.
 */
export function useBookCoverAspectRatio(book: () => { coverAspectRatio?: CoverAspectRatio } | null | undefined): ComputedRef<CoverAspectRatio> {
  const injected = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
  return computed(() => book()?.coverAspectRatio ?? injected.value)
}
