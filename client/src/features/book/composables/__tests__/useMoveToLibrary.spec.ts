// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMovePreviewResult } from '@bookorbit/types'

const fetchMovePreview = vi.fn<(...args: unknown[]) => Promise<BookMovePreviewResult>>()
const executeMove = vi.fn<(...args: unknown[]) => Promise<Response>>()

vi.mock('../../api/book-move', () => ({
  fetchMovePreview: (...args: unknown[]) => fetchMovePreview(...args),
  executeMove: (...args: unknown[]) => executeMove(...args),
}))

const actOnJobs = vi.fn<(request: unknown) => Promise<{ results: { id: string; outcome: string; status: string | null }[] }>>()
const toastInfo = vi.fn<(message: string, options?: unknown) => void>()
const toastError = vi.fn<(message: string, options?: unknown) => void>()

vi.mock('@/features/jobs/api/jobs.api', () => ({ actOnJobs: (request: unknown) => actOnJobs(request) }))
vi.mock('vue-sonner', () => ({
  toast: { info: (...args: [string, unknown?]) => toastInfo(...args), error: (...args: [string, unknown?]) => toastError(...args) },
}))

const { useMoveToLibrary } = await import('../useMoveToLibrary')

const SELECTION = { bookIds: [1, 2] }

function makePreview(overrides: Partial<BookMovePreviewResult> = {}): BookMovePreviewResult {
  return {
    targetLibraryId: 2,
    targetFolderId: 22,
    targetOrganizationMode: 'book_per_folder',
    totalSelected: 2,
    readyCount: 2,
    ready: [],
    alreadyInTargetCount: 0,
    collisionCount: 0,
    collisions: [],
    collisionsTruncated: false,
    ineligibleCount: 0,
    ineligible: [],
    ineligibleTruncated: false,
    warnings: { accessLosers: [], koboImpact: [], layout: null, formatMismatches: [], crossDevice: false },
    requiresReview: false,
    ...overrides,
  }
}

/** Builds a Response whose body streams the given chunks verbatim. */
function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return { ok: true, body, status: 200 } as unknown as Response
}

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

beforeEach(() => {
  fetchMovePreview.mockReset()
  executeMove.mockReset()
  actOnJobs.mockReset()
  toastInfo.mockReset()
  toastError.mockReset()
})

/** A move's answer whose stream the test feeds by hand, naming its run in the header. */
function liveResponse(runId = 'run-9') {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })
  return {
    response: { ok: true, status: 200, body, headers: new Headers({ 'X-Bulk-Run-Id': runId }) } as unknown as Response,
    send: (event: unknown) => controller.enqueue(encoder.encode(sse(event))),
    close: () => controller.close(),
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('preview', () => {
  it('stores the preview result', async () => {
    const preview = makePreview()
    fetchMovePreview.mockResolvedValue(preview)
    const move = useMoveToLibrary()

    const result = await move.loadPreview(SELECTION, 2, 22)

    expect(result).toEqual(preview)
    expect(move.preview.value).toEqual(preview)
    expect(move.previewError.value).toBeNull()
  })

  it('surfaces a preview failure as a message, not a throw', async () => {
    fetchMovePreview.mockRejectedValue(new Error('Editor access is required'))
    const move = useMoveToLibrary()

    const result = await move.loadPreview(SELECTION, 2, 22)

    expect(result).toBeNull()
    expect(move.previewError.value).toBe('Editor access is required')
  })

  it('clears stale overrides when a new destination is previewed', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    const move = useMoveToLibrary()
    move.setOverride(1, 'skip')

    await move.loadPreview(SELECTION, 3, 33)

    expect(move.overrides.value.size).toBe(0)
  })
})

