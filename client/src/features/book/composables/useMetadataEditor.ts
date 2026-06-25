import { computed, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import {
  FORMAT_TO_GROUP,
  type BookCommunityRating,
  type BookDetail,
  type BookMetadataLockField,
  type BookMetadataSaveResult,
  type CustomMetadataBookValue,
  type CustomMetadataBookValueInput,
} from '@bookorbit/types'

export type EditableSeriesMembership = {
  seriesName: string
  seriesIndex: number | null
}

const ROOT_FIELDS = [
  'title',
  'subtitle',
  'description',
  'publisher',
  'publishedYear',
  'language',
  'pageCount',
  'isbn10',
  'isbn13',
  'rating',
  'authors',
  'genres',
  'tags',
  'googleBooksId',
  'goodreadsId',
  'amazonId',
  'hardcoverId',
  'hardcoverEditionId',
  'openLibraryId',
  'itunesId',
  'audibleId',
  'koboId',
  'comicvineId',
  'ranobedbId',
  'lubimyczytacId',
  'aladinId',
] as const

const COMIC_FIELDS = {
  issueNumber: 'comicIssueNumber',
  volumeName: 'comicVolumeName',
  storyArcs: 'comicStoryArcs',
  pencillers: 'comicPencillers',
  inkers: 'comicInkers',
  colorists: 'comicColorists',
  letterers: 'comicLetterers',
  coverArtists: 'comicCoverArtists',
  characters: 'comicCharacters',
  teams: 'comicTeams',
  locations: 'comicLocations',
} as const

const AUDIO_FIELDS = {
  narrators: 'narrators',
  durationSeconds: 'durationSeconds',
  abridged: 'abridged',
} as const

function normalizePageCount(value: number | null): number | null {
  return typeof value === 'number' && value > 0 ? value : null
}

export function normalizeSeriesMemberships(values: readonly EditableSeriesMembership[]): EditableSeriesMembership[] {
  const seen = new Set<string>()
  const out: EditableSeriesMembership[] = []
  for (const value of values) {
    const seriesName = value.seriesName.trim()
    if (!seriesName) continue
    const key = seriesName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ seriesName, seriesIndex: value.seriesIndex ?? null })
  }
  return out
}

function seriesMembershipsFromBook(book: BookDetail): EditableSeriesMembership[] {
  const memberships = book.seriesMemberships ?? []
  if (memberships.length > 0) {
    return normalizeSeriesMemberships(memberships.map((membership) => ({ seriesName: membership.seriesName, seriesIndex: membership.seriesIndex })))
  }
  return book.seriesName ? [{ seriesName: book.seriesName, seriesIndex: book.seriesIndex }] : []
}

function changedCustomMetadataPayload(
  currentValues: readonly CustomMetadataBookValue[],
  previousValues: readonly CustomMetadataBookValue[],
): CustomMetadataBookValueInput[] {
  const previousByFieldId = new Map(previousValues.map((field) => [field.fieldId, field.value]))
  return currentValues
    .filter((field) => JSON.stringify(field.value) !== JSON.stringify(previousByFieldId.get(field.fieldId)))
    .map((field) => ({ fieldId: field.fieldId, value: field.value }))
}

