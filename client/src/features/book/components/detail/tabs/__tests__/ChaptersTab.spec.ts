import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOOK_CHAPTERS_ERROR_CODES, type BookChaptersState, type BookDetail, type SaveBookChaptersRequest } from '@bookorbit/types'
import { setI18nLocale } from '@/i18n'
import { api } from '@/lib/api'
import ChaptersTab from '../ChaptersTab.vue'

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ query: {} }),
  useRouter: () => ({}),
  onBeforeRouteUpdate: vi.fn<typeof import('vue-router').onBeforeRouteUpdate>(),
  onBeforeRouteLeave: vi.fn<typeof import('vue-router').onBeforeRouteLeave>(),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: vi.fn<typeof api>(),
}))

vi.mock('@/features/library/composables/useLibraryPermissions', () => ({
  useLibraryPermissions: () => ({ hasLibraryPermission: () => true }),
}))

vi.mock('@tanstack/vue-virtual', async () => {
  const { computed } = await import('vue')
  return {
    useVirtualizer: (options: { value: { count: number } }) =>
      computed(() => ({
        getVirtualItems: () => Array.from({ length: options.value.count }, (_, index) => ({ index, key: index, start: index * 46 })),
        getTotalSize: () => options.value.count * 46,
        measure: vi.fn<() => void>(),
        measureElement: vi.fn<(element: Element) => void>(),
        scrollToIndex: vi.fn<(index: number) => void>(),
      })),
  }
})

const CHAPTERS_URL = '/api/v1/books/1/chapters'
const INITIAL = {
  revision: 'a'.repeat(64),
  chapters: [
    { title: 'Opening', startMs: 0 },
    { title: 'Second', startMs: 12_000 },
  ],
  source: 'embedded',
  derived: false,
  locked: false,
  updatedAt: null,
  updatedBy: null,
  totalDurationMs: 20_000,
  tracks: [{ fileId: 1, name: 'book.m4b', startMs: 0, durationMs: 20_000 }],
  audibleId: null,
  versionCount: 0,
  audibleRegion: 'us',
  sources: { ebookFileId: null, readAlongFileId: null },
  writeBack: { available: true, reason: null, fileCount: 1 },
} satisfies BookChaptersState
const LATEST: BookChaptersState = {
  ...INITIAL,
  revision: 'b'.repeat(64),
  chapters: [{ title: 'Current chapters', startMs: 0 }],
}

const getChapters = vi.fn<() => Promise<Response>>()
const putChapters = vi.fn<(payload: SaveBookChaptersRequest) => Promise<Response>>()
let wrapper: VueWrapper | null = null

function stale() {
  return Response.json({ errorCode: BOOK_CHAPTERS_ERROR_CODES.stale }, { status: 409 })
}

function button(label: string) {
  const match = wrapper!.findAll('button').find((candidate) => candidate.text() === label)
  if (!match) throw new Error(`Button not found: ${label}`)
  return match
}

function chapterTitle() {
  return wrapper!.get<HTMLInputElement>('input[aria-label="Title of chapter 1"]')
}

async function editChapter() {
  const book = {
    id: 1,
    libraryId: 1,
    title: 'Test audiobook',
    files: [{ format: 'm4b', role: 'primary' }],
    covers: { ebook: null, audio: null },
    coverSource: null,
  } as BookDetail
  wrapper = mount(ChaptersTab, { props: { book }, attachTo: document.body })
  await flushPromises()
  await button('Edit chapters').trigger('click')
  await chapterTitle().setValue('Draft opening')
}