describe('collision policy defaults', () => {
  const collisions = [
    {
      bookId: 1,
      title: 'Duplicate',
      kind: 'hash_duplicate' as const,
      currentPath: '',
      targetPath: '',
      existingBookId: 55,
      suggestedPolicy: 'merge' as const,
      keepBothPath: '',
    },
    {
      bookId: 2,
      title: 'Name clash',
      kind: 'folder_path' as const,
      currentPath: '',
      targetPath: '',
      existingBookId: 66,
      suggestedPolicy: 'keep_both' as const,
      keepBothPath: '',
    },
  ]

  it('defaults to each collision own suggestion', async () => {
    fetchMovePreview.mockResolvedValue(makePreview({ collisionCount: 2, collisions }))
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    expect(move.jobPolicy.value).toBe('suggested')
    // An identical copy merges; a name-only clash keeps both.
    expect(move.effectivePolicy(collisions[0])).toBe('merge')
    expect(move.effectivePolicy(collisions[1])).toBe('keep_both')
  })

  it('sends the suggested policy to the server rather than resolving it locally', async () => {
    fetchMovePreview.mockResolvedValue(makePreview({ collisionCount: 2, collisions }))
    executeMove.mockResolvedValue(
      streamingResponse([sse({ done: true, processed: 0, succeeded: 0, merged: 0, failed: 0, skipped: 0, cancelled: false })]),
    )

    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)
    await move.execute(SELECTION, 2, 22)

    // The preview only carries a bounded sample, so the server resolves suggestions.
    expect(executeMove.mock.calls[0][0]).toMatchObject({ collisionPolicy: 'suggested', overrides: [] })
  })

  it('applies one policy to every collision when the user forces it', async () => {
    fetchMovePreview.mockResolvedValue(makePreview({ collisionCount: 2, collisions }))
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    move.applyPolicyToAll('keep_both')

    expect(move.effectivePolicy(collisions[0])).toBe('keep_both')
    expect(move.effectivePolicy(collisions[1])).toBe('keep_both')
  })

  it('lets a per-book override win over the suggestion', async () => {
    fetchMovePreview.mockResolvedValue(makePreview({ collisionCount: 2, collisions }))
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    move.setOverride(1, 'skip')

    expect(move.effectivePolicy(collisions[0])).toBe('skip')
    expect(move.effectivePolicy(collisions[1])).toBe('keep_both')
  })

  it('counts suggested collisions as movable', async () => {
    fetchMovePreview.mockResolvedValue(makePreview({ readyCount: 1, collisionCount: 2, collisions }))
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    // No suggestion is ever "skip", so all three books move.
    expect(move.movableCount.value).toBe(3)
  })
})

describe('movable count', () => {
  it('counts ready books plus collisions that are not skipped', async () => {
    fetchMovePreview.mockResolvedValue(
      makePreview({
        readyCount: 3,
        collisionCount: 2,
        collisions: [
          {
            bookId: 1,
            title: 'A',
            kind: 'folder_path',
            currentPath: '',
            targetPath: '',
            existingBookId: 9,
            suggestedPolicy: 'keep_both',
            keepBothPath: '',
          },
          {
            bookId: 2,
            title: 'B',
            kind: 'folder_path',
            currentPath: '',
            targetPath: '',
            existingBookId: 9,
            suggestedPolicy: 'keep_both',
            keepBothPath: '',
          },
        ],
      }),
    )
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    expect(move.movableCount.value).toBe(5)

    move.setOverride(1, 'skip')
    expect(move.movableCount.value).toBe(4)

    move.applyPolicyToAll('skip')
    expect(move.movableCount.value).toBe(3)
  })
})

