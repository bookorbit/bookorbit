import { computed, ref, watch, type Ref } from 'vue'
import { BOOK_REQUEST_FORMATS_BY_MEDIA_KIND } from '@bookorbit/types'
import type { BookDetail, BookRequestAvailability, BookRequestMediaKind, BookRequestSubmitResult, CreateBookRequestPayload } from '@bookorbit/types'
import { api } from '@/lib/api'
import { pairHalfState, type PairHalfState } from '../requestPair'
import { submitFailure, type SubmitFailure } from './useRequestSubmission'

/** What the row knows about the missing format: still being asked, or one of the states a search row shows. */
export type MissingFormatState = 'checking' | PairHalfState

/**
 * Asking for the format a book does not have yet, from the book itself.
 *
 * Only an ebook missing its audiobook, or the other way round: those are the two formats one book
 * folder holds together. The request names this book, so the server lands the new format beside
 * the one already here instead of filing it as a second book.
 */
export function useMissingFormatRequest(book: Ref<BookDetail | null>, enabled: Ref<boolean>) {
  const availability = ref<BookRequestAvailability | null>(null)
  const checking = ref(false)
  const submitting = ref(false)
  let generation = 0

  const missing = computed<BookRequestMediaKind | null>(() => {
    if (!book.value) return null
    const formats = book.value.files
      .filter((file) => file.role === 'content' || file.role === 'primary')
      .map((file) => file.format?.toLowerCase() ?? '')
    const hasReadable = formats.some((format) => BOOK_REQUEST_FORMATS_BY_MEDIA_KIND.ebook.includes(format))
    const hasAudio = formats.some((format) => BOOK_REQUEST_FORMATS_BY_MEDIA_KIND.audiobook.includes(format))
    if (hasReadable && !hasAudio) return 'audiobook'
    if (hasAudio && !hasReadable) return 'ebook'
    return null
  })

  const state = computed<MissingFormatState>(() => (checking.value && !availability.value ? 'checking' : pairHalfState(availability.value)))
  const requestId = computed(() => availability.value?.existingRequestId ?? null)
  const ownedBookId = computed(() => availability.value?.ownedBookId ?? null)

  function workFor(current: BookDetail, mediaKind: BookRequestMediaKind) {
    return {
      title: current.title?.trim() || current.files[0]?.filename || '',
      author: current.authors[0]?.name ?? null,
      isbn13: current.isbn13,
      mediaKind,
    }
  }

  async function check(): Promise<void> {
    const current = book.value
    const mediaKind = missing.value
    availability.value = null
    if (!current || !mediaKind || !enabled.value) return

    const asked = ++generation
    const work = workFor(current, mediaKind)
    if (!work.title) return

    checking.value = true
    try {
      const res = await api('/api/v1/book-requests/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ title: work.title, mediaKind, ...(work.author ? { author: work.author } : {}), ...(work.isbn13 ? { isbn13: work.isbn13 } : {}) }],
        }),
      })
      if (asked !== generation || !res.ok) return
      const [first] = (await res.json()) as BookRequestAvailability[]
      availability.value = first ?? null
    } catch {
      // The row still offers the request; the answer only decorates it.
    } finally {
      if (asked === generation) checking.value = false
    }
  }

  /**
   * Files the request, or joins the one somebody already made. Resolves to the server's answer so
   * the caller can say which happened, or to the refusal body when there was one.
   */
  async function request(): Promise<{ result: BookRequestSubmitResult | null; failure: SubmitFailure | null }> {
    const current = book.value
    const mediaKind = missing.value
    if (!current || !mediaKind) return { result: null, failure: null }

    const work = workFor(current, mediaKind)
    const payload: CreateBookRequestPayload = {
      title: work.title,
      mediaKind,
      authors: current.authors.map((author) => author.name),
      isbn13: current.isbn13,
      isbn10: current.isbn10,
      seriesName: current.seriesName,
      publishedYear: current.publishedYear,
      // The book on the shelf says what language it is in, and the other format of it should match.
      language: current.language,
      targetBookId: current.id,
    }

    submitting.value = true
    try {
      const res = await api('/api/v1/book-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return { result: null, failure: await submitFailure(res) }
      const result = (await res.json()) as BookRequestSubmitResult
      availability.value = {
        ownedBookId: null,
        existingRequestId: result.request.id,
        existingRequestStatus: result.request.status,
        alreadySubscribed: true,
      }
      return { result, failure: null }
    } catch {
      return { result: null, failure: { code: null, meta: null, message: null } }
    } finally {
      submitting.value = false
    }
  }

  watch([() => book.value?.id, missing, enabled], () => void check(), { immediate: true })

  return { missing, state, requestId, ownedBookId, availability, submitting, check, request }
}
