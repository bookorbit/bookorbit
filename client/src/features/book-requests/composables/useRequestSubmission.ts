import { computed, onUnmounted, ref, watch } from 'vue'
import { api } from '@/lib/api'
import { BOOK_REQUEST_MEDIA_KINDS, bookRequestSubmitErrorCode } from '@bookorbit/types'
import type {
  BookRequestAvailability,
  BookRequestFailureMeta,
  BookRequestMediaKind,
  BookRequestMetadataSource,
  BookRequestPairHalfPayload,
  BookRequestPairSubmitResult,
  BookRequestSubmitErrorCode,
  BookRequestSubmitResult,
  CreateBookRequestPairPayload,
  CreateBookRequestPayload,
  MetadataCandidate,
} from '@bookorbit/types'

/** Stands in for a candidate key while a free-text submission is in flight; there is no candidate. */
const FREE_TEXT_KEY = '__free_text__'

/** Providers stream in; annotate in bounded batches rather than one call per arriving result. */
const ANNOTATE_BATCH_LIMIT = 50

/**
 * A search streams a dozen providers in over several seconds, and the results array changes
 * identity on every arrival. Coalescing the arrivals inside this window is what keeps that from
 * becoming one availability round trip per candidate.
 */
const ANNOTATE_COALESCE_MS = 150

/**
 * Why the server refused, in the two forms it can answer with.
 *
 * `code` is the one the form renders: every rule this instance applies has one, so the reason is
 * translated rather than repeated in English. `message` survives only as the fallback for a
 * refusal nothing has classified, which is what an unrecognised code and a validation error both
 * come back as.
 */
export interface SubmitFailure {
  code: BookRequestSubmitErrorCode | null
  meta: BookRequestFailureMeta | null
  message: string | null
}

const UNCLASSIFIED_FAILURE: SubmitFailure = { code: null, meta: null, message: null }

/** Reads a refused submission into the shape the form renders, for every caller that submits. */
export async function submitFailure(res: Response): Promise<SubmitFailure> {
  try {
    const body = (await res.json()) as { message?: string | string[]; errorCode?: unknown; errorMeta?: BookRequestFailureMeta }
    const message = Array.isArray(body.message) ? body.message[0] : body.message
    return { code: bookRequestSubmitErrorCode(body.errorCode), meta: body.errorMeta ?? null, message: message ?? null }
  } catch {
    return UNCLASSIFIED_FAILURE
  }
}

/**
 * What to show somebody whose submission was refused, in their language where the server said
 * enough for that to be possible.
 *
 * The code wins wherever there is one: the sentence beside it is English written at the point of
 * refusal and was only ever the fallback. It is still the right fallback, because a validation
 * error naming the field beats "that did not work".
 *
 * `t` is injected so this stays a pure function of the failure, testable without standing up i18n.
 */
export function submitFailureText(failure: SubmitFailure | null, t: (key: string, named: Record<string, unknown>) => string): string | null {
  if (!failure) return null
  if (failure.code) return t(`bookRequests.submitError.${failure.code}`, failure.meta ?? {})
  return failure.message
}

export function candidateKey(candidate: MetadataCandidate): string {
  return `${candidate.provider}:${candidate.providerId}`
}

export function candidateTitle(candidate: MetadataCandidate): string {
  return candidate.displayTitle ?? candidate.title ?? ''
}

/**
 * A candidate's series index is a label ("01", "1.5"); a request stores a whole number. A request
 * for book 1.5 is still a request for that book, so narrow rather than refuse the submission.
 */
