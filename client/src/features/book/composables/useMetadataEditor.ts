import { computed, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import { FORMAT_TO_GROUP, type BookDetail } from '@projectx/types'

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
    const {
      comicIssueNumber,
      comicVolumeName,
      comicStoryArcs,
      comicPencillers,
      comicInkers,
      comicColorists,
      comicLetterers,
      comicCoverArtists,
      comicCharacters,
      comicTeams,
      comicLocations,
      narrators,
      durationSeconds,
      abridged,
      ...rest
    } = form
    const payload = {
      ...rest,
      comicMetadata: {
        issueNumber: comicIssueNumber ?? undefined,
        volumeName: comicVolumeName ?? undefined,
        storyArcs: comicStoryArcs,
        pencillers: comicPencillers,
        inkers: comicInkers,
        colorists: comicColorists,
        letterers: comicLetterers,
        coverArtists: comicCoverArtists,
        characters: comicCharacters,
        teams: comicTeams,
        locations: comicLocations,
      },
    }
    if (includeAudioMetadata.value) {
      return {
        ...payload,
        audioMetadata: {
          narrators,
          durationSeconds,
          abridged,
        },
      }
    }
    return payload
  }

  async function save(bookId: number): Promise<BookDetail | null> {
    saving.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/books/${bookId}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
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
