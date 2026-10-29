import { defineComponent, h, ref, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookChaptersState, BookChapterJobState } from '@bookorbit/types'
import { apiJson } from '@/lib/api-json'
import { useBookChapters } from '../useBookChapters'

vi.mock('@/lib/api-json', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-json')>()),
  apiJson: vi.fn<typeof apiJson>(),
  errorMessage: () => 'Operation failed',
  jsonBody: (method: string, body: unknown) => ({ method, body: JSON.stringify(body) }),
}))

const loaded = { revision: 'a'.repeat(64), chapters: [{ title: 'First', startMs: 0 }] } as BookChaptersState
const job = { id: 'job-id', kind: 'read', status: 'failed', filesWritten: 0, filesTotal: 0 } as BookChapterJobState
const wrappers: ReturnType<typeof mount>[] = []
function setup() {
  const bookId = ref(1)
  let store!: ReturnType<typeof useBookChapters>
  wrappers.push(
    mount(
      defineComponent({
        setup() {
          store = useBookChapters(bookId)
          return () => h('div')
        },
      }),
    ),
  )
  return { store, bookId }
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.resetAllMocks()
  vi.useRealTimers()
})

describe('useBookChapters asynchronous operations', () => {
  it('does not let a stale load clear a newer request or publish the previous book', async () => {
    let release!: (value: BookChaptersState) => void
    vi.mocked(apiJson)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValueOnce(loaded)
    const { store, bookId } = setup()
    const old = store.load()
    bookId.value = 2
    await nextTick()
    const current = store.load()
    release({ ...loaded, revision: 'old' })
    await Promise.all([old, current])
    expect(store.state.value?.revision).toBe(loaded.revision)
    expect(store.loading.value).toBe(false)
  })

  it('recovers an in-progress operation after refresh and polls its durable id', async () => {
    vi.useFakeTimers()
    const result = { chapters: [{ title: 'Read from disk', startMs: 0 }] }
    vi.mocked(apiJson)
      .mockResolvedValueOnce(loaded)
      .mockResolvedValueOnce({ ...job, status: 'processing' })
      .mockResolvedValueOnce({ ...job, status: 'success', result })
    const { store } = setup()
    await store.load({ operations: true })
    await flushPromises()
    expect(store.operation.value?.status).toBe('processing')
    await vi.advanceTimersByTimeAsync(1000)
    expect(apiJson).toHaveBeenLastCalledWith(
      '/api/v1/books/1/chapters/jobs/job-id',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      'book.detail.chapters.errors.operation',
    )
    expect(store.operation.value?.result).toEqual(result)
  })

  it('returns the embedded read result when retrying a failed operation', async () => {
    const result = { chapters: [{ title: 'Retried read', startMs: 0 }] }
    vi.mocked(apiJson)
      .mockResolvedValueOnce(loaded)
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce({ ...job, status: 'success', result })
    const { store } = setup()
    await store.load({ operations: true })
    await flushPromises()
    expect(await store.retryOperation()).toEqual(result)
    expect(store.state.value).toEqual(loaded)
  })

  it('discards a start response after navigation before updating the new book', async () => {
    let release!: (value: BookChapterJobState) => void
    vi.mocked(apiJson)
      .mockResolvedValueOnce(loaded)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
    const { store, bookId } = setup()
    await store.load()
    const read = store.readEmbedded()
    bookId.value = 2
    await nextTick()
    release({ ...job, status: 'success', result: { chapters: [] } })
    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(store.operation.value).toBeNull()
  })
})
