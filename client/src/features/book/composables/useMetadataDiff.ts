import { computed, reactive } from 'vue'
import type { ComicMetadataFields, MetadataCandidate, MetadataProviderKey, MetadataSource } from '@projectx/types'

type ComicDiffFieldKey =
  | 'comicIssueNumber'
  | 'comicVolumeName'
  | 'comicPencillers'
  | 'comicInkers'
  | 'comicColorists'
  | 'comicLetterers'
  | 'comicCoverArtists'
  | 'comicCharacters'
  | 'comicTeams'
  | 'comicLocations'
  | 'comicStoryArcs'

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
  | 'narrators'
  | 'durationSeconds'
  | 'abridged'
  | 'coverUrl'
  | 'providerId'
  | 'sourceUrl'
  | ComicDiffFieldKey

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
  narrators?: string[]
  durationSeconds?: number | null
  abridged?: boolean
  googleBooksId?: string | null
  goodreadsId?: string | null
  amazonId?: string | null
  hardcoverId?: string | null
  openLibraryId?: string | null
  itunesId?: string | null
  audibleId?: string | null
  comicvineId?: string | null
  comicMetadata?: ComicMetadataFields
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
  { key: 'narrators', label: 'Narrators' },
  { key: 'durationSeconds', label: 'Duration (seconds)' },
  { key: 'abridged', label: 'Abridged' },
]

interface ComicFieldDef {
  key: ComicDiffFieldKey
  label: string
  comicKey: keyof ComicMetadataFields
}

const COMIC_FIELD_DEFS: ComicFieldDef[] = [
  { key: 'comicIssueNumber', label: 'Issue Number', comicKey: 'issueNumber' },
  { key: 'comicVolumeName', label: 'Volume', comicKey: 'volumeName' },
  { key: 'comicPencillers', label: 'Pencillers', comicKey: 'pencillers' },
  { key: 'comicInkers', label: 'Inkers', comicKey: 'inkers' },
  { key: 'comicColorists', label: 'Colorists', comicKey: 'colorists' },
  { key: 'comicLetterers', label: 'Letterers', comicKey: 'letterers' },
  { key: 'comicCoverArtists', label: 'Cover Artists', comicKey: 'coverArtists' },
  { key: 'comicCharacters', label: 'Characters', comicKey: 'characters' },
  { key: 'comicTeams', label: 'Teams', comicKey: 'teams' },
  { key: 'comicLocations', label: 'Locations', comicKey: 'locations' },
  { key: 'comicStoryArcs', label: 'Story Arcs', comicKey: 'storyArcs' },
]

const COMIC_KEY_MAP: Record<ComicDiffFieldKey, keyof ComicMetadataFields> = Object.fromEntries(
  COMIC_FIELD_DEFS.map((d) => [d.key, d.comicKey]),
) as Record<ComicDiffFieldKey, keyof ComicMetadataFields>

function isComicDiffFieldKey(key: DiffFieldKey): key is ComicDiffFieldKey {
  return key in COMIC_KEY_MAP
}

type ProviderIdPatchField = 'googleBooksId' | 'goodreadsId' | 'amazonId' | 'hardcoverId' | 'openLibraryId' | 'itunesId' | 'audibleId' | 'comicvineId'

const PROVIDER_ID_FIELD: Record<MetadataProviderKey, ProviderIdPatchField | undefined> = {
  google: 'googleBooksId',
  goodreads: 'goodreadsId',
  amazon: 'amazonId',
  hardcover: 'hardcoverId',
  openLibrary: 'openLibraryId',
  itunes: 'itunesId',
  audible: 'audibleId',
  audnexus: undefined,
  comicvine: 'comicvineId',
}

const PROVIDER_ID_LABEL: Record<MetadataProviderKey, string> = {
  google: 'Google Books ID',
  goodreads: 'Goodreads ID',
  amazon: 'Amazon ID',
  hardcover: 'Hardcover ID',
  openLibrary: 'Open Library ID',
  itunes: 'iTunes ID',
  audible: 'Audible ID',
  audnexus: 'AudNexus ID',
  comicvine: 'ComicVine ID',
}

