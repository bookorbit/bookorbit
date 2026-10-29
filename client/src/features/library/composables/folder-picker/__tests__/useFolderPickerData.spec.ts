// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderSummary } from '@bookorbit/types'
import { useFolderPickerData } from '../useFolderPickerData'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

function summary(path: string, files: number): FolderSummary {
  return { path, state: 'ok', files, folderBooks: files, formats: {}, folders: 0, mergedFolders: 0, splitAudioFolders: 0, truncated: false }
}

describe('useFolderPickerData', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches counts for rows that appear together into one request, and never asks twice', async () => {
    apiMock.mockImplementation((_url, init) => json((JSON.parse(String(init?.body)).paths as string[]).map((path) => summary(path, 3))))
    const data = useFolderPickerData()

    data.requestSummaries(['/books/a', '/books/b'])
    data.requestSummaries(['/books/b/', '/books/c'])
    await vi.advanceTimersByTimeAsync(60)
    data.requestSummaries(['/books/a'])
    await vi.advanceTimersByTimeAsync(60)

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(apiMock.mock.calls[0]![1]!.body))).toEqual({ paths: ['/books/a', '/books/b', '/books/c'] })
    expect(data.summaries.get('/books/c')?.files).toBe(3)
  })

  it('asks again for counts a failed batch did not return', async () => {
    apiMock
      .mockImplementationOnce(() => json({}, 500))
      .mockImplementation((_url, init) => json((JSON.parse(String(init?.body)).paths as string[]).map((path) => summary(path, 1))))
    const data = useFolderPickerData()

    data.requestSummaries(['/books/a'])
    await vi.advanceTimersByTimeAsync(60)
    data.requestSummaries(['/books/a'])
    await vi.advanceTimersByTimeAsync(60)

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(data.summaries.has('/books/a')).toBe(true)
  })

  it('lists a folder once however often it is asked for', async () => {
    apiMock.mockImplementation(() => json({ path: '/books', state: 'ok', entries: [] }))
    const data = useFolderPickerData()

    await Promise.all([data.ensureListing('/books'), data.ensureListing('/books/')])
    await data.ensureListing('/books')

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith('/api/v1/path/listing?path=%2Fbooks')
  })

  it('treats a refused listing as blocked rather than empty', async () => {
    apiMock.mockImplementation(() => json({ message: 'outside' }, 403))
    const data = useFolderPickerData()

    await expect(data.ensureListing('/outside')).resolves.toEqual({ path: '/outside', state: 'blocked', entries: [], truncated: false })
  })

  it('asks again, a little later, for counts the server had no time for', async () => {
    let calls = 0
    apiMock.mockImplementation((_url, init) => {
      calls += 1
      const paths = JSON.parse(String(init?.body)).paths as string[]
      return json(paths.map((path) => (calls === 1 ? { ...summary(path, 0), state: 'pending' } : summary(path, 7))))
    })
    const data = useFolderPickerData()

    data.requestSummaries(['/books/slow'])
    await vi.advanceTimersByTimeAsync(60)
    expect(data.summaries.has('/books/slow')).toBe(false)

    await vi.advanceTimersByTimeAsync(400)
    expect(data.summaries.get('/books/slow')?.files).toBe(7)
  })

  it('runs only a few inspections at once, and stops waiting on one that failed', async () => {
    const releases: Array<() => void> = []
    apiMock.mockImplementation(
      (url) =>
        new Promise((resolve) =>
          releases.push(() => resolve(String(url).includes('bad') ? new Response('{}', { status: 500 }) : new Response('{}'))),
        ),
    )
    const data = useFolderPickerData()

    const requests = ['/a', '/b', '/bad', '/d', '/e'].map((path) => data.ensureInspection(path))
    await vi.advanceTimersByTimeAsync(0)
    expect(apiMock).toHaveBeenCalledTimes(3)

    releases.shift()!()
    await vi.advanceTimersByTimeAsync(0)
    expect(apiMock).toHaveBeenCalledTimes(4)

    while (releases.length) {
      releases.shift()!()
      await vi.advanceTimersByTimeAsync(0)
    }
    await Promise.all(requests)
    expect(data.failedInspections.has('/bad')).toBe(true)
  })

  it('asks for system folders too when they are shown', async () => {
    apiMock.mockImplementation(() => json({ results: [], truncated: false }))
    const data = useFolderPickerData()

    await data.searchFolders('lib', undefined, true)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/path/search?q=lib&system=true', { signal: undefined })
  })

  it('maps folder creation failures to reasons, and asks again for the counts above the new folder', async () => {
    const data = useFolderPickerData()
    data.summaries.set('/books', summary('/books', 5))
    data.summaries.set('/media', summary('/media', 9))
    apiMock.mockImplementationOnce(() => json({}, 409)).mockImplementationOnce(() => json({}, 403))

    await expect(data.createFolder('/books', 'New')).resolves.toEqual({ error: 'exists' })
    await expect(data.createFolder('/books', 'New')).resolves.toEqual({ error: 'denied' })

    apiMock.mockImplementation((url, init) =>
      init?.method === 'POST' ? json({ name: 'New', path: '/books/New' }) : json({ path: '/books', state: 'ok', entries: [] }),
    )
    await expect(data.createFolder('/books/', 'New')).resolves.toEqual({ path: '/books/New' })
    expect(JSON.parse(String(apiMock.mock.calls.find(([, init]) => init?.method === 'POST' && String(init.body).includes('New'))![1]!.body))).toEqual(
      { parentPath: '/books', name: 'New' },
    )
    expect([...data.summaries.keys()]).toEqual(['/media'])
    apiMock.mockImplementation((_url, init) => json((JSON.parse(String(init?.body)).paths as string[]).map((path) => summary(path, 6))))
    await vi.advanceTimersByTimeAsync(60)
    expect(data.summaries.get('/books')?.files).toBe(6)
  })
})
