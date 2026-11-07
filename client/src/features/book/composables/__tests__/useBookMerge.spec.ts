import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import type { BookMergeJobEvent, BookMergePreviewRequest, BookMergeRequest, BookMergePreviewResponse } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { jsonResponse, mergeField, mergeJob, mergePreview } from '@/features/book/components/merge/__tests__/fixtures'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  progress: null as ((event: BookMergeJobEvent) => void) | null,
  finished: null as ((event: BookMergeJobEvent) => void) | null,
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: mocks.api,
}))

vi.mock('../useBookEvents', () => ({
  useBookEvents: () => ({
    onBookMergeProgress: (callback: (event: BookMergeJobEvent) => void) => {
      mocks.progress = callback
      return () => undefined
    },
    onBookMergeFinished: (callback: (event: BookMergeJobEvent) => void) => {
      mocks.finished = callback
      return () => undefined
    },
  }),
}))

import { MERGE_JOB_POLL_MAX_FAILURES, MERGE_JOB_POLL_MS, MERGE_PREVIEW_DEBOUNCE_MS, useBookMerge } from '../useBookMerge'

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>

const PREVIEW_URL = '/api/v1/books/merge/preview'
const MERGE_URL = '/api/v1/books/merge'
const JOB_URL = '/api/v1/books/merge/jobs/41'

let routes: Map<string, Handler[]>
let scope: EffectScope

/** Answers the next requests to `url` in order; the last answer repeats. Replaces earlier answers. */
function respond(url: string, ...handlers: Handler[]): void {
  routes.set(url, handlers)
}

function calls(url: string): RequestInit[] {
  return mocks.api.mock.calls.filter(([input]) => String(input) === url).map(([, init]) => init ?? {})
}

function bodyOf<T>(init: RequestInit): T {
  return JSON.parse(String(init.body)) as T
}

function previewRequests(): BookMergePreviewRequest[] {
  return calls(PREVIEW_URL).map((init) => bodyOf<BookMergePreviewRequest>(init))
}

function setup() {
  scope = effectScope()
  return scope.run(() => useBookMerge())!
}

