import { computed, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import { FORMAT_TO_GROUP, type BookDetail, type BookMetadataLockField } from '@bookorbit/types'

const ROOT_FIELDS = [
  'title',
  'subtitle',
  'description',
  'publisher',
  'publishedYear',
  'language',
  'pageCount',
  'seriesName',
  'seriesIndex',
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
  'openLibraryId',
  'itunesId',
  'audibleId',
  'comicvineId',
  'ranobedbId',
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
    seriesName: null as string | null,
    seriesIndex: null as number | null,
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
    openLibraryId: null as string | null,
    itunesId: null as string | null,
    audibleId: null as string | null,
    comicvineId: null as string | null,
    ranobedbId: null as string | null,
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
    form.seriesName = book.seriesName
    form.seriesIndex = book.seriesIndex
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
    form.openLibraryId = book.providerIds.openLibrary ?? null
    form.itunesId = book.providerIds.itunes ?? null
    form.audibleId = book.providerIds.audible ?? null
    form.comicvineId = book.providerIds.comicvine ?? null
    form.ranobedbId = book.providerIds.ranobedb ?? null
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
      if (JSON.stringify(form[field]) !== JSON.stringify(previous[field])) {
        payload[field] = form[field]
      }
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
    return payload
  }

  async function save(
    bookId: number,
    options: { lockedFields?: readonly BookMetadataLockField[]; saveLocks?: boolean } = {},
  ): Promise<BookDetail | null> {
    saving.value = true
    error.value = null
    try {
      const metadata = buildPayload()
      const res = await api(options.saveLocks ? `/api/v1/books/${bookId}/metadata-and-locks` : `/api/v1/books/${bookId}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options.saveLocks ? { metadata, lockedFields: options.lockedFields ?? [] } : metadata),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated: BookDetail = await res.json()
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
