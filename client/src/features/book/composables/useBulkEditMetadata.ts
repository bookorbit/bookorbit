import { ref, computed } from 'vue'
import { i18n } from '@/i18n'
import { api } from '@/lib/api'
import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import type { BookCard, SortSpec, GroupRule } from '@bookorbit/types'
import type { EditableSeriesMembership } from './useMetadataEditor'

export type ArrayMode = 'add' | 'remove' | 'replace'

export type BulkEditArrayField = {
  mode: ArrayMode
  values: string[]
}

export type BulkEditScalarStringField = {
  value: string | null
}

export type BulkEditScalarNumberField = {
  value: number | null
}

export type BulkEditFields = {
  authors?: BulkEditArrayField
  genres?: BulkEditArrayField
  tags?: BulkEditArrayField
  narrators?: BulkEditArrayField
  seriesName?: BulkEditScalarStringField
  seriesMemberships?: EditableSeriesMembership[]
  publisher?: BulkEditScalarStringField
  editionName?: BulkEditScalarStringField
  language?: BulkEditScalarStringField
  publishedYear?: BulkEditScalarNumberField
  originalPublishedYear?: BulkEditScalarNumberField
}

type FieldResult = { updated: number; skippedLocked: number }

export type BulkEditResult = {
  updatedBooks: number
  fields: Record<string, FieldResult>
}

type QueryPayload = {
  query: {
    libraryId?: number
    filter?: GroupRule
    q?: string
    sort?: SortSpec[]
  }
}

type IdsPayload = { bookIds: number[] }

type SelectionPayload = QueryPayload | IdsPayload

export function useBulkEditMetadata(
  selectedIds: Ref<Set<number>>,
  books?: Ref<BookCard[]>,
  querySelection?: Ref<{ libraryId?: number; filter?: GroupRule; q?: string; sort?: SortSpec[]; total: number } | null>,
) {
  const submitting = ref(false)

  function getSelectionPayload(): SelectionPayload {
    if (querySelection?.value) {
      const { libraryId, filter, q, sort } = querySelection.value
      return { query: { libraryId, filter, q, sort } }
    }
    return { bookIds: [...selectedIds.value] }
  }

  const selectedCount = computed(() => {
    if (querySelection?.value) return querySelection.value.total
    return selectedIds.value.size
  })

  async function submit(fields: BulkEditFields): Promise<BulkEditResult | null> {
    submitting.value = true
    try {
      const res = await api('/api/v1/books/bulk-edit-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...getSelectionPayload(), fields }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const message = body?.message ?? i18n.global.t('book.bulkEdit.saveFailed')
        toast.error(Array.isArray(message) ? message[0] : message)
        return null
      }

      const result: BulkEditResult = await res.json()

      const totalUpdated = result.updatedBooks
      const totalSkipped = Object.values(result.fields).reduce((sum, f) => sum + f.skippedLocked, 0)

      if (totalUpdated === 0 && totalSkipped > 0) {
        toast.warning(i18n.global.t('book.bulkEdit.allLocked'))
      } else if (totalSkipped > 0) {
        toast.success(i18n.global.t('book.bulkEdit.savedSomeLocked', { count: totalUpdated }))
      } else {
        toast.success(i18n.global.t('book.bulkEdit.saved', { count: totalUpdated }))
      }

      const needsReload = hasAddOrRemoveMode(fields) || !!querySelection?.value
      if (!needsReload && books) {
        applyOptimisticUpdates(fields, [...selectedIds.value], books)
      }

      return result
    } catch {
      toast.error(i18n.global.t('book.bulkEdit.saveError'))
      return null
    } finally {
      submitting.value = false
    }
  }

  return { submit, submitting, selectedCount }
}

function hasAddOrRemoveMode(fields: BulkEditFields): boolean {
  const arrayFields = [fields.authors, fields.genres, fields.tags, fields.narrators]
  return arrayFields.some((f) => f && f.mode !== 'replace')
}

function applyOptimisticUpdates(fields: BulkEditFields, ids: number[], books: Ref<BookCard[]>) {
  const idSet = new Set(ids)
  books.value = books.value.map((book) => {
    if (!idSet.has(book.id)) return book
    const updated = { ...book }

    if (fields.seriesName !== undefined) {
      updated.seriesName = fields.seriesName.value
      updated.seriesIndex = null
    }
    if (fields.seriesMemberships !== undefined) {
      const primary = fields.seriesMemberships[0]
      updated.seriesName = primary?.seriesName ?? null
      updated.seriesIndex = primary?.seriesIndex ?? null
    }
    if (fields.publisher !== undefined) {
      updated.publisher = fields.publisher.value
    }
    if (fields.language !== undefined) {
      updated.language = fields.language.value
    }
    if (fields.publishedYear !== undefined) {
      updated.publishedDate = null
      updated.publishedYear = fields.publishedYear.value
    }
    if (fields.authors?.mode === 'replace') {
      updated.authors = fields.authors.values
    }
    if (fields.genres?.mode === 'replace') {
      updated.genres = fields.genres.values
    }
    if (fields.tags?.mode === 'replace') {
      updated.tags = fields.tags.values
    }
    if (fields.narrators?.mode === 'replace') {
      updated.narrators = fields.narrators.values
    }

    return updated
  })
}