function event(overrides: Partial<BookMergeJobEvent> = {}): BookMergeJobEvent {
  return { jobId: 41, status: 'moving', targetBookId: 1, processed: 0, total: 1, currentSourceBookId: 2, outcomes: [], ...overrides }
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

/** A started review of books 1 and 2, keeping book 1, with a current preview on screen. */
async function ready(preview: BookMergePreviewResponse = mergePreview()) {
  const merge = setup()
  respond(PREVIEW_URL, () => jsonResponse(preview))
  await merge.start([1, 2], { keeperId: 1 })
  return merge
}

beforeEach(() => {
  vi.useFakeTimers()
  routes = new Map()
  mocks.api.mockReset()
  mocks.api.mockImplementation(async (input, init) => {
    const queue = routes.get(String(input))
    const handler = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (!handler) throw new Error(`Unexpected request ${String(input)}`)
    return handler(init)
  })
})

afterEach(() => {
  scope?.stop()
  vi.useRealTimers()
})

describe('useBookMerge preview', () => {
  it('previews straight away and moves to the book the keeper rule picks', async () => {
    const merge = setup()
    respond(
      PREVIEW_URL,
      () => jsonResponse(mergePreview({ fields: [mergeField('publisher', { 1: null, 2: 'Ace' }, 2)] })),
      () => jsonResponse(mergePreview({ targetBookId: 2, fields: [mergeField('publisher', { 1: null, 2: 'Ace' }, 2)] })),
    )

    await merge.start([1, 2])

    expect(previewRequests()).toEqual([
      { targetBookId: 1, sourceBookIds: [2] },
      { targetBookId: 2, sourceBookIds: [1] },
    ])
    expect(merge.keeperId.value).toBe(2)
    expect(merge.previewCurrent.value).toBe(true)
    expect(merge.canExecute.value).toBe(true)
  })

  it('keeps a keeper the caller already chose', async () => {
    const merge = setup()
    respond(PREVIEW_URL, () => jsonResponse(mergePreview({ fields: [mergeField('publisher', { 1: null, 2: 'Ace' }, 2)] })))

    await merge.start([1, 2], { keeperId: 1 })

    expect(previewRequests()).toHaveLength(1)
    expect(merge.keeperId.value).toBe(1)
  })

  it('coalesces quick keeper and destination changes into one debounced preview', async () => {
    const merge = await ready()
    respond(PREVIEW_URL, () => jsonResponse(mergePreview({ targetBookId: 2, destinationBookId: 1 })))

    merge.setKeeper(2)
    merge.setDestination(1)
    expect(merge.previewLoading.value).toBe(true)
    expect(merge.canExecute.value).toBe(false)

    await vi.advanceTimersByTimeAsync(MERGE_PREVIEW_DEBOUNCE_MS - 1)
    expect(previewRequests()).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(previewRequests()).toEqual([
      { targetBookId: 1, sourceBookIds: [2] },
      { targetBookId: 2, sourceBookIds: [1], destinationBookId: 1 },
    ])
    expect(merge.previewLoading.value).toBe(false)
    expect(merge.canExecute.value).toBe(true)
  })

  it('drops a field choice the next preview no longer offers', async () => {
    const merge = await ready()
    merge.setFieldChoice('publisher', 2)
    expect(merge.fieldOverrides.value).toEqual({ publisher: 2 })

    merge.setFieldChoice('publisher', 1)
    expect(merge.fieldOverrides.value).toEqual({})

    merge.setFieldChoice('publisher', 2)
    respond(PREVIEW_URL, () => jsonResponse(mergePreview({ fields: [mergeField('publisher', { 1: 'Chilton', 2: null }, 1)] })))
    await merge.refreshPreview()
    expect(merge.fieldOverrides.value).toEqual({})
  })

  it('reports a failed preview with its own wording', async () => {
    const merge = setup()
    respond(PREVIEW_URL, () => jsonResponse({ message: 'boom' }, 500))

    await merge.start([1, 2], { keeperId: 1 })

    expect(merge.previewError.value).toBe(i18n.global.t('book.merge.errors.previewFailed'))
    expect(merge.canExecute.value).toBe(false)
  })
})

describe('useBookMerge execute', () => {
  it('sends the reviewed choices with the preview token', async () => {
    const merge = await ready(
      mergePreview({
        visibility: { tags: [{ id: 5, name: 'Private', effect: 'widens' }], genres: [], canOverride: true },
        canRemoveIdenticalCopies: true,
      }),
    )
    respond(MERGE_URL, () => jsonResponse({ jobId: 41 }, 202))
    merge.setFieldChoice('publisher', 2)
    merge.setIncludeTag(5, true)
    merge.setDeleteIdenticalCopies(true)

    await expect(merge.execute()).resolves.toBe(true)

    expect(bodyOf<BookMergeRequest>(calls(MERGE_URL)[0]!)).toEqual({
      targetBookId: 1,
      sourceBookIds: [2],
      previewToken: 'token-1',
      fieldOverrides: { publisher: 2 },
      includeTagIds: [5],
      deleteIdenticalCopies: true,
    })
    expect(merge.job.value).toMatchObject({ jobId: 41, status: 'planned', sourceBookIds: [2] })
    expect(merge.jobActive.value).toBe(true)
  })

  it('sends one request however often confirm is pressed', async () => {
    const merge = await ready()
    let accept!: (response: Response) => void
    respond(MERGE_URL, () => new Promise<Response>((resolve) => (accept = resolve)))

    const first = merge.execute()
    const second = merge.execute()
    expect(merge.inFlight.value).toBe(true)
    await expect(second).resolves.toBe(false)

    accept(jsonResponse({ jobId: 41 }, 202))
    await expect(first).resolves.toBe(true)
    await expect(merge.execute()).resolves.toBe(false)
    expect(calls(MERGE_URL)).toHaveLength(1)
  })

  it('reloads a stale preview and says what changed', async () => {
    const merge = await ready()
    respond(MERGE_URL, () => jsonResponse({ errorCode: 'MERGE_PREVIEW_STALE' }, 409))
    respond(PREVIEW_URL, () =>
      jsonResponse(
        mergePreview({ fields: [mergeField('title', { 1: 'Dune', 2: 'Dune' }, 1), mergeField('publisher', { 1: 'Chilton', 2: 'Gollancz' }, 1)] }),
      ),
    )

    await expect(merge.execute()).resolves.toBe(false)

    expect(previewRequests()).toHaveLength(2)
    expect(merge.staleChanges.value).toEqual([{ kind: 'field', field: 'publisher' }])
    expect(merge.executeError.value).toBe(i18n.global.t('errors.codes.MERGE_PREVIEW_STALE'))
    expect(merge.job.value).toBeNull()
    expect(merge.canExecute.value).toBe(true)
  })

  it('reloads the preview when the server now blocks the merge', async () => {
    const merge = await ready()
    respond(MERGE_URL, () => jsonResponse({ errorCode: 'MERGE_BLOCKED' }, 400))
    respond(PREVIEW_URL, () =>
      jsonResponse(mergePreview({ eligible: false, previewToken: null, blockers: [{ code: 'SOURCE_PROCESSING', bookId: 2 }] })),
    )

    await merge.execute()

    expect(merge.preview.value?.blockers).toEqual([{ code: 'SOURCE_PROCESSING', bookId: 2 }])
    expect(merge.staleChanges.value).toBeNull()
    expect(merge.canExecute.value).toBe(false)
  })

  it.each(['LIBRARY_BUSY', 'MERGE_IN_PROGRESS'])('localizes %s from its code and keeps the preview', async (code) => {
    const merge = await ready()
    respond(MERGE_URL, () => jsonResponse({ errorCode: code, message: 'English server text' }, 409))

    await merge.execute()

    expect(merge.executeError.value).toBe(i18n.global.t(`errors.codes.${code}`))
    expect(previewRequests()).toHaveLength(1)
  })

  it('needs the access-loss acknowledgement again once the warning changes', async () => {
    const warned = (count: number) => mergePreview({ warnings: [{ code: 'LIBRARY_ACCESS_NARROWS', libraryId: 1, count }] })
    const merge = await ready(warned(2))
    expect(merge.accessLossRequired.value).toBe(true)
    expect(merge.canExecute.value).toBe(false)

    merge.setAcknowledgeAccessLoss(true)
    expect(merge.canExecute.value).toBe(true)

    respond(PREVIEW_URL, () => jsonResponse(warned(3)))
    await merge.refreshPreview()
    expect(merge.accessLossAcknowledged.value).toBe(false)
    expect(merge.canExecute.value).toBe(false)
  })

  it('reloads the preview when the server wants the access loss acknowledged', async () => {
    const merge = await ready()
    respond(MERGE_URL, () => jsonResponse({ errorCode: 'ACCESS_LOSS_NOT_ACKNOWLEDGED' }, 409))
    respond(PREVIEW_URL, () => jsonResponse(mergePreview({ warnings: [{ code: 'LIBRARY_ACCESS_NARROWS', libraryId: 1, count: 1 }] })))

    await merge.execute()

    expect(previewRequests()).toHaveLength(2)
    expect(merge.executeError.value).toBe(i18n.global.t('errors.codes.ACCESS_LOSS_NOT_ACKNOWLEDGED'))
    expect(merge.accessLossRequired.value).toBe(true)
    expect(merge.canExecute.value).toBe(false)
  })

  it('falls back to its own wording for a code the catalog does not know', async () => {
    const merge = await ready()
    respond(MERGE_URL, () => jsonResponse({ errorCode: 'SOMETHING_NEW', message: 'English server text' }, 409))

    await merge.execute()

    expect(merge.executeError.value).toBe(i18n.global.t('book.merge.errors.startFailed'))
  })
})

describe('useBookMerge job tracking', () => {
  async function running() {
    const merge = await ready()
    respond(MERGE_URL, () => jsonResponse({ jobId: 41 }, 202))
    await merge.execute()
    return merge
  }

  it('follows socket events for its own job and reads the counts once it finishes', async () => {
    const merge = await running()
    respond(JOB_URL, () => jsonResponse(mergeJob()))

    mocks.progress?.(event({ jobId: 99, processed: 1 }))
    expect(merge.job.value?.processed).toBe(0)

    mocks.progress?.(event({ status: 'moving', processed: 0 }))
    expect(merge.job.value?.status).toBe('moving')

    mocks.finished?.(event({ status: 'done', processed: 1, outcomes: [{ sourceBookId: 2, status: 'merged', errorCode: null }] }))
    await settle()

    expect(merge.jobFinished.value).toBe(true)
    expect(merge.job.value?.result?.movedFileCount).toBe(1)
    expect(calls(JOB_URL)).toHaveLength(1)
  })

  it('keeps the byte counts a cross-drive copy reports, even on events that leave them out', async () => {
    const merge = await running()

    mocks.progress?.(event({ bytesTotal: 2000, bytesDone: 500 }))
    expect(merge.job.value).toMatchObject({ bytesTotal: 2000, bytesDone: 500 })

    mocks.progress?.(event({ status: 'committing' }))
    expect(merge.job.value).toMatchObject({ status: 'committing', bytesTotal: 2000, bytesDone: 500 })
  })

  it('polls the job when no socket event arrives', async () => {
    const merge = await running()
    respond(
      JOB_URL,
      () => jsonResponse(mergeJob({ status: 'moving', processed: 0, outcomes: [], result: null })),
      () => jsonResponse(mergeJob()),
    )

    await vi.advanceTimersByTimeAsync(MERGE_JOB_POLL_MS)
    expect(merge.job.value?.status).toBe('moving')

    await vi.advanceTimersByTimeAsync(MERGE_JOB_POLL_MS)
    expect(merge.job.value?.status).toBe('done')
    expect(merge.jobFinished.value).toBe(true)

    await vi.advanceTimersByTimeAsync(MERGE_JOB_POLL_MS * 2)
    expect(calls(JOB_URL)).toHaveLength(2)
  })

  it('gives up polling after repeated failures until an event arrives', async () => {
    const merge = await running()
    respond(JOB_URL, () => jsonResponse({}, 503))

    await vi.advanceTimersByTimeAsync(MERGE_JOB_POLL_MS * MERGE_JOB_POLL_MAX_FAILURES)
    expect(merge.jobUnreachable.value).toBe(true)
    expect(calls(JOB_URL)).toHaveLength(MERGE_JOB_POLL_MAX_FAILURES)

    await vi.advanceTimersByTimeAsync(MERGE_JOB_POLL_MS * 3)
    expect(calls(JOB_URL)).toHaveLength(MERGE_JOB_POLL_MAX_FAILURES)

    mocks.progress?.(event({ processed: 0 }))
    expect(merge.jobUnreachable.value).toBe(false)
    expect(merge.jobActive.value).toBe(true)
  })
})
