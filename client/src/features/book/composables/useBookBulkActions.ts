import type { Ref } from 'vue'
import {
  BOOK_METADATA_LOCK_FIELDS,
  type AudioCoverEmbedProgressEvent,
  type BookSelectionPayload,
  type BookSelectionQuery,
  type BookCard,
  type BookDetail,
  type BookMetadataLockField,
  type ReadStatus,
  type UserBookStatus,
} from '@bookorbit/types'
import { i18n } from '@/i18n'
import { formatNumber } from '@/i18n/formatters'
import { api } from '@/lib/api'
import { toast } from 'vue-sonner'
import { useLibraryCountsRefresh } from '@/features/library/composables/useLibraryCountsRefresh'
import { useCoverVersions } from './useCoverVersions'
import { useRefreshingBooks } from './useRefreshingBooks'
import { useBookDownload } from './useBookDownload'
import { useBookRefreshFeedback } from './useBookRefreshFeedback'
import { detectChangedColumns, mergeBookCardWithDetail } from '@/features/book/lib/book-card-mapper'
import { withIgnoreCache, type IgnoreCacheOptions } from '@/features/metadata-cache/lib/metadata-cache'
import type { BulkReadingStatePatch } from './useBookStatus'
import { useBulkRunTracker, type BulkRunFollowResult } from '@/features/jobs/composables/useBulkRunTracker'
import { bulkRunRefusalText } from '@/features/jobs/lib/bulk-runs'

const { t } = i18n.global

export type ExportScope = 'primary' | 'all' | 'audio'

export const BULK_EDITABLE_ARRAY_FIELDS = ['authors', 'genres', 'tags', 'narrators'] as const
export const BULK_EDITABLE_SCALAR_FIELDS = ['seriesName', 'publisher', 'language', 'publishedYear'] as const

export type BulkEditableArrayField = (typeof BULK_EDITABLE_ARRAY_FIELDS)[number]
export type BulkEditableScalarField = (typeof BULK_EDITABLE_SCALAR_FIELDS)[number]
export type BulkEditableField = BulkEditableArrayField | BulkEditableScalarField
export type BulkEditableValue = string | number | string[] | null

export const BULK_EDITABLE_FIELD_LABELS: Record<BulkEditableField, string> = {
  seriesName: 'Series',
  publisher: 'Publisher',
  language: 'Language',
  publishedYear: 'Year',
  authors: 'Authors',
  genres: 'Genres',
  tags: 'Tags',
  narrators: 'Narrators',
}

export const BULK_EDITABLE_FIELD_OPTIONS: { value: BulkEditableField; label: string }[] = [
  ...BULK_EDITABLE_SCALAR_FIELDS,
  ...BULK_EDITABLE_ARRAY_FIELDS,
].map((value) => ({ value, label: BULK_EDITABLE_FIELD_LABELS[value] }))
const BULK_FIELD_LOCK_FIELD: Record<BulkEditableField, BookMetadataLockField> = {
  seriesName: 'seriesName',
  publisher: 'publisher',
  language: 'language',
  publishedYear: 'publishedYear',
  authors: 'authors',
  genres: 'genres',
  tags: 'tags',
  narrators: 'narrators',
}

/** What the metadata refresh stream sends: one event per book, then the summary. */
type RefreshMetadataEvent = {
  bookId?: number
  success?: boolean
  detail?: BookDetail
  error?: string
  done?: boolean
  processed?: number
  failed?: number
}

/** What the cover re-extract stream sends: one event per book it tried, then the summary. */
type ReExtractCoverEvent = { bookId?: number; done?: boolean; processed?: number; updated?: number }

export type QuerySelectionState = BookSelectionQuery & {
  total: number
  /** Matching books counting every edition, when the listing folds them (`collapseLinked`). */
  editionTotal?: number
}