export function useMetadataDiff(current: MetadataSource, candidate: MetadataCandidate, currentCoverUrl?: string, currentProviderId?: string | null) {
  const copiedFields = reactive(new Set<DiffFieldKey>())

  function getBookValue(key: DiffFieldKey): string {
    if (isComicDiffFieldKey(key)) return ''
    if (key === 'authors') return current.authors.join(', ')
    if (key === 'genres') return current.genres.join(', ')
    if (key === 'narrators') return current.narrators?.join(', ') ?? ''
    if (key === 'coverUrl') return currentCoverUrl ?? ''
    const val = current[key as keyof MetadataSource]
    return val != null ? String(val) : ''
  }

  function getCandidateValue(key: DiffFieldKey): string {
    if (isComicDiffFieldKey(key)) {
      const comicKey = COMIC_KEY_MAP[key]
      const val = candidate.comicMetadata?.[comicKey]
      if (Array.isArray(val)) return val.join(', ')
      return val ?? ''
    }
    if (key === 'coverUrl') return candidate.coverUrl ?? ''
    if (key === 'authors') return (candidate.authors ?? []).join(', ')
    if (key === 'genres') return (candidate.genres ?? []).join(', ')
    if (key === 'narrators') return (candidate.narrators ?? []).join(', ')
    const val = candidate[key as keyof MetadataCandidate]
    return val != null ? String(val) : ''
  }

  function makeRow(key: DiffFieldKey, label: string): DiffField | null {
    const candidateVal = getCandidateValue(key)
    const bookVal = getBookValue(key)
    if (key === 'coverUrl') {
      if (!candidateVal && !bookVal) return null
    } else {
      if (!candidateVal) return null
    }
    const isCopied = copiedFields.has(key)
    return {
      key,
      label,
      bookValue: bookVal,
      currentDisplay: isCopied ? candidateVal : bookVal,
      candidateDisplay: candidateVal,
      hasDiff: bookVal !== candidateVal,
      isCopied,
      isCover: key === 'coverUrl',
      isCopyable: true,
    }
  }

  const fields = computed<DiffField[]>(() => {
    const rows: DiffField[] = []

    for (const def of FIELD_DEFS) {
      const row = makeRow(def.key, def.label)
      if (row) rows.push(row)
    }

    if (candidate.comicMetadata) {
      for (const def of COMIC_FIELD_DEFS) {
        const row = makeRow(def.key, def.label)
        if (row) rows.push(row)
      }
    }

    if (candidate.providerId || currentProviderId) {
      const providerIsCopied = copiedFields.has('providerId')
      const candidateProviderId = candidate.providerId ?? ''
      const existingProviderId = currentProviderId ?? ''
      rows.push({
        key: 'providerId',
        label: PROVIDER_ID_LABEL[candidate.provider] ?? 'Provider ID',
        bookValue: existingProviderId,
        currentDisplay: providerIsCopied ? candidateProviderId : existingProviderId,
        candidateDisplay: candidateProviderId,
        hasDiff: existingProviderId !== candidateProviderId,
        isCopied: providerIsCopied,
        isCover: false,
        isCopyable: true,
      })
    }

    if (candidate.sourceUrl) {
      rows.push({
        key: 'sourceUrl',
        label: 'Source URL',
        bookValue: '',
        currentDisplay: '',
        candidateDisplay: candidate.sourceUrl,
        hasDiff: true,
        isCopied: false,
        isCover: false,
        isCopyable: false,
      })
    }

    return rows
  })

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
    const comicPatch: Partial<ComicMetadataFields> = {}

    for (const key of copiedFields) {
      if (isComicDiffFieldKey(key)) {
        const comicKey = COMIC_KEY_MAP[key]
        ;(comicPatch as Record<string, unknown>)[comicKey] = candidate.comicMetadata?.[comicKey]
        continue
      }
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
      if (key === 'narrators') {
        formPatch.narrators = candidate.narrators ?? []
        continue
      }
      if (key === 'durationSeconds') {
        formPatch.durationSeconds = candidate.durationSeconds ?? null
        continue
      }
      if (key === 'abridged') {
        formPatch.abridged = candidate.abridged ?? false
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

    if (Object.keys(comicPatch).length > 0) {
      formPatch.comicMetadata = comicPatch as ComicMetadataFields
    }

    return { formPatch, coverUrl }
  }

  const hasCopied = computed(() => copiedFields.size > 0)

  return { fields, copiedFields, toggleField, copyAll, copyMissing, buildPatch, hasCopied }
}