beforeEach(async () => {
  await setI18nLocale('en')
  getChapters.mockReset().mockResolvedValueOnce(Response.json(INITIAL))
  putChapters.mockReset().mockResolvedValueOnce(stale())
  vi.mocked(api).mockImplementation(async (url, init) => {
    if (url === CHAPTERS_URL) return init?.method === 'PUT' ? putChapters(JSON.parse(String(init.body))) : getChapters()
    if (url === `${CHAPTERS_URL}/versions`) return Response.json([])
    if (url === `${CHAPTERS_URL}/jobs`) return Response.json(null)
    if (url === '/api/v1/audiobooks/1/playback-state') return new Response(null, { status: 204 })
    if (url === `${CHAPTERS_URL}/analyze`) return Response.json({ windows: [] })
    if (String(url).startsWith(`${CHAPTERS_URL}/waveform?`)) return Response.json({ failed: true, peaks: [], fromMs: 0, toMs: 20_000 })
    throw new Error(`Unexpected request: ${String(url)}`)
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('chapter save conflicts', () => {
  it('keeps the draft and requires a new explicit apply after each conflict', async () => {
    const newer = { ...LATEST, revision: 'c'.repeat(64) }
    getChapters.mockResolvedValueOnce(Response.json(LATEST)).mockResolvedValueOnce(Response.json(newer))
    putChapters.mockResolvedValueOnce(stale()).mockImplementationOnce(async (request) => Response.json({ ...newer, chapters: request.chapters }))
    await editChapter()

    await button('Save chapters').trigger('click')
    await flushPromises()
    expect(wrapper!.get('[role="alert"]').text()).toContain('The chapters or audio tracks changed')
    expect(chapterTitle().element.value).toBe('Draft opening')
    await chapterTitle().trigger('keydown', { key: 's', ctrlKey: true })
    expect(putChapters.mock.calls.map(([payload]) => payload.baseRevision)).toEqual([INITIAL.revision])

    await button('Apply my draft').trigger('click')
    await flushPromises()
    expect(chapterTitle().element.value).toBe('Draft opening')
    expect(putChapters.mock.calls.map(([payload]) => payload.baseRevision)).toEqual([INITIAL.revision, LATEST.revision])

    await button('Apply my draft').trigger('click')
    await flushPromises()
    expect(putChapters).toHaveBeenLastCalledWith({
      chapters: [{ title: 'Draft opening', startMs: 0 }, INITIAL.chapters[1]],
      baseRevision: newer.revision,
      lock: true,
    })
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
    expect(chapterTitle().element.value).toBe('Draft opening')
  })

  it('preserves the draft through failed loads and discards only after a successful reload', async () => {
    getChapters
      .mockResolvedValueOnce(Response.json(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(LATEST))
      .mockResolvedValueOnce(Response.json(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json(LATEST))
      .mockResolvedValueOnce(Response.json({ ...LATEST, chapters: [{ title: 'Reloaded chapters', startMs: 0 }] }))
    await editChapter()
    await button('Save chapters').trigger('click')
    await flushPromises()
    expect(chapterTitle().element.value).toBe('Draft opening')

    await button('Try again').trigger('click')
    await flushPromises()
    await button('Discard draft and reload').trigger('click')
    await flushPromises()
    expect(chapterTitle().element.value).toBe('Draft opening')

    await button('Try again').trigger('click')
    await flushPromises()
    expect(chapterTitle().element.value).toBe('Draft opening')
    await button('Discard draft and reload').trigger('click')
    await flushPromises()
    expect(chapterTitle().element.value).toBe('Reloaded chapters')
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
    expect(putChapters).toHaveBeenCalledTimes(1)
  })

  it('blocks applying a draft with a start past the refreshed duration until corrected', async () => {
    getChapters.mockResolvedValueOnce(Response.json({ ...LATEST, totalDurationMs: 10_000 }))
    putChapters.mockImplementationOnce(async (request) => Response.json({ ...LATEST, chapters: request.chapters, totalDurationMs: 10_000 }))
    await editChapter()

    await button('Save chapters').trigger('click')
    await flushPromises()
    expect(button('Apply my draft').attributes('disabled')).toBeDefined()
    expect(putChapters).toHaveBeenCalledTimes(1)

    const start = wrapper!.get('input[aria-label="Start of chapter 2"]')
    await start.setValue('0:08')
    await start.trigger('blur')
    expect(button('Apply my draft').attributes('disabled')).toBeUndefined()
    await button('Apply my draft').trigger('click')
    await flushPromises()
    expect(putChapters).toHaveBeenLastCalledWith({
      chapters: [
        { title: 'Draft opening', startMs: 0 },
        { title: 'Second', startMs: 8_000 },
      ],
      baseRevision: LATEST.revision,
      lock: true,
    })
  })

  it('keeps edits made while the discard reload was in progress', async () => {
    let finishReload!: (response: Response) => void
    getChapters.mockResolvedValueOnce(Response.json(LATEST)).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReload = resolve
        }),
    )
    await editChapter()
    await button('Save chapters').trigger('click')
    await flushPromises()
    await button('Discard draft and reload').trigger('click')
    await chapterTitle().setValue('Another draft opening')
    finishReload(Response.json(LATEST))
    await flushPromises()

    expect(chapterTitle().element.value).toBe('Another draft opening')
    expect(button('Apply my draft').attributes('disabled')).toBeUndefined()
    expect(putChapters).toHaveBeenCalledTimes(1)
  })
})
