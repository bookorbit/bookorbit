// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookRequestUploadManifest, BookRequestUploadPlan, BookRequestUploadPlanFile, UploadSessionResponse } from '@bookorbit/types'
import type { uploadWithSession } from '@/lib/upload-session'

const { apiMock, uploadMock } = vi.hoisted(() => ({
  apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  uploadMock: vi.fn<typeof uploadWithSession>(),
}))
vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('@/lib/upload-session', () => ({ uploadWithSession: uploadMock }))

import { hasUnsentRequestUploads, plannedUploadFiles, requestUploadSummary, useRequestUpload } from '../composables/useRequestUpload'
import { mergePicked, pickedFromInput, type PickedUploadFile } from '../requestUploadFiles'

const REQUEST_ID = 5
const SENT = { ok: true as const, session: {} as UploadSessionResponse }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function picked(path: string, bytes: number): PickedUploadFile {
  return { file: new File(['x'.repeat(bytes)], path.split('/').pop()!), path }
}

function planFile(path: string, sizeBytes: number, overrides: Partial<BookRequestUploadPlanFile> = {}): BookRequestUploadPlanFile {
  return { path, sizeBytes, format: path.split('.').pop()!, role: 'content', unitIndex: 0, skipReason: null, tooLarge: false, ...overrides }
}

const folder = [picked('Silent/01.mp3', 4), picked('Silent/02.mp3', 4), picked('Silent/.DS_Store', 2)]

const plan: BookRequestUploadPlan = {
  status: 'ready',
  rootName: 'Silent',
  units: [],
  selectedUnitIndex: 0,
  files: [
    planFile('Silent/01.mp3', 4),
    planFile('Silent/02.mp3', 4),
    planFile('Silent/.DS_Store', 2, { role: 'skipped', unitIndex: null, skipReason: 'hidden' }),
  ],
  maxFileSizeBytes: 1024,
}

const manifest: BookRequestUploadManifest = {
  downloadId: 90,
  uploadedByUserId: 3,
  files: [
    { id: 41, path: '01.mp3', sizeBytes: 4, receivedBytes: 0, status: 'pending' },
    { id: 42, path: '02.mp3', sizeBytes: 4, receivedBytes: 0, status: 'pending' },
  ],
}

