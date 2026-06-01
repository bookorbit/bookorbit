import { computed, reactive, toValue, type MaybeRefOrGetter } from 'vue'
import type {
  BookMetadataLockField,
  ComicMetadataFields,
  MetadataCandidate,
  MetadataProviderInfo,
  MetadataProviderKey,
  MetadataSource,
  ProviderIds,
} from '@bookorbit/types'
import { getProviderLabel, toDisplayCoverUrl } from '../lib/metadata-fetch'

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
  | ProviderIdPatchField
  | 'sourceUrl'
  | ComicDiffFieldKey

export interface ProviderFieldValue {
  provider: MetadataProviderKey
  label: string
  display: string
  isPicked: boolean
}

export interface DiffField {
  key: DiffFieldKey
  label: string
  bookValue: string
  currentDisplay: string
  candidateDisplay: string
  hasDiff: boolean
  isPicked: boolean
  pickedFromActive: boolean
  pickedProvider: MetadataProviderKey | null
  pickedDisplay: string
  isCover: boolean
  isLocked: boolean
  isCopyable: boolean
  providerValues: ProviderFieldValue[]
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
  ranobedbId?: string | null
  comicMetadata?: ComicMetadataFields
}

export const FIELD_DEFS: { key: DiffFieldKey; label: string }[] = [
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

export interface ComicFieldDef {
  key: ComicDiffFieldKey
  label: string
  comicKey: keyof ComicMetadataFields
}

export const COMIC_FIELD_DEFS: ComicFieldDef[] = [
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

export const COMIC_KEY_MAP: Record<ComicDiffFieldKey, keyof ComicMetadataFields> = Object.fromEntries(
  COMIC_FIELD_DEFS.map((d) => [d.key, d.comicKey]),
) as Record<ComicDiffFieldKey, keyof ComicMetadataFields>

export function isComicDiffFieldKey(key: DiffFieldKey): key is ComicDiffFieldKey {
  return key in COMIC_KEY_MAP
}

export type ProviderIdPatchField =
  | 'googleBooksId'
  | 'goodreadsId'
  | 'amazonId'
  | 'hardcoverId'
  | 'openLibraryId'
  | 'itunesId'
  | 'audibleId'
  | 'comicvineId'
  | 'ranobedbId'

export const PROVIDER_ID_FIELD: Record<MetadataProviderKey, ProviderIdPatchField | undefined> = {
  google: 'googleBooksId',
  goodreads: 'goodreadsId',
  amazon: 'amazonId',
  hardcover: 'hardcoverId',
  openLibrary: 'openLibraryId',
  itunes: 'itunesId',
  audible: 'audibleId',
  audnexus: undefined,
  comicvine: 'comicvineId',
  ranobedb: 'ranobedbId',
}

const PROVIDER_ID_PATCH_FIELDS = new Set<string>(Object.values(PROVIDER_ID_FIELD).filter((v): v is ProviderIdPatchField => v !== undefined))

export function isProviderIdPatchField(key: DiffFieldKey): key is ProviderIdPatchField {
  return PROVIDER_ID_PATCH_FIELDS.has(key)
}

export const PROVIDER_ID_LABEL: Record<MetadataProviderKey, string> = {
  google: 'Google Books ID',
  goodreads: 'Goodreads ID',
  amazon: 'Amazon ID',
  hardcover: 'Hardcover ID',
  openLibrary: 'Open Library ID',
  itunes: 'iTunes ID',
  audible: 'Audible ID',
  audnexus: 'AudNexus ID',
  comicvine: 'ComicVine ID',
  ranobedb: 'RanobeDB ID',
}

export function getCandidateValueFrom(candidate: MetadataCandidate, key: DiffFieldKey): string {
  if (isComicDiffFieldKey(key)) {
    const comicKey = COMIC_KEY_MAP[key]
    const val = candidate.comicMetadata?.[comicKey]
    if (Array.isArray(val)) return val.join(', ')
    return val ?? ''
  }
  if (key === 'coverUrl') return toDisplayCoverUrl(candidate.coverUrl)
  if (key === 'authors') return (candidate.authors ?? []).join(', ')
  if (key === 'genres') return (candidate.genres ?? []).join(', ')
  if (key === 'narrators') return (candidate.narrators ?? []).join(', ')
  const val = candidate[key as keyof MetadataCandidate]
  return val != null ? String(val) : ''
}

export function useMetadataDiff(
  current: MetadataSource,
  candidates: MaybeRefOrGetter<MetadataCandidate[]>,
  activeProvider: MaybeRefOrGetter<MetadataProviderKey>,
  providerInfos: MaybeRefOrGetter<MetadataProviderInfo[]>,
  currentCoverUrl?: string,
  providerIds?: MaybeRefOrGetter<ProviderIds | undefined>,
  lockedFields?: MaybeRefOrGetter<readonly BookMetadataLockField[] | undefined>,
) {
  const pickedSources = reactive(new Map<DiffFieldKey, MetadataProviderKey>())
  const lockedFieldSet = computed(() => new Set(toValue(lockedFields) ?? []))

  function resolveLockField(key: DiffFieldKey): BookMetadataLockField | null {
    if (key === 'coverUrl') return 'cover'
    if (key === 'sourceUrl') return null
    return key
  }

  function getBookValue(key: DiffFieldKey): string {
    if (isComicDiffFieldKey(key)) return ''
    if (key === 'authors') return current.authors.join(', ')
    if (key === 'genres') return current.genres.join(', ')
    if (key === 'narrators') return current.narrators?.join(', ') ?? ''
    if (key === 'coverUrl') return currentCoverUrl ?? ''
    const val = current[key as keyof MetadataSource]
    return val != null ? String(val) : ''
  }

  function buildProviderValues(key: DiffFieldKey): ProviderFieldValue[] {
    const allCandidates = toValue(candidates)
    const infos = toValue(providerInfos)
    const result: ProviderFieldValue[] = []
    const seenProviders = new Set<MetadataProviderKey>()

    for (const c of allCandidates) {
      if (seenProviders.has(c.provider)) continue
      seenProviders.add(c.provider)
      const display = getCandidateValueFrom(c, key)
      if (!display) continue
      result.push({
        provider: c.provider,
        label: getProviderLabel(c.provider, infos),
        display,
        isPicked: pickedSources.get(key) === c.provider,
      })
    }

    return result
  }

  function makeRow(key: DiffFieldKey, label: string): DiffField | null {
    const allCandidates = toValue(candidates)
    const ap = toValue(activeProvider)
    const activeCandidate = allCandidates.find((c) => c.provider === ap)
    const candidateVal = activeCandidate ? getCandidateValueFrom(activeCandidate, key) : ''
    const bookVal = getBookValue(key)

    if (key === 'coverUrl') {
      if (!candidateVal && !bookVal) return null
    } else {
      if (!candidateVal) return null
    }

    const pickedProvider = pickedSources.get(key) ?? null
    const isPicked = pickedProvider !== null
    const pickedFromActive = isPicked && pickedProvider === ap
    const pickedCandidate = isPicked ? allCandidates.find((c) => c.provider === pickedProvider) : null
    const pickedDisplay = pickedCandidate ? getCandidateValueFrom(pickedCandidate, key) : ''
    const lockField = resolveLockField(key)

    return {
      key,
      label,
      bookValue: bookVal,
      currentDisplay: isPicked ? pickedDisplay : bookVal,
      candidateDisplay: candidateVal,
      hasDiff: bookVal !== candidateVal,
      isPicked,
      pickedFromActive,
      pickedProvider,
      pickedDisplay,
      isCover: key === 'coverUrl',
      isLocked: lockField ? lockedFieldSet.value.has(lockField) : false,
      isCopyable: true,
      providerValues: buildProviderValues(key),
    }
  }

  const fields = computed<DiffField[]>(() => {
    const rows: DiffField[] = []
    const allCandidates = toValue(candidates)
    const ap = toValue(activeProvider)
    const ids = toValue(providerIds)
    const activeCandidate = allCandidates.find((c) => c.provider === ap)

    for (const def of FIELD_DEFS) {
      const row = makeRow(def.key, def.label)
      if (row) rows.push(row)
    }

    if (activeCandidate?.comicMetadata) {
      for (const def of COMIC_FIELD_DEFS) {
        const row = makeRow(def.key, def.label)
        if (row) rows.push(row)
      }
    }

    const existingProviderId = ids?.[ap] ?? ''
    const providerIdKey = PROVIDER_ID_FIELD[ap]
    if (providerIdKey && activeCandidate && (activeCandidate.providerId || existingProviderId)) {
      const pickedProvider = pickedSources.get(providerIdKey) ?? null
      const isPicked = pickedProvider !== null
      const pickedFromActive = isPicked && pickedProvider === ap
      const pickedCandidate = isPicked ? allCandidates.find((c) => c.provider === pickedProvider) : null
      const pickedDisplay = pickedCandidate?.providerId ?? ''
      const activeProviderIdVal = activeCandidate.providerId ?? ''

      rows.push({
        key: providerIdKey,
        label: PROVIDER_ID_LABEL[ap] ?? 'Provider ID',
        bookValue: existingProviderId ?? '',
        currentDisplay: pickedFromActive ? pickedDisplay : (existingProviderId ?? ''),
        candidateDisplay: activeProviderIdVal,
        hasDiff: (existingProviderId ?? '') !== activeProviderIdVal,
        isPicked: pickedFromActive,
        pickedFromActive,
        pickedProvider: pickedFromActive ? pickedProvider : null,
        pickedDisplay: pickedFromActive ? pickedDisplay : '',
        isCover: false,
        isLocked: lockedFieldSet.value.has(providerIdKey),
        isCopyable: true,
        providerValues: [],
      })
    }

    if (activeCandidate?.sourceUrl) {
      rows.push({
        key: 'sourceUrl',
        label: 'Source URL',
        bookValue: '',
        currentDisplay: '',
        candidateDisplay: activeCandidate.sourceUrl,
        hasDiff: true,
        isPicked: false,
        pickedFromActive: false,
        pickedProvider: null,
        pickedDisplay: '',
        isCover: false,
        isLocked: false,
        isCopyable: false,
        providerValues: [],
      })
    }

    return rows
  })

  function toggleField(key: DiffFieldKey) {
    const lockField = resolveLockField(key)
    if (lockField && lockedFieldSet.value.has(lockField)) return
    const ap = toValue(activeProvider)
    if (pickedSources.get(key) === ap) {
      pickedSources.delete(key)
    } else {
      pickedSources.set(key, ap)
    }
  }

  function pickFieldFromProvider(key: DiffFieldKey, provider: MetadataProviderKey) {
    const lockField = resolveLockField(key)
    if (lockField && lockedFieldSet.value.has(lockField)) return
    if (pickedSources.get(key) === provider) {
      pickedSources.delete(key)
    } else {
      pickedSources.set(key, provider)
    }
  }

  function copyAll() {
    const ap = toValue(activeProvider)
    for (const f of fields.value) {
      if (f.isCopyable && !f.isLocked) pickedSources.set(f.key, ap)
    }
  }

  function copyMissing() {
    const ap = toValue(activeProvider)
    for (const f of fields.value) {
      if (f.isCopyable && !f.isLocked && !f.bookValue && !f.isPicked) pickedSources.set(f.key, ap)
    }
  }

  function buildPatch(): { formPatch: MetadataPatch; coverUrl?: string } {
    const formPatch: MetadataPatch = {}
    let coverUrl: string | undefined
    const comicPatch: Partial<ComicMetadataFields> = {}
    const allCandidates = toValue(candidates)

    for (const [key, providerKey] of pickedSources) {
      const lockField = resolveLockField(key)
      if (lockField && lockedFieldSet.value.has(lockField)) continue
      const candidate = allCandidates.find((c) => c.provider === providerKey)
      if (!candidate) continue

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
      if (isProviderIdPatchField(key)) {
        formPatch[key] = candidate.providerId
        continue
      }
      if (key === 'sourceUrl') continue
      const val = candidate[key as keyof MetadataCandidate]
      ;(formPatch as Record<string, unknown>)[key] = val != null ? String(val) : null
    }

    if (Object.keys(comicPatch).length > 0) {
      formPatch.comicMetadata = comicPatch as ComicMetadataFields
    }

    // Auto-include provider IDs for every provider that contributed at least one picked field
    const pickedProviders = new Set(pickedSources.values())
    for (const provider of pickedProviders) {
      const candidate = allCandidates.find((c) => c.provider === provider)
      if (!candidate?.providerId) continue
      const idField = PROVIDER_ID_FIELD[provider]
      if (idField && formPatch[idField] === undefined) {
        formPatch[idField] = candidate.providerId
      }
    }

    // Preserve existing provider IDs on the book that we aren't overwriting
    const ids = toValue(providerIds)
    if (ids) {
      for (const [provider, id] of Object.entries(ids)) {
        const idField = PROVIDER_ID_FIELD[provider as MetadataProviderKey]
        if (idField && formPatch[idField] === undefined && id) {
          formPatch[idField] = id
        }
      }
    }

    return { formPatch, coverUrl }
  }

  const picksPerProvider = computed<Map<MetadataProviderKey, number>>(() => {
    const counts = new Map<MetadataProviderKey, number>()
    for (const provKey of pickedSources.values()) {
      counts.set(provKey, (counts.get(provKey) ?? 0) + 1)
    }
    return counts
  })

  function clearPicksForProvider(provider: MetadataProviderKey) {
    for (const [key, p] of pickedSources) {
      if (p === provider) pickedSources.delete(key)
    }
  }

  const hasCopied = computed(() => pickedSources.size > 0)

  return {
    fields,
    pickedSources,
    picksPerProvider,
    toggleField,
    pickFieldFromProvider,
    clearPicksForProvider,
    copyAll,
    copyMissing,
    buildPatch,
    hasCopied,
  }
}
