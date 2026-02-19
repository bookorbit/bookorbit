import { computed, reactive } from 'vue'
import type { BookDetail, MetadataCandidate } from '@projectx/types'

export type DiffFieldKey =
  | 'title'
  | 'subtitle'
  | 'authors'
  | 'description'
  | 'publisher'
  | 'publishedYear'
  | 'language'
  | 'pageCount'
  | 'seriesName'
  | 'seriesIndex'
  | 'isbn13'
  | 'isbn10'
  | 'tags'
  | 'coverUrl'

export interface DiffField {
  key: DiffFieldKey
  label: string
  bookValue: string
  currentDisplay: string
  candidateDisplay: string
  hasDiff: boolean
  isCopied: boolean
  isCover: boolean
}

export interface MetadataPatch {
  title?: string | null
  subtitle?: string | null
  description?: string | null
  publisher?: string | null
  publishedYear?: number | null
  language?: string | null
  pageCount?: number | null
  seriesName?: string | null
  seriesIndex?: number | null
  isbn10?: string | null
  isbn13?: string | null
  authors?: string[]
  tags?: string[]
}

const FIELD_DEFS: { key: DiffFieldKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'subtitle', label: 'Subtitle' },
  { key: 'authors', label: 'Authors' },
  { key: 'description', label: 'Description' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'publishedYear', label: 'Published Year' },
  { key: 'language', label: 'Language' },
  { key: 'pageCount', label: 'Page Count' },
  { key: 'seriesName', label: 'Series' },
  { key: 'seriesIndex', label: 'Series Index' },
  { key: 'isbn13', label: 'ISBN-13' },
  { key: 'isbn10', label: 'ISBN-10' },
  { key: 'tags', label: 'Tags' },
  { key: 'coverUrl', label: 'Cover' },
]

export function useMetadataDiff(book: BookDetail, candidate: MetadataCandidate) {
  const copiedFields = reactive(new Set<DiffFieldKey>())

  function getBookValue(key: DiffFieldKey): string {
    if (key === 'authors') return book.authors.map((a) => a.name).join(', ')
    if (key === 'tags') return book.tags.join(', ')
    if (key === 'coverUrl') return ''
    const val = book[key as keyof BookDetail]
    return val != null ? String(val) : ''
  }

  function getCandidateValue(key: DiffFieldKey): string {
    if (key === 'coverUrl') return candidate.coverUrl ?? ''
    if (key === 'authors') return (candidate.authors ?? []).join(', ')
    if (key === 'tags') return (candidate.tags ?? []).join(', ')
    const val = candidate[key as keyof MetadataCandidate]
    return val != null ? String(val) : ''
  }

  const fields = computed<DiffField[]>(() =>
    FIELD_DEFS.flatMap((def) => {
      const candidateVal = getCandidateValue(def.key)
      if (!candidateVal) return []
      const bookVal = getBookValue(def.key)
      const isCopied = copiedFields.has(def.key)
      return [{
        key: def.key,
        label: def.label,
        bookValue: bookVal,
        currentDisplay: isCopied ? candidateVal : bookVal,
        candidateDisplay: candidateVal,
        hasDiff: bookVal !== candidateVal,
        isCopied,
        isCover: def.key === 'coverUrl',
      }]
    }),
  )

  function toggleField(key: DiffFieldKey) {
    if (copiedFields.has(key)) copiedFields.delete(key)
    else copiedFields.add(key)
  }

  function copyAll() {
    for (const f of fields.value) copiedFields.add(f.key)
  }

  function copyMissing() {
    for (const f of fields.value) {
      if (!f.bookValue) copiedFields.add(f.key)
    }
  }

  function buildPatch(): { formPatch: MetadataPatch; coverUrl?: string } {
    const formPatch: MetadataPatch = {}
    let coverUrl: string | undefined

    for (const key of copiedFields) {
      if (key === 'coverUrl') { coverUrl = candidate.coverUrl; continue }
      if (key === 'authors') { formPatch.authors = candidate.authors ?? []; continue }
      if (key === 'tags') { formPatch.tags = candidate.tags ?? []; continue }
      if (key === 'publishedYear') { formPatch.publishedYear = candidate.publishedYear ?? null; continue }
      if (key === 'pageCount') { formPatch.pageCount = candidate.pageCount ?? null; continue }
      if (key === 'seriesIndex') { formPatch.seriesIndex = candidate.seriesIndex ?? null; continue }
      const val = candidate[key as keyof MetadataCandidate]
      ;(formPatch as Record<string, unknown>)[key] = val != null ? String(val) : null
    }

    return { formPatch, coverUrl }
  }

  const hasCopied = computed(() => copiedFields.size > 0)

  return { fields, copiedFields, toggleField, copyAll, copyMissing, buildPatch, hasCopied }
}