describe('execute', () => {
  it('reports progress per book and keeps the final summary', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    executeMove.mockResolvedValue(
      streamingResponse([
        sse({ bookId: 1, status: 'success' }),
        sse({ bookId: 2, status: 'failed', reason: 'disk full' }),
        sse({ done: true, processed: 2, succeeded: 1, merged: 0, failed: 1, skipped: 0, cancelled: false }),
      ]),
    )

    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)
    const summary = await move.execute(SELECTION, 2, 22)

    expect(summary).toMatchObject({ succeeded: 1, failed: 1 })
    expect(move.progress.value).toMatchObject({ processed: 2, failed: 1 })
    expect(move.step.value).toBe('done')
  })

  it('advances the progress bar as each book lands, not once at the end', async () => {
    fetchMovePreview.mockResolvedValue(makePreview({ readyCount: 3 }))

    const encoder = new TextEncoder()
    let push!: (event: unknown) => void
    let finish!: () => void
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (event) => controller.enqueue(encoder.encode(sse(event)))
        finish = () => controller.close()
      },
    })
    executeMove.mockResolvedValue({ ok: true, status: 200, body } as unknown as Response)

    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    const settled = move.execute(SELECTION, 2, 22)
    const observed: number[] = []

    for (const bookId of [1, 2, 3]) {
      push({ bookId, status: 'success' })
      // Let the reader drain what has been pushed so far.
      await new Promise((resolve) => setTimeout(resolve, 0))
      observed.push(move.progress.value?.processed ?? -1)
    }

    push({ done: true, processed: 3, succeeded: 3, merged: 0, failed: 0, skipped: 0, cancelled: false })
    finish()
    await settled

    // Counter moved after every book rather than jumping straight to 3.
    expect(observed).toEqual([1, 2, 3])
  })

  it('reassembles events split across network chunks', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    const full =
      sse({ bookId: 1, status: 'success' }) + sse({ done: true, processed: 1, succeeded: 1, merged: 0, failed: 0, skipped: 0, cancelled: false })
    // Split mid-token so a per-chunk parser would drop both events.
    executeMove.mockResolvedValue(streamingResponse([full.slice(0, 12), full.slice(12, 40), full.slice(40)]))

    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)
    const summary = await move.execute(SELECTION, 2, 22)

    expect(summary).toMatchObject({ processed: 1, succeeded: 1 })
    expect(move.progress.value?.processed).toBe(1)
  })

  it('ignores a malformed frame without failing the job', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    executeMove.mockResolvedValue(
      streamingResponse([
        'data: {not json}\n\n',
        sse({ bookId: 1, status: 'success' }),
        sse({ done: true, processed: 1, succeeded: 1, merged: 0, failed: 0, skipped: 0, cancelled: false }),
      ]),
    )

    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    expect(await move.execute(SELECTION, 2, 22)).toMatchObject({ succeeded: 1 })
  })

  it('treats a stream that ends without a summary as a failure', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    executeMove.mockResolvedValue(streamingResponse([sse({ bookId: 1, status: 'success' })]))

    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)
    const summary = await move.execute(SELECTION, 2, 22)

    expect(summary).toBeNull()
    expect(move.executeError.value).toBe('The bulk action stopped before it finished.')
    expect(move.step.value).toBe('done')
  })

  it('reports a pre-flight rejection from the server', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    executeMove.mockResolvedValue({
      ok: false,
      status: 409,
      body: null,
      json: async () => ({ message: 'A scan is running for library 1.' }),
    } as unknown as Response)

    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)
    await move.execute(SELECTION, 2, 22)

    expect(move.executeError.value).toBe('A scan is running for library 1.')
    expect(move.step.value).toBe('done')
  })

  it('sends the chosen policy and per-book overrides', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    executeMove.mockResolvedValue(
      streamingResponse([sse({ done: true, processed: 0, succeeded: 0, merged: 0, failed: 0, skipped: 0, cancelled: false })]),
    )

    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)
    move.applyPolicyToAll('merge')
    move.setOverride(7, 'skip')
    await move.execute(SELECTION, 2, 22)

    expect(executeMove.mock.calls[0][0]).toMatchObject({
      selection: SELECTION,
      targetLibraryId: 2,
      targetFolderId: 22,
      collisionPolicy: 'merge',
      overrides: [{ bookId: 7, policy: 'skip' }],
    })
  })

  it('passes an abort signal so the move can be cancelled', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    executeMove.mockResolvedValue(
      streamingResponse([sse({ done: true, processed: 0, succeeded: 0, merged: 0, failed: 0, skipped: 0, cancelled: false })]),
    )

    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)
    await move.execute(SELECTION, 2, 22)

    expect(executeMove.mock.calls[0][1]).toBeInstanceOf(AbortSignal)
  })
})