function requestSeriesIndex(candidate: MetadataCandidate): number | null {
  if (candidate.seriesIndex == null) return null
  const parsed = Number.parseFloat(candidate.seriesIndex)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

/** One answer per medium asked about, so a pair search can hold both without one overwriting the other. */
function availabilityKey(mediaKind: BookRequestMediaKind, candidate: MetadataCandidate): string {
  return `${mediaKind}|${candidateKey(candidate)}`
}

/** What every submission path says about the work itself, whichever media it asks for. */
interface WorkExtras {
  note?: string | null
  language?: string | null
  coverUrl?: string | null
  selfServe?: boolean
  isbn10?: string | null
  isbn13?: string | null
  providerKey?: string | null
  providerId?: string | null
  metadataSources?: BookRequestMetadataSource[]
}

export function useRequestSubmission() {
  const availability = ref<Record<string, BookRequestAvailability>>({})
  /**
   * Why the last submission was refused, so the page can say the specific reason rather than
   * replacing it with "that did not work". A self-serve request can be turned down for reasons
   * only the server knows: too many downloads already in flight, or a destination the requester
   * cannot reach.
   */
  const lastFailure = ref<SubmitFailure | null>(null)
  const submitting = ref<string | null>(null)
  const mediaKind = ref<BookRequestMediaKind>('ebook')
  /**
   * Asking for the ebook and the audiobook together. The search then covers both media, every
   * result is annotated for both, and `mediaKind` stays on the ebook that leads the pair.
   */
  const pairMode = ref(false)
  const annotatedKinds = computed<BookRequestMediaKind[]>(() => (pairMode.value ? [...BOOK_REQUEST_MEDIA_KINDS] : [mediaKind.value]))

  /** Claimed keys, in flight or already answered, so a candidate is never asked about twice. */
  let claimed = new Set<string>()
  let queue: MetadataCandidate[] = []
  let coalesceHandle: ReturnType<typeof setTimeout> | null = null
  let draining = false
  /** Bumped whenever the question changes, so an answer to the old one is discarded. */
  let generation = 0

  /**
   * Queues a page of candidates for "already in your library" and "already requested". Results
   * arriving one provider at a time collapse into a small number of batched round trips.
   */
  function annotate(candidates: MetadataCandidate[]): void {
    for (const candidate of candidates) {
      const key = candidateKey(candidate)
      if (!candidateTitle(candidate) || claimed.has(key)) continue
      claimed.add(key)
      queue.push(candidate)
    }
    if (queue.length === 0 || coalesceHandle !== null) return

    coalesceHandle = setTimeout(() => {
      coalesceHandle = null
      void drainQueue()
    }, ANNOTATE_COALESCE_MS)
  }

  /** One batch in flight at a time; later arrivals join the queue rather than opening a request. */
  async function drainQueue(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (queue.length) {
        const batch = queue.splice(0, ANNOTATE_BATCH_LIMIT)
        const asked = generation
        const kinds = annotatedKinds.value
        const answered = await fetchAvailability(batch, kinds)

        // The media kind changed while this was in flight, so the answer is to the wrong question.
        if (generation !== asked) return
        if (!answered) continue

        const next = { ...availability.value }
        batch.forEach((candidate, index) => {
          kinds.forEach((kind, offset) => {
            const result = answered[index * kinds.length + offset]
            if (result) next[availabilityKey(kind, candidate)] = result
          })
        })
        availability.value = next
      }
    } finally {
      draining = false
    }
  }

  async function fetchAvailability(batch: MetadataCandidate[], kinds: BookRequestMediaKind[]): Promise<BookRequestAvailability[] | null> {
    try {
      const res = await api('/api/v1/book-requests/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // One item per medium asked about, candidate-major, which is the order the answer is read back in.
        body: JSON.stringify({
          items: batch.flatMap((c) =>
            kinds.map((kind) => ({
              title: candidateTitle(c),
              author: c.authors?.[0],
              isbn13: c.isbn13,
              providerKey: c.provider,
              providerId: c.providerId,
              mediaKind: kind,
            })),
          ),
        }),
      })
      if (res.ok) return (await res.json()) as BookRequestAvailability[]
      // A 4xx is deterministic - the same batch would be refused again - so the keys stay claimed.
      // A 5xx is the server having a bad moment, and holding the claim would drop the "already
      // requested" and "in your library" badges from every result for the rest of the visit.
      if (res.status >= 500) for (const candidate of batch) claimed.delete(candidateKey(candidate))
      return null
    } catch {
      // A dropped connection is not deterministic either, so the next arrival asks again.
      for (const candidate of batch) claimed.delete(candidateKey(candidate))
      return null
    }
  }

  /** A different medium is a different question, so every annotation is recomputed. */
  watch([mediaKind, pairMode], () => {
    generation += 1
    availability.value = {}
    claimed = new Set()
    queue = []
    if (coalesceHandle !== null) clearTimeout(coalesceHandle)
    coalesceHandle = null
  })

  onUnmounted(() => {
    if (coalesceHandle !== null) clearTimeout(coalesceHandle)
    coalesceHandle = null
  })

  function getAvailability(candidate: MetadataCandidate, kind: BookRequestMediaKind = mediaKind.value): BookRequestAvailability | null {
    return availability.value[availabilityKey(kind, candidate)] ?? null
  }

  /** The work as a candidate describes it, shared by a single request and by both halves of a pair. */
  function workPayload(candidate: MetadataCandidate, extra: WorkExtras) {
    return {
      title: candidateTitle(candidate),
      ...(extra.selfServe ? { selfServe: true } : {}),
      subtitle: candidate.subtitle ?? null,
      authors: candidate.authors ?? [],
      seriesName: candidate.seriesName ?? null,
      seriesIndex: requestSeriesIndex(candidate),
      isbn10: extra.isbn10 !== undefined ? extra.isbn10 : (candidate.isbn10 ?? null),
      isbn13: extra.isbn13 !== undefined ? extra.isbn13 : (candidate.isbn13 ?? null),
      publishedYear: candidate.publishedYear ?? null,
      // What the requester chose, not what the edition happened to be. Inheriting the edition's
      // language silently is how a request for a book became a request for a translation.
      language: extra.language ?? null,
      coverUrl: normalizeCoverUrl(extra.coverUrl !== undefined ? extra.coverUrl : candidate.coverUrl),
      providerKey: extra.providerKey !== undefined ? extra.providerKey : candidate.provider,
      providerId: extra.providerId !== undefined ? extra.providerId : candidate.providerId,
      metadataSources: extra.metadataSources ?? [],
      note: extra.note ?? null,
    }
  }

  /** What is now known for certain about one medium of a candidate, claimed so no queued answer lands on it. */
  function recordSubmitted(candidate: MetadataCandidate, kind: BookRequestMediaKind, result: BookRequestSubmitResult): void {
    claimed.add(candidateKey(candidate))
    availability.value = {
      ...availability.value,
      [availabilityKey(kind, candidate)]: {
        ownedBookId: getAvailability(candidate, kind)?.ownedBookId ?? null,
        existingRequestId: result.request.id,
        existingRequestStatus: result.request.status,
        alreadySubscribed: true,
      },
    }
  }

  async function post<T>(path: string, payload: unknown, key: string): Promise<T | null> {
    submitting.value = key
    lastFailure.value = null
    try {
      const res = await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        lastFailure.value = await submitFailure(res)
        return null
      }
      return (await res.json()) as T
    } catch {
      // A network failure never reached the server, so there is no classified refusal to show. The
      // caller falls back to its generic message on a null return; without this the promise
      // rejected, the button simply un-disabled, and the person was told nothing at all.
      lastFailure.value = UNCLASSIFIED_FAILURE
      return null
    } finally {
      submitting.value = null
    }
  }

  async function submit(
    candidate: MetadataCandidate,
    extra: WorkExtras & {
      targetLibraryId?: number | null
      targetFolderId?: number | null
      preferredFormats?: string[]
      /** The medium to ask for, when it is not the one the search is on: one half of a pair. */
      mediaKind?: BookRequestMediaKind
      /** The book on the shelf the new format should join. */
      targetBookId?: number | null
    },
  ): Promise<BookRequestSubmitResult | null> {
    const kind = extra.mediaKind ?? mediaKind.value
    const payload: CreateBookRequestPayload = {
      ...workPayload(candidate, extra),
      mediaKind: kind,
      targetLibraryId: extra.targetLibraryId ?? null,
      targetFolderId: extra.targetFolderId ?? null,
      preferredFormats: extra.preferredFormats ?? [],
      ...(extra.targetBookId ? { targetBookId: extra.targetBookId } : {}),
    }

    const result = await post<BookRequestSubmitResult>('/api/v1/book-requests', payload, candidateKey(candidate))
    if (result) recordSubmitted(candidate, kind, result)
    return result
  }

  /** The ebook and the audiobook of one candidate, in one submission. */
  async function submitPair(
    candidate: MetadataCandidate,
    extra: WorkExtras & { ebook: BookRequestPairHalfPayload; audiobook: BookRequestPairHalfPayload },
  ): Promise<BookRequestPairSubmitResult | null> {
    const payload: CreateBookRequestPairPayload = {
      ...workPayload(candidate, extra),
      ebook: halfPayload(extra.ebook),
      audiobook: halfPayload(extra.audiobook),
    }

    const result = await post<BookRequestPairSubmitResult>('/api/v1/book-requests/pairs', payload, candidateKey(candidate))
    if (result) {
      for (const kind of BOOK_REQUEST_MEDIA_KINDS) recordSubmitted(candidate, kind, result[kind])
    }
    return result
  }

  /**
   * What the library and the queue already know about a title nobody searched a provider for.
   *
   * Free text has no provider id and usually no ISBN, so this is the weakest identity the dedupe
   * rules ever see and it will miss matches a provider result would have caught. It is here to
   * show a person what was found before they commit, not to decide anything.
   */
  async function checkFreeText(work: { title: string; author?: string | null }): Promise<BookRequestAvailability | null> {
    const title = work.title.trim()
    if (!title) return null

    try {
      const res = await api('/api/v1/book-requests/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ title, mediaKind: mediaKind.value, ...(work.author?.trim() ? { author: work.author.trim() } : {}) }] }),
      })
      if (!res.ok) return null
      const [first] = (await res.json()) as BookRequestAvailability[]
      return first ?? null
    } catch {
      return null
    }
  }

  /**
   * A request for a work no metadata provider returned. Everything the row carries is what the
   * person typed, which is enough for the release search to score against and is the whole point:
   * the provider catalogues are not the limit of what a tracker has.
   */
  async function submitFreeText(
    work: { title: string; author?: string | null },
    extra: {
      targetLibraryId?: number | null
      targetFolderId?: number | null
      language?: string | null
      selfServe?: boolean
      note?: string | null
      preferredFormats?: string[]
    },
  ): Promise<BookRequestSubmitResult | null> {
    const title = work.title.trim()
    if (!title) return null

    const payload: CreateBookRequestPayload = {
      title,
      mediaKind: mediaKind.value,
      authors: work.author?.trim() ? [work.author.trim()] : [],
      targetLibraryId: extra.targetLibraryId ?? null,
      targetFolderId: extra.targetFolderId ?? null,
      language: extra.language ?? null,
      note: extra.note ?? null,
      preferredFormats: extra.preferredFormats ?? [],
      ...(extra.selfServe ? { selfServe: true } : {}),
    }

    return post<BookRequestSubmitResult>('/api/v1/book-requests', payload, FREE_TEXT_KEY)
  }

  /** The same, for both media at once. */
  async function submitPairFreeText(
    work: { title: string; author?: string | null },
    extra: {
      language?: string | null
      selfServe?: boolean
      note?: string | null
      ebook: BookRequestPairHalfPayload
      audiobook: BookRequestPairHalfPayload
    },
  ): Promise<BookRequestPairSubmitResult | null> {
    const title = work.title.trim()
    if (!title) return null

    const payload: CreateBookRequestPairPayload = {
      title,
      authors: work.author?.trim() ? [work.author.trim()] : [],
      language: extra.language ?? null,
      note: extra.note ?? null,
      ...(extra.selfServe ? { selfServe: true } : {}),
      ebook: halfPayload(extra.ebook),
      audiobook: halfPayload(extra.audiobook),
    }

    return post<BookRequestPairSubmitResult>('/api/v1/book-requests/pairs', payload, FREE_TEXT_KEY)
  }

  return {
    availability,
    lastFailure,
    submitting,
    mediaKind,
    pairMode,
    annotate,
    getAvailability,
    submit,
    submitPair,
    submitFreeText,
    submitPairFreeText,
    checkFreeText,
    candidateKey,
    candidateTitle,
  }
}

/** Null where a half names nothing, which the server reads the same as leaving the field out. */
function halfPayload(half: BookRequestPairHalfPayload): BookRequestPairHalfPayload {
  return {
    targetLibraryId: half.targetLibraryId ?? null,
    targetFolderId: half.targetFolderId ?? null,
    preferredFormats: half.preferredFormats ?? [],
    coverUrl: normalizeCoverUrl(half.coverUrl),
  }
}

function normalizeCoverUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' ? value : null
  } catch {
    return null
  }
}