function buildLocalReadStatus(patch: BulkReadingStatePatch, existing: UserBookStatus | null, nowIso: string): UserBookStatus {
  const clearsLifecycle = patch.status === 'unread' || patch.status === 'want_to_read'
  const hasStartedAt = Object.prototype.hasOwnProperty.call(patch, 'startedAt')
  const hasFinishedAt = Object.prototype.hasOwnProperty.call(patch, 'finishedAt')
  return {
    status: patch.status,
    source: 'manual',
    startedAt: clearsLifecycle ? null : hasStartedAt ? (patch.startedAt ?? null) : (existing?.startedAt ?? null),
    finishedAt: clearsLifecycle ? null : hasFinishedAt ? (patch.finishedAt ?? null) : (existing?.finishedAt ?? null),
    updatedAt: nowIso,
  }
}

export function useBookBulkActions(
  selectedIds: Ref<Set<number>>,
  onDeleted: (ids: number[]) => void,
  books?: Ref<BookCard[]>,
  onBulkRefreshCompleted?: () => void | Promise<void>,
  querySelection?: Ref<QuerySelectionState | null>,
) {
  const { bumpVersion } = useCoverVersions()
  const { markRefreshing, clearRefreshing } = useRefreshingBooks()
  const refreshFeedback = useBookRefreshFeedback()
  const { exportBooks } = useBookDownload()
  const refreshLibraryCounts = useLibraryCountsRefresh()

  const tracker = useBulkRunTracker()
  const inFlight = tracker.inFlight

  function getSelectionPayload(): BookSelectionPayload {
    if (querySelection?.value) {
      const { libraryId, filter, q, sort, collapseLinked } = querySelection.value
      return { query: { libraryId, filter, q, sort, ...(collapseLinked ? { collapseLinked: true } : {}) } }
    }
    return { bookIds: [...selectedIds.value] }
  }

  /** Every edition behind the selection: query selections stop folding, explicit ones add each card's other editions. */
  function getAllEditionsPayload(canDelete: (libraryId: number) => boolean): BookSelectionPayload {
    if (querySelection?.value) {
      const { libraryId, filter, q, sort } = querySelection.value
      return { query: { libraryId, filter, q, sort } }
    }
    const ids = new Set(selectedIds.value)
    for (const book of books?.value ?? []) {
      if (!selectedIds.value.has(book.id)) continue
      for (const other of book.linked?.books ?? []) if (canDelete(other.libraryId)) ids.add(other.bookId)
    }
    return { bookIds: [...ids] }
  }

  function hasSelection(): boolean {
    if (querySelection?.value) return querySelection.value.total > 0
    return selectedIds.value.size > 0
  }

  function updateSelectedBooks(ids: number[], updater: (book: BookCard) => BookCard) {
    if (!books) return
    const selected = new Set(ids)
    books.value = books.value.map((book) => (selected.has(book.id) ? updater(book) : book))
  }

  /** Bound straight to the action bar's `refresh-metadata` event, so its payload arrives here as `options`. */
  async function handleBulkRefreshMetadata(options?: IgnoreCacheOptions) {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const total = querySelection?.value ? querySelection.value.total : ids.length
    markRefreshing(ids)
    refreshFeedback.markRefreshingMany(ids)
    const run = tracker.begin('book-refresh-metadata', total)
    let processed = 0
    let failed = 0
    let outcome: BulkRunFollowResult | null = null
    try {
      const res = await api('/api/v1/books/bulk-refresh-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withIgnoreCache(getSelectionPayload(), { ignoreCache: options?.ignoreCache === true })),
        signal: run.signal,
      })
      if (!res.ok || !res.body) {
        refreshFeedback.markFailedMany(ids, 'Metadata refresh failed')
        toast.error(bulkRunRefusalText(res, t('book.bulkRefresh.failed')))
        return
      }
      outcome = await run.follow<RefreshMetadataEvent>(res, (data) => {
        if (data.bookId !== undefined) {
          const bookId = data.bookId
          const succeeded = data.success !== false
          let changedColumns: ReturnType<typeof detectChangedColumns> = []

          if (succeeded && books && data.detail) {
            const index = books.value.findIndex((book) => book.id === bookId)
            const previous = index !== -1 ? books.value[index] : undefined
            if (previous) {
              const merged = mergeBookCardWithDetail(previous, data.detail)
              changedColumns = detectChangedColumns(previous, merged)
              books.value = books.value.map((book, i) => (i === index ? merged : book))
            }
          }

          if (succeeded) refreshFeedback.markSuccess(bookId, changedColumns)
          else refreshFeedback.markFailed(bookId, data.error || 'Metadata refresh failed')

          bumpVersion(bookId)
          clearRefreshing([bookId])
          run.advance(!succeeded)
        }
        if (!data.done) return false
        processed = typeof data.processed === 'number' ? data.processed : processed
        failed = typeof data.failed === 'number' ? data.failed : failed
        return true
      })
    } catch {
      if (!run.signal.aborted) toast.error(t('book.bulkRefresh.failed'))
    } finally {
      // A run that goes on without this page is not a failure; only one that stopped short is.
      const stoppedShort = outcome === null || outcome.end === 'done' || outcome.end === 'stopped'
      for (const id of ids) {
        if (refreshFeedback.getFeedback(id)?.state !== 'refreshing') continue
        if (stoppedShort) {
          refreshFeedback.markFailed(id, 'Metadata refresh interrupted')
          bumpVersion(id)
        } else {
          refreshFeedback.clearFeedback(id)
        }
      }
      clearRefreshing(ids)
      run.end()
    }
    if (!outcome || (outcome.end !== 'done' && outcome.end !== 'stopped')) return
    if (onBulkRefreshCompleted) {
      try {
        await onBulkRefreshCompleted()
      } catch {
        // Ignore refresh-list failure and still surface the bulk action outcome.
      }
    }
    if (outcome.end !== 'done') return
    if (outcome.cancelled) reportCancelled(outcome)
    else if (failed > 0) toast.warning(t('book.bulkRefresh.completedWithFailures', { processed, failed: formatNumber(failed) }))
    else toast.success(t('book.bulkRefresh.completed', { processed }))
  }

  async function handleBulkReExtractCover() {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const total = querySelection?.value ? querySelection.value.total : ids.length
    markRefreshing(ids)
    const run = tracker.begin('book-re-extract-cover', total)
    let processed = 0
    let updated = 0
    let outcome: BulkRunFollowResult | null = null
    const bumpedIds = new Set<number>()
    try {
      const res = await api('/api/v1/books/bulk-re-extract-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getSelectionPayload()),
        signal: run.signal,
      })
      if (!res.ok || !res.body) {
        toast.error(bulkRunRefusalText(res, t('book.coverRegeneration.bulkFailed')))
        return
      }
      outcome = await run.follow<ReExtractCoverEvent>(res, (data) => {
        if (data.bookId !== undefined) {
          bumpedIds.add(data.bookId)
          bumpVersion(data.bookId)
          clearRefreshing([data.bookId])
          run.advance()
        }
        if (!data.done) return false
        processed = data.processed ?? processed
        updated = data.updated ?? updated
        return true
      })
    } catch {
      if (!run.signal.aborted) toast.error(t('book.coverRegeneration.bulkFailed'))
    } finally {
      for (const id of ids) {
        if (!bumpedIds.has(id)) bumpVersion(id)
      }
      clearRefreshing(ids)
      run.end()
    }
    if (outcome?.end !== 'done') return
    if (outcome.cancelled) reportCancelled(outcome)
    else toast.success(t('book.coverRegeneration.bulkCompleted', { updated: formatNumber(updated), processed }))
  }

  async function handleBulkEmbedAudioCover() {
    if (!hasSelection()) return
    const run = tracker.begin('book-embed-audio-cover', querySelection?.value ? querySelection.value.total : selectedIds.value.size)
    // Assigned from the stream callback, so a plain `= null` initializer would narrow it to `null`.
    let summary = null as Extract<AudioCoverEmbedProgressEvent, { done: true }> | null
    let outcome: BulkRunFollowResult
    try {
      const res = await api('/api/v1/books/bulk-embed-audio-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getSelectionPayload()),
        signal: run.signal,
      })
      if (!res.ok || !res.body) {
        toast.error(bulkRunRefusalText(res, t('book.audioCoverEmbed.bulkFailed')))
        return
      }
      outcome = await run.follow<AudioCoverEmbedProgressEvent>(res, (event) => {
        if ('done' in event) {
          summary = event
          return true
        }
        if ('started' in event) run.started(event.total)
        else run.advance(event.status === 'failed')
        return false
      })
    } catch {
      if (!run.signal.aborted) toast.error(t('book.audioCoverEmbed.bulkFailed'))
      return
    } finally {
      run.end()
    }
    if (outcome.end !== 'done' || !summary) return
    if (outcome.cancelled) {
      reportCancelled(outcome)
      return
    }
    const { succeeded, failed, processed } = summary
    const values = { embedded: formatNumber(succeeded), processed, failed: formatNumber(failed) }
    if (failed > 0) toast.warning(t('book.audioCoverEmbed.bulkCompletedWithFailures', values))
    else toast.success(t('book.audioCoverEmbed.bulkCompleted', values))
  }

  /** A run this page cancelled ends with how far it got, not the kind's usual summary. */
  function reportCancelled(outcome: BulkRunFollowResult) {
    toast.info(t('jobsArea.bulk.cancelled', { processed: formatNumber(outcome.processed), total: formatNumber(outcome.total) }))
  }

  async function handleDownloadFiles(scope: ExportScope) {
    const ids = [...selectedIds.value]
    await exportBooks(ids, scope === 'all', scope === 'audio' ? 'audio' : undefined)
  }

  async function handleBulkSetStatus(input: ReadStatus | BulkReadingStatePatch) {
    if (!hasSelection()) return
    const patch: BulkReadingStatePatch = typeof input === 'string' ? { status: input } : input
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const res = await api('/api/v1/books/bulk-set-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getSelectionPayload(), ...patch }),
    })
    if (!res.ok) {
      toast.error(i18n.global.t('book.bulkReadingState.failed'))
      return
    }
    const nowIso = new Date().toISOString()
    updateSelectedBooks(ids, (book) => ({
      ...book,
      readStatus: buildLocalReadStatus(patch, book.readStatus, nowIso),
    }))
    const count = querySelection?.value ? querySelection.value.total : ids.length
    toast.success(i18n.global.t('book.bulkReadingState.updated', { count }))
  }

  async function handleBulkSetRating(rating: number | null) {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const res = await api('/api/v1/books/bulk-set-rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getSelectionPayload(), rating }),
    })
    if (!res.ok) {
      toast.error(t('book.bulkActions.ratingFailed'))
      return
    }
    const editableIds = books
      ? ids.filter((id) => {
          const book = books.value.find((entry) => entry.id === id)
          return book ? !book.lockedFields.includes('rating') : true
        })
      : ids
    const skippedCount = ids.length - editableIds.length
    updateSelectedBooks(editableIds, (book) => ({
      ...book,
      rating,
    }))
    const count = querySelection?.value ? querySelection.value.total : editableIds.length
    if (rating === null) {
      toast.success(
        skippedCount > 0
          ? t('book.bulkActions.ratingClearedSkipped', { count, skipped: skippedCount })
          : t('book.bulkActions.ratingCleared', { count }),
      )
      return
    }
    const ratingLabel = formatNumber(rating)
    toast.success(
      skippedCount > 0
        ? t('book.bulkActions.ratedSkipped', { count, rating: ratingLabel, skipped: skippedCount })
        : t('book.bulkActions.rated', { count, rating: ratingLabel }),
    )
  }

  async function handleBulkSetField(field: BulkEditableField, value: BulkEditableValue) {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const lockField = BULK_FIELD_LOCK_FIELD[field]
    const toStringList = (raw: BulkEditableValue): string[] => {
      if (Array.isArray(raw)) return raw
      if (raw === null) return []
      const trimmed = String(raw).trim()
      return trimmed.length > 0 ? [trimmed] : []
    }
    const res = await api('/api/v1/books/bulk-set-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getSelectionPayload(), field, value }),
    })
    if (!res.ok) {
      toast.error(t('book.bulkActions.updateFailed'))
      return
    }
    const editableIds = books
      ? ids.filter((id) => {
          const book = books.value.find((entry) => entry.id === id)
          return book ? !book.lockedFields.includes(lockField) : true
        })
      : ids
    const skippedCount = ids.length - editableIds.length
    updateSelectedBooks(editableIds, (book) => {
      switch (field) {
        case 'seriesName':
          return { ...book, seriesName: typeof value === 'string' ? value : value === null ? null : String(value) }
        case 'publisher':
          return { ...book, publisher: typeof value === 'string' ? value : value === null ? null : String(value) }
        case 'language':
          return { ...book, language: typeof value === 'string' ? value : value === null ? null : String(value) }
        case 'publishedYear':
          return {
            ...book,
            publishedDate: null,
            publishedYear: typeof value === 'number' ? value : value === null ? null : Number.isFinite(Number(value)) ? Number(value) : null,
          }
        case 'authors':
          return { ...book, authors: toStringList(value) }
        case 'genres':
          return { ...book, genres: toStringList(value) }
        case 'narrators':
          return { ...book, narrators: toStringList(value) }
        case 'tags':
          return book
      }
    })
    const count = querySelection?.value ? querySelection.value.total : editableIds.length
    toast.success(
      skippedCount > 0 ? t('book.bulkActions.updatedSkipped', { count, skipped: skippedCount }) : t('book.bulkActions.updated', { count }),
    )
  }

  async function handleBulkSetMetadataLock(locked: boolean) {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const res = await api('/api/v1/books/bulk-set-metadata-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getSelectionPayload(), locked }),
    })
    if (!res.ok) {
      toast.error(t(locked ? 'book.bulkActions.lockFailed' : 'book.bulkActions.unlockFailed'))
      return
    }
    updateSelectedBooks(ids, (book) => ({
      ...book,
      hasMetadataLocks: locked,
      lockedFields: locked ? [...BOOK_METADATA_LOCK_FIELDS] : [],
    }))
    const count = querySelection?.value ? querySelection.value.total : ids.length
    toast.success(t(locked ? 'book.bulkActions.locked' : 'book.bulkActions.unlocked', { count }))
  }

  async function handleDeleteSelected(includeOtherEditions = false, canDelete: (libraryId: number) => boolean = () => true) {
    if (!hasSelection()) return
    const payload = includeOtherEditions ? getAllEditionsPayload(canDelete) : getSelectionPayload()
    const ids = payload.bookIds ?? []
    const count = querySelection?.value
      ? includeOtherEditions
        ? (querySelection.value.editionTotal ?? querySelection.value.total)
        : querySelection.value.total
      : ids.length
    const res = await api('/api/v1/books', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      toast.error(t('book.bulkActions.deleteFailed'))
      return
    }
    onDeleted(ids)
    refreshLibraryCounts()
    toast.success(t('book.bulkActions.deleted', { count }))
  }

  return {
    inFlight,
    cancelInFlight: tracker.cancel,
    hideInFlight: tracker.detach,
    handleBulkRefreshMetadata,
    handleBulkReExtractCover,
    handleBulkEmbedAudioCover,
    handleDownloadFiles,
    handleBulkSetStatus,
    handleBulkSetRating,
    handleBulkSetField,
    handleBulkSetMetadataLock,
    handleDeleteSelected,
    getSelectionPayload,
  }
}