describe('bulk run', () => {
  it('waits until the first book lands, then shows progress', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    const live = liveResponse()
    executeMove.mockResolvedValue(live.response)
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    const running = move.execute(SELECTION, 2, 22)
    await flush()
    expect(move.waiting.value).toBe(true)
    expect(move.runId.value).toBe('run-9')

    live.send({ bookId: 1, status: 'success' })
    await flush()
    expect(move.waiting.value).toBe(false)
    expect(move.progress.value).toMatchObject({ processed: 1 })

    live.send({ done: true, processed: 2, succeeded: 2, merged: 0, failed: 0, skipped: 0, cancelled: false })
    live.close()
    await running
  })

  it('cancels through Jobs and keeps following until the move says it stopped', async () => {
    actOnJobs.mockResolvedValue({ results: [{ id: 'bulk-run:run-9', outcome: 'done', status: 'running' }] })
    fetchMovePreview.mockResolvedValue(makePreview())
    const live = liveResponse()
    executeMove.mockResolvedValue(live.response)
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    const running = move.execute(SELECTION, 2, 22)
    live.send({ bookId: 1, status: 'success' })
    await flush()
    await move.cancel()

    expect(actOnJobs).toHaveBeenCalledWith({ action: 'cancel', ids: ['bulk-run:run-9'] })
    expect(move.cancelling.value).toBe(true)
    expect(move.step.value).toBe('progress')

    live.send({ done: true, processed: 1, succeeded: 1, merged: 0, failed: 0, skipped: 0, cancelled: true })
    live.close()

    expect(await running).toMatchObject({ cancelled: true, succeeded: 1 })
    expect(move.step.value).toBe('done')
    expect(move.cancelling.value).toBe(false)
  })

  it('says so when the cancel is refused', async () => {
    actOnJobs.mockResolvedValue({ results: [{ id: 'bulk-run:run-9', outcome: 'refused', status: 'running' }] })
    fetchMovePreview.mockResolvedValue(makePreview())
    const live = liveResponse()
    executeMove.mockResolvedValue(live.response)
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    void move.execute(SELECTION, 2, 22)
    await flush()
    await move.cancel()

    expect(move.cancelling.value).toBe(false)
    expect(toastError).toHaveBeenCalledWith('Could not cancel the bulk action.')
  })

  it('says the account already has too many bulk actions on a 429', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    executeMove.mockResolvedValue({
      ok: false,
      status: 429,
      body: null,
      json: async () => ({ message: 'Too many' }),
    } as unknown as Response)
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    await move.execute(SELECTION, 2, 22)

    expect(move.executeError.value).toBe('You already have 10 bulk actions waiting or running. Wait for one to finish, or cancel one in Jobs.')
  })

  it('lets a move in progress go on in the background when the dialog starts over', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    const live = liveResponse()
    executeMove.mockResolvedValue(live.response)
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)

    const running = move.execute(SELECTION, 2, 22)
    await flush()
    move.reset()
    await running

    expect(move.step.value).toBe('destination')
    expect(toastInfo).toHaveBeenCalledWith(
      'The bulk action keeps running in the background.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Open Jobs' }) }),
    )
  })
})

describe('reset', () => {
  it('returns to the destination step and drops previous results', async () => {
    fetchMovePreview.mockResolvedValue(makePreview())
    const move = useMoveToLibrary()
    await move.loadPreview(SELECTION, 2, 22)
    move.setOverride(1, 'skip')
    move.applyPolicyToAll('merge')

    move.reset()

    expect(move.step.value).toBe('destination')
    expect(move.preview.value).toBeNull()
    expect(move.overrides.value.size).toBe(0)
    expect(move.jobPolicy.value).toBe('suggested')
  })
})
