import { computed, reactive } from 'vue'
import type { MetadataCandidate, MetadataProviderKey, MetadataSource } from '@projectx/types'

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
  | 'genres'
  | 'coverUrl'
  | 'providerId'
  | 'sourceUrl'

export interface DiffField {
  key: DiffFieldKey
  label: string
  bookValue: string
  currentDisplay: string
  candidateDisplay: string
  hasDiff: boolean
  isCopied: boolean
  isCover: boolean
  isCopyable: boolean
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
  genres?: string[]
  googleBooksId?: string | null
  goodreadsId?: string | null
  amazonId?: string | null
  hardcoverId?: string | null
  openLibraryId?: string | null
  itunesId?: string | null
}

const FIELD_DEFS: { key: DiffFieldKey; label: string }[] = [
  { key: 'coverUrl', label: 'Cover' },
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
  { key: 'genres', label: 'Genres' },
]

type ProviderIdPatchField = 'googleBooksId' | 'goodreadsId' | 'amazonId' | 'hardcoverId' | 'openLibraryId' | 'itunesId'

const PROVIDER_ID_FIELD: Record<MetadataProviderKey, ProviderIdPatchField | undefined> = {
  google: 'googleBooksId',
  goodreads: 'goodreadsId',
  amazon: 'amazonId',
  hardcover: 'hardcoverId',
  openLibrary: 'openLibraryId',
  itunes: 'itunesId',
}

const PROVIDER_ID_LABEL: Record<MetadataProviderKey, string> = {
  google: 'Google Books ID',
  goodreads: 'Goodreads ID',
  amazon: 'Amazon ID',
  hardcover: 'Hardcover ID',
  openLibrary: 'Open Library ID',
  itunes: 'iTunes ID',
}

export function useMetadataDiff(current: MetadataSource, candidate: MetadataCandidate, currentCoverUrl?: string, currentProviderId?: string | null) {
  const copiedFields = reactive(new Set<DiffFieldKey>())

  function getBookValue(key: DiffFieldKey): string {
    if (key === 'authors') return current.authors.join(', ')
    if (key === 'genres') return current.genres.join(', ')
    if (key === 'coverUrl') return currentCoverUrl ?? ''
    const val = current[key as keyof MetadataSource]
    return val != null ? String(val) : ''
  }

  function getCandidateValue(key: DiffFieldKey): string {
    if (key === 'coverUrl') return candidate.coverUrl ?? ''
    if (key === 'authors') return (candidate.authors ?? []).join(', ')
    if (key === 'genres') return (candidate.genres ?? []).join(', ')
    const val = candidate[key as keyof MetadataCandidate]
    return val != null ? String(val) : ''
  }

  const fields = computed<DiffField[]>(
    () =>
      [
        ...FIELD_DEFS.flatMap((def) => {
          const candidateVal = getCandidateValue(def.key)
          const bookVal = getBookValue(def.key)
          if (def.key === 'coverUrl') {
            if (!candidateVal && !bookVal) return []
          } else {
            if (!candidateVal) return []
          }
          const isCopied = copiedFields.has(def.key)
          return [
            {
              key: def.key,
              label: def.label,
              bookValue: bookVal,
              currentDisplay: isCopied ? candidateVal : bookVal,
              candidateDisplay: candidateVal,
              hasDiff: bookVal !== candidateVal,
              isCopied,
              isCover: def.key === 'coverUrl',
              isCopyable: true,
            },
          ]
        }),
        ...(candidate.providerId || currentProviderId
          ? [
              (() => {
                const providerIsCopied = copiedFields.has('providerId')
                const candidateProviderId = candidate.providerId ?? ''
                const existingProviderId = currentProviderId ?? ''
                return {
                  key: 'providerId' as const,
                  label: PROVIDER_ID_LABEL[candidate.provider] ?? 'Provider ID',
                  bookValue: existingProviderId,
                  currentDisplay: providerIsCopied ? candidateProviderId : existingProviderId,
                  candidateDisplay: candidateProviderId,
                  hasDiff: existingProviderId !== candidateProviderId,
                  isCopied: providerIsCopied,
                  isCover: false,
                  isCopyable: true,
                }
              })(),
            ]
          : []),
        ...(candidate.sourceUrl
          ? [
              {
                key: 'sourceUrl' as const,
                label: 'Source URL',
                bookValue: '',
                currentDisplay: '',
                candidateDisplay: candidate.sourceUrl,
                hasDiff: true,
                isCopied: false,
                isCover: false,
                isCopyable: false,
              },
            ]
          : []),
      ] as DiffField[],
  )

  function toggleField(key: DiffFieldKey) {
    if (copiedFields.has(key)) copiedFields.delete(key)
    else copiedFields.add(key)
  }

  function copyAll() {
    for (const f of fields.value) {
      if (f.isCopyable) copiedFields.add(f.key)
    }
  }

  function copyMissing() {
    for (const f of fields.value) {
      if (f.isCopyable && !f.bookValue) copiedFields.add(f.key)
    }
  }

  function buildPatch(): { formPatch: MetadataPatch; coverUrl?: string } {
    const formPatch: MetadataPatch = {}
    let coverUrl: string | undefined

    for (const key of copiedFields) {
      if (key === 'coverUrl') {
        coverUrl = candidate.coverUrl
        continue
      }
      if (key === 'authors') {
        formPatch.authors = candidate.authors ?? []
        continue
      }
      if (key === 'genres') {
        formPatch.genres = candidate.genres ?? []
        continue
      }
      if (key === 'publishedYear') {
        formPatch.publishedYear = candidate.publishedYear ?? null
        continue
      }
      if (key === 'pageCount') {
        formPatch.pageCount = candidate.pageCount ?? null
        continue
      }
      if (key === 'seriesIndex') {
        formPatch.seriesIndex = candidate.seriesIndex ?? null
        continue
      }
      if (key === 'providerId') {
        const idField = PROVIDER_ID_FIELD[candidate.provider]
        if (idField) formPatch[idField] = candidate.providerId
        continue
      }
      if (key === 'sourceUrl') continue
      const val = candidate[key as keyof MetadataCandidate]
      ;(formPatch as Record<string, unknown>)[key] = val != null ? String(val) : null
    }

    if (copiedFields.size > 0) {
      const idField = PROVIDER_ID_FIELD[candidate.provider]
      if (idField) formPatch[idField] = candidate.providerId
    }

    return { formPatch, coverUrl }
  }

  const hasCopied = computed(() => copiedFields.size > 0)

  return { fields, copiedFields, toggleField, copyAll, copyMissing, buildPatch, hasCopied }
}