describe('useRequestUpload', () => {
  let upload: ReturnType<typeof useRequestUpload>

  beforeEach(() => {
    apiMock.mockReset()
    uploadMock.mockReset()
    uploadMock.mockResolvedValue(SENT)
    upload = useRequestUpload(() => true)
  })

  afterEach(() => {
    upload.clear(REQUEST_ID)
  })

  it('asks the server what the picked files come to, by path and size only', async () => {
    apiMock.mockResolvedValueOnce(json(plan))

    await upload.pick(REQUEST_ID, folder)

    const [url, init] = apiMock.mock.calls[0]!
    expect(url).toBe('/api/v1/admin/book-requests/5/upload/plan')
    expect(JSON.parse(String(init?.body))).toEqual({
      files: [
        { path: 'Silent/01.mp3', sizeBytes: 4 },
        { path: 'Silent/02.mp3', sizeBytes: 4 },
        { path: 'Silent/.DS_Store', sizeBytes: 2 },
      ],
    })
    expect(upload.stateFor(REQUEST_ID)?.plan?.status).toBe('ready')
    expect(plannedUploadFiles(upload.stateFor(REQUEST_ID)!).map((file) => file.path)).toEqual(['Silent/01.mp3', 'Silent/02.mp3'])
  })

  it('refuses a pick past the file limit without asking the server', async () => {
    await upload.pick(
      REQUEST_ID,
      Array.from({ length: 2001 }, (_, index) => picked(`f${index}.epub`, 1)),
    )

    expect(apiMock).not.toHaveBeenCalled()
    expect(upload.stateFor(REQUEST_ID)?.planError).toBe('tooMany')
  })

  it('drops a plan that answers after a newer pick replaced its files', async () => {
    let answerFirst: (value: Response) => void = () => {}
    apiMock.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve))).mockResolvedValueOnce(json({ ...plan, status: 'no_book' }))

    const first = upload.pick(REQUEST_ID, folder)
    await upload.pick(REQUEST_ID, [picked('notes.txt', 3)])
    answerFirst(json(plan))
    await first

    expect(upload.stateFor(REQUEST_ID)?.plan?.status).toBe('no_book')
    expect(upload.stateFor(REQUEST_ID)?.planning).toBe(false)
  })

  it('starts the attempt with the planned files and the hold, then sends each to its manifest entry', async () => {
    apiMock.mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json({ request: { id: REQUEST_ID }, upload: manifest }))
    await upload.pick(REQUEST_ID, folder)
    upload.setHold(REQUEST_ID, true)

    const outcome = await upload.start(REQUEST_ID)

    expect(outcome.ok).toBe(true)
    expect(JSON.parse(String(apiMock.mock.calls[1]![1]?.body))).toEqual({
      files: [
        { path: 'Silent/01.mp3', sizeBytes: 4 },
        { path: 'Silent/02.mp3', sizeBytes: 4 },
      ],
      holdForReview: true,
    })
    await vi.waitFor(() => expect(upload.stateFor(REQUEST_ID)?.files.every((file) => file.state === 'done')).toBe(true))
    expect(uploadMock.mock.calls.map(([options]) => [options.filename, options.target, options.file.size])).toEqual([
      ['01.mp3', { kind: 'book_request', requestFileId: 41 }, 4],
      ['02.mp3', { kind: 'book_request', requestFileId: 42 }, 4],
    ])
  })

  it('marks a refused file failed with a reason, and retries it from where it stopped', async () => {
    uploadMock
      .mockResolvedValueOnce({ ok: false, failure: { kind: 'network' }, sessionId: 's1' })
      .mockResolvedValueOnce(SENT)
      .mockResolvedValueOnce(SENT)
    apiMock.mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json({ request: { id: REQUEST_ID }, upload: manifest }))
    await upload.pick(REQUEST_ID, folder)
    await upload.start(REQUEST_ID)

    await vi.waitFor(() => expect(upload.stateFor(REQUEST_ID)?.files[0]?.state).toBe('failed'))
    expect(upload.stateFor(REQUEST_ID)?.files[0]?.error).toBe('connection')
    await vi.waitFor(() => expect(upload.stateFor(REQUEST_ID)?.files[1]?.state).toBe('done'))
    expect(requestUploadSummary(upload.stateFor(REQUEST_ID))).toMatchObject({ here: false, stalledCount: 1, doneCount: 1 })

    upload.retry(REQUEST_ID)
    await vi.waitFor(() => expect(upload.stateFor(REQUEST_ID)?.files[0]?.state).toBe('done'))
    expect(uploadMock.mock.calls[2]![0].resumeKey).toBe('request-upload.90.41')
  })

  it('reads back an upload this page lost, and sends only the files picked again that it still waits for', async () => {
    apiMock.mockResolvedValueOnce(
      json({ upload: { ...manifest, files: [{ ...manifest.files[0]!, status: 'received', receivedBytes: 4 }, manifest.files[1]!] } }),
    )

    await upload.load(REQUEST_ID)
    const state = upload.stateFor(REQUEST_ID)!
    expect(state.files.map((file) => file.state)).toEqual(['done', 'failed'])
    expect(hasUnsentRequestUploads()).toBe(false)

    expect(upload.resume(REQUEST_ID, [picked('elsewhere/unrelated.mp3', 9)])).toBe(0)
    expect(upload.resume(REQUEST_ID, [picked('Desktop/Silent/02.mp3', 4)])).toBe(1)
    await vi.waitFor(() => expect(upload.stateFor(REQUEST_ID)?.files[1]?.state).toBe('done'))
    expect(uploadMock).toHaveBeenCalledTimes(1)
  })

  it('reports a refused start with the server sentence and keeps the picked files', async () => {
    apiMock.mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json({ message: 'Another release already holds this request' }, 409))
    await upload.pick(REQUEST_ID, folder)

    expect(await upload.start(REQUEST_ID)).toEqual({ ok: false, reason: 'Another release already holds this request' })
    expect(upload.stateFor(REQUEST_ID)?.downloadId).toBeNull()
    expect(upload.stateFor(REQUEST_ID)?.picked).toHaveLength(3)
  })
})

describe('requestUploadFiles', () => {
  it('keeps a picked folder path, and a loose file by its name', () => {
    const inFolder = new File(['a'], '01.mp3')
    Object.defineProperty(inFolder, 'webkitRelativePath', { value: 'Silent/01.mp3' })
    const loose = new File(['b'], 'Book.epub')

    expect(pickedFromInput([inFolder, loose]).map((entry) => entry.path)).toEqual(['Silent/01.mp3', 'Book.epub'])
  })

  it('adds new files and replaces one picked again at the same path', () => {
    const first = picked('a.epub', 1)
    const again = picked('a.epub', 2)

    expect(mergePicked([first, picked('b.pdf', 1)], [again]).map((entry) => [entry.path, entry.file.size])).toEqual([
      ['a.epub', 2],
      ['b.pdf', 1],
    ])
  })
})
