import { onScopeDispose, ref, watch, type Ref } from 'vue'
import type {
  BookChapterJobKind,
  BookChapterJobState,
  AnalyzeBookChaptersRequest,
  AnalyzeBookChaptersResult,
  AudibleRegion,
  ChapterWaveform,
  AudiobookChapter,
  ChapterLookupResult,
  EbookBookChapters,
  EbookChapterSource,
  BookChaptersState,
  BookChapterVersion,
  BookChapterVersionSummary,
  EmbeddedBookChapters,
  SaveBookChaptersRequest,
  WriteBookChaptersResult,
} from '@bookorbit/types'
import { apiJson, apiError, errorMessage, jsonBody } from '@/lib/api-json'

/** The chapter editor's server state for one book: load, save, revert and the version history. */
export function useBookChapters(bookId: Ref<number>) {
  const state = ref<BookChaptersState | null>(null)
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const busy = ref<'saving' | 'reverting' | 'writing' | null>(null)

  const operation = ref<BookChapterJobState | null>(null)
  const lifetime = new AbortController()
  let loadToken = 0
  let jobToken = 0
  watch(bookId, () => {
    loadToken += 1
    jobToken += 1
    state.value = null
    operation.value = null
    busy.value = null
  })
  onScopeDispose(() => lifetime.abort())

  const base = () => `/api/v1/books/${bookId.value}/chapters`

  async function pollJob(job: BookChapterJobState, id: number, token: number): Promise<NonNullable<BookChapterJobState['result']>> {
    const url = `/api/v1/books/${id}/chapters/jobs`
    const checkScope = () => {
      lifetime.signal.throwIfAborted()
      if (id !== bookId.value || token !== jobToken) throw new DOMException('Book changed', 'AbortError')
    }
    checkScope()
    operation.value = job
    while (job.status === 'queued' || job.status === 'processing') {
      checkScope()
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          reject(lifetime.signal.reason)
        }
        const timer = setTimeout(() => {
          lifetime.signal.removeEventListener('abort', abort)
          resolve()
        }, 1000)
        lifetime.signal.addEventListener('abort', abort, { once: true })
      })
      checkScope()
      job = await apiJson<BookChapterJobState>(`${url}/${job.id}`, { signal: lifetime.signal }, 'book.detail.chapters.errors.operation')
      checkScope()
      operation.value = job
    }
    checkScope()
    if (job.status === 'failed' || !job.result)
      throw await apiError(new Response(JSON.stringify({ errorCode: job.errorCode }), { status: 500 }), 'book.detail.chapters.errors.operation')
    return job.result
  }

  async function runJob(kind: BookChapterJobKind, retry = false): Promise<NonNullable<BookChapterJobState['result']>> {
    if (!state.value) throw new Error('Chapters are not loaded')
    const id = bookId.value
    const token = ++jobToken
    const job = await apiJson<BookChapterJobState>(
      `/api/v1/books/${id}/chapters/jobs/${kind}`,
      { ...jsonBody('POST', { baseRevision: state.value.revision, ...(retry ? { retry: true } : {}) }), signal: lifetime.signal },
      'book.detail.chapters.errors.operation',
    )
    return pollJob(job, id, token)
  }

  async function retryOperation(): Promise<BookChapterJobState['result']> {
    if (!operation.value || operation.value.status !== 'failed') return
    const result = await runJob(operation.value.kind, true)
    if ('revision' in result) state.value = result
    return result
  }

  async function recoverOperation(id: number, token: number): Promise<void> {
    try {
      const job = await apiJson<BookChapterJobState | null>(
        `/api/v1/books/${id}/chapters/jobs`,
        { signal: lifetime.signal },
        'book.detail.chapters.errors.operation',
      )
      if (id !== bookId.value || token !== jobToken || !job || job.status === 'success') return
      operation.value = job
      if (job.status === 'failed') return
      const result = await pollJob(job, id, token)
      if ('revision' in result) state.value = result
    } catch {
      // The durable job remains available for a later refresh if polling disconnects.
    }
  }

  /** `silent` revalidates behind rows already on screen without raising `loading`. */
  async function load(options: { silent?: boolean; operations?: boolean } = {}): Promise<void> {
    const id = bookId.value
    const token = ++loadToken
    if (!options.silent) loading.value = true
    loadError.value = null
    try {
      const next = await apiJson<BookChaptersState>(base(), { signal: lifetime.signal }, 'book.detail.chapters.errors.load')
      if (id === bookId.value && token === loadToken) {
        state.value = next
        if (options.operations && !busy.value) void recoverOperation(id, jobToken)
      }
    } catch (reason) {
      if (id === bookId.value && token === loadToken && !options.silent) loadError.value = errorMessage(reason, 'book.detail.chapters.errors.load')
    } finally {
      if (id === bookId.value && token === loadToken) loading.value = false
    }
  }

  /** Throws a localized error for the caller to show; the state only changes once the save lands. */
  async function save(chapters: AudiobookChapter[], lock: boolean): Promise<BookChaptersState> {
    if (!state.value) throw new Error('Chapters are not loaded')
    const id = bookId.value
    busy.value = 'saving'
    try {
      const payload: SaveBookChaptersRequest = { chapters, baseRevision: state.value.revision, lock }
      const next = await apiJson<BookChaptersState>(base(), jsonBody('PUT', payload), 'book.detail.chapters.errors.save')
      if (id !== bookId.value) throw new DOMException('Book changed', 'AbortError')
      state.value = next
      return state.value
    } finally {
      busy.value = null
    }
  }

  async function revert(): Promise<BookChaptersState> {
    if (!state.value) throw new Error('Chapters are not loaded')
    busy.value = 'reverting'
    try {
      state.value = (await runJob('revert')) as BookChaptersState
      return state.value
    } finally {
      busy.value = null
    }
  }

  /** Writes the saved list into the audio files; a newer save elsewhere makes it refuse. */
  async function writeToFiles(): Promise<WriteBookChaptersResult> {
    if (!state.value) throw new Error('Chapters are not loaded')
    busy.value = 'writing'
    try {
      return (await runJob('write')) as WriteBookChaptersResult
    } finally {
      busy.value = null
    }
  }

  async function readEmbedded(): Promise<AudiobookChapter[]> {
    const result = (await runJob('read')) as EmbeddedBookChapters
    return result.chapters
  }

  function lookup(asin: string, region: AudibleRegion): Promise<ChapterLookupResult> {
    const query = new URLSearchParams({ asin, region })
    return apiJson<ChapterLookupResult>(`${base()}/lookup?${query.toString()}`, undefined, 'book.detail.chapters.errors.lookup')
  }

  function readEbook(source: EbookChapterSource): Promise<EbookBookChapters> {
    return apiJson<EbookBookChapters>(`${base()}/ebook?source=${source}`, undefined, 'book.detail.chapters.errors.readEbook')
  }

  /** Pauses in the audio around each point, for snapping starts. */
  async function analyze(points: number[], windowMs: number, signal?: AbortSignal) {
    const payload: AnalyzeBookChaptersRequest = { points, windowMs }
    const result = await apiJson<AnalyzeBookChaptersResult>(
      `${base()}/analyze`,
      { ...jsonBody('POST', payload), signal },
      'book.detail.chapters.errors.analyze',
    )
    return result.windows
  }

  function waveform(atMs: number, windowMs: number, buckets: number, signal?: AbortSignal): Promise<ChapterWaveform> {
    const query = new URLSearchParams({ atMs: String(atMs), windowMs: String(windowMs), buckets: String(buckets) })
    return apiJson<ChapterWaveform>(`${base()}/waveform?${query.toString()}`, { signal }, 'book.detail.chapters.errors.analyze')
  }

  function listVersions(): Promise<BookChapterVersionSummary[]> {
    return apiJson<BookChapterVersionSummary[]>(`${base()}/versions`, undefined, 'book.detail.chapters.errors.versions')
  }

  function getVersion(versionId: number): Promise<BookChapterVersion> {
    return apiJson<BookChapterVersion>(`${base()}/versions/${versionId}`, undefined, 'book.detail.chapters.errors.versions')
  }

  return {
    state,
    operation,
    retryOperation,
    loading,
    loadError,
    busy,
    load,
    save,
    revert,
    writeToFiles,
    readEmbedded,
    lookup,
    readEbook,
    analyze,
    waveform,
    listVersions,
    getVersion,
  }
}