export function useMetadataEditor() {
  const saving = ref(false)
  const error = ref<string | null>(null)

  const form = reactive({
    title: null as string | null,
    subtitle: null as string | null,
    description: null as string | null,
    publisher: null as string | null,
    publishedYear: null as number | null,
    language: null as string | null,
    pageCount: null as number | null,
    communityRatings: [] as BookCommunityRating[],
    seriesName: null as string | null,
    seriesIndex: null as number | null,
    seriesMemberships: [] as EditableSeriesMembership[],
    isbn10: null as string | null,
    isbn13: null as string | null,
    rating: null as number | null,
    authors: [] as string[],
    genres: [] as string[],
    tags: [] as string[],
    narrators: [] as string[],
    durationSeconds: null as number | null,
    abridged: false as boolean,
    googleBooksId: null as string | null,
    goodreadsId: null as string | null,
    amazonId: null as string | null,
    hardcoverId: null as string | null,
    hardcoverEditionId: null as string | null,
    openLibraryId: null as string | null,
    itunesId: null as string | null,
    audibleId: null as string | null,
    koboId: null as string | null,
    comicvineId: null as string | null,
    ranobedbId: null as string | null,
    lubimyczytacId: null as string | null,
    aladinId: null as string | null,
    comicIssueNumber: null as string | null,
    comicVolumeName: null as string | null,
    comicStoryArcs: [] as string[],
    comicPencillers: [] as string[],
    comicInkers: [] as string[],
    comicColorists: [] as string[],
    comicLetterers: [] as string[],
    comicCoverArtists: [] as string[],
    comicCharacters: [] as string[],
    comicTeams: [] as string[],
    comicLocations: [] as string[],
    customMetadata: [] as CustomMetadataBookValue[],
  })

  const snapshot = ref(JSON.stringify(form))
  const includeAudioMetadata = ref(false)

  const isDirty = computed(() => JSON.stringify(form) !== snapshot.value)

  function load(book: BookDetail) {
    form.title = book.title
    form.subtitle = book.subtitle
    form.description = book.description
    form.publisher = book.publisher
    form.publishedYear = book.publishedYear
    form.language = book.language
    form.pageCount = book.pageCount
    form.communityRatings = [...book.communityRatings]
    form.seriesName = book.seriesName
    form.seriesIndex = book.seriesIndex
    form.seriesMemberships = seriesMembershipsFromBook(book)
    form.isbn10 = book.isbn10
    form.isbn13 = book.isbn13
    form.rating = book.rating ?? null
    form.authors = book.authors.map((a) => a.name)
    form.genres = [...book.genres]
    form.tags = [...book.tags]
    form.narrators = book.audioMetadata?.narrators?.map((n) => n.name) ?? []
    form.durationSeconds = book.audioMetadata?.durationSeconds ?? null
    form.abridged = book.audioMetadata?.abridged ?? false
    form.googleBooksId = book.providerIds.google ?? null
    form.goodreadsId = book.providerIds.goodreads ?? null
    form.amazonId = book.providerIds.amazon ?? null
    form.hardcoverId = book.providerIds.hardcover ?? null
    form.hardcoverEditionId = book.hardcoverEditionId
    form.openLibraryId = book.providerIds.openLibrary ?? null
    form.itunesId = book.providerIds.itunes ?? null
    form.audibleId = book.providerIds.audible ?? null
    form.koboId = book.providerIds.kobo ?? null
    form.comicvineId = book.providerIds.comicvine ?? null
    form.ranobedbId = book.providerIds.ranobedb ?? null
    form.lubimyczytacId = book.providerIds.lubimyczytac ?? null
    form.aladinId = book.providerIds.aladin ?? null
    const cm = book.comicMetadata
    form.comicIssueNumber = cm?.issueNumber ?? null
    form.comicVolumeName = cm?.volumeName ?? null
    form.comicStoryArcs = cm?.storyArcs ?? []
    form.comicPencillers = cm?.pencillers ?? []
    form.comicInkers = cm?.inkers ?? []
    form.comicColorists = cm?.colorists ?? []
    form.comicLetterers = cm?.letterers ?? []
    form.comicCoverArtists = cm?.coverArtists ?? []
    form.comicCharacters = cm?.characters ?? []
    form.comicTeams = cm?.teams ?? []
    form.comicLocations = cm?.locations ?? []
    form.customMetadata = (book.customMetadata ?? []).map((field) => ({ ...field }))
    includeAudioMetadata.value = book.audioMetadata != null || book.files.some((f) => f.format != null && FORMAT_TO_GROUP[f.format] === 'audio')
    snapshot.value = JSON.stringify(form)
    error.value = null
  }

  function reset() {
    const s = JSON.parse(snapshot.value)
    Object.assign(form, s)
    error.value = null
  }

  function buildPayload() {
    const previous = JSON.parse(snapshot.value) as typeof form
    const payload: Record<string, unknown> = {}

    for (const field of ROOT_FIELDS) {
      const current = field === 'pageCount' ? normalizePageCount(form.pageCount) : form[field]
      if (JSON.stringify(current) !== JSON.stringify(previous[field])) {
        payload[field] = current
      }
    }

    const currentSeriesMemberships = normalizeSeriesMemberships(form.seriesMemberships)
    const previousSeriesMemberships = normalizeSeriesMemberships(previous.seriesMemberships)
    if (JSON.stringify(currentSeriesMemberships) !== JSON.stringify(previousSeriesMemberships)) {
      payload.seriesMemberships = currentSeriesMemberships
    }

    const currentCommunityRatings = form.communityRatings.map(({ provider, rating, ratingCount }) => ({ provider, rating, ratingCount }))
    const previousCommunityRatings = previous.communityRatings.map(({ provider, rating, ratingCount }) => ({ provider, rating, ratingCount }))
    if (JSON.stringify(currentCommunityRatings) !== JSON.stringify(previousCommunityRatings)) {
      payload.communityRatings = currentCommunityRatings
    }

    const comicMetadata: Record<string, unknown> = {}
    for (const [payloadKey, formKey] of Object.entries(COMIC_FIELDS)) {
      if (JSON.stringify(form[formKey]) !== JSON.stringify(previous[formKey])) {
        comicMetadata[payloadKey] = form[formKey]
      }
    }
    if (Object.keys(comicMetadata).length > 0) {
      payload.comicMetadata = comicMetadata
    }

    if (includeAudioMetadata.value) {
      const audioMetadata: Record<string, unknown> = {}
      for (const [payloadKey, formKey] of Object.entries(AUDIO_FIELDS)) {
        if (JSON.stringify(form[formKey]) !== JSON.stringify(previous[formKey])) {
          audioMetadata[payloadKey] = form[formKey]
        }
      }
      if (Object.keys(audioMetadata).length > 0) {
        payload.audioMetadata = audioMetadata
      }
    }

    const customMetadata = changedCustomMetadataPayload(form.customMetadata, previous.customMetadata)
    if (customMetadata.length > 0) {
      payload.customMetadata = customMetadata
    }
    return payload
  }

  function normalizeSaveResult(data: BookDetail | BookMetadataSaveResult): BookMetadataSaveResult {
    if ('book' in data && 'libraryAutoWriteEnabled' in data) {
      return data
    }
    return { book: data, write: null, libraryAutoWriteEnabled: false }
  }

  async function save(bookId: number, lockedFields: readonly BookMetadataLockField[]): Promise<BookMetadataSaveResult | null> {
    saving.value = true
    error.value = null
    try {
      const metadata = buildPayload()
      const shouldSyncFileWrite = Object.keys(metadata).length > 0
      const res = await api(`/api/v1/books/${bookId}/metadata-and-locks${shouldSyncFileWrite ? '?syncFileWrite=true' : ''}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata, lockedFields }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated = normalizeSaveResult((await res.json()) as BookDetail | BookMetadataSaveResult)
      snapshot.value = JSON.stringify(form)
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save'
      return null
    } finally {
      saving.value = false
    }
  }

  return { form, saving, error, isDirty, load, reset, save }
}
