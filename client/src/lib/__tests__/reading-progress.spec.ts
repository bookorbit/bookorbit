// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingProgressEntry } from '@bookorbit/types'

vi.mock('@/lib/api', () => ({ api: vi.fn<(...args: unknown[]) => unknown>() }))

import { api } from '@/lib/api'
import { clearReadingProgress, fetchBookProgress, fetchFileProgress, flattenReadingProgress, saveReadingProgress } from '../reading-progress'

const mockApi = vi.mocked(api)

const entry: ReadingProgressEntry = {
  fileId: 64,
  percentage: 7.99,
  updatedAt: '2026-10-22T09:30:00.000Z',
  text: { cfi: 'epubcfi(/6/22!/4/108/1:0)', page: null, updatedAt: '2026-10-22T09:30:00.000Z' },
  narration: { seconds: 812.4, fragment: 'c9R.xhtml#s12', sectionIndex: 9, percentage: 6, updatedAt: '2026-10-21T09:00:00.000Z' },
  kobo: { source: 'OEBPS/c9R.xhtml', type: 'KoboSpan', value: 'kobo.12.3', contentPercent: 50 },
  koreader: '/body/DocFragment[10]/body/p[3]',
}

function okJson(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

describe('reading progress client', () => {
  beforeEach(() => {
    mockApi.mockReset()
  })

  it('flattens a grouped entry into the fields the readers work in', () => {
    expect(flattenReadingProgress(entry)).toEqual({
      fileId: 64,
      percentage: 7.99,
      updatedAt: '2026-10-22T09:30:00.000Z',
      cfi: 'epubcfi(/6/22!/4/108/1:0)',
      pageNumber: null,
      textUpdatedAt: '2026-10-22T09:30:00.000Z',
      positionSeconds: 812.4,
      mediaOverlayFragment: 'c9R.xhtml#s12',
      mediaOverlaySectionIndex: 9,
      narrationPercentage: 6,
      narrationUpdatedAt: '2026-10-21T09:00:00.000Z',
      koboLocationSource: 'OEBPS/c9R.xhtml',
      koboLocationType: 'KoboSpan',
      koboLocationValue: 'kobo.12.3',
      koboContentSourceProgressPercent: 50,
      koreaderProgress: '/body/DocFragment[10]/body/p[3]',
    })
  })

  it('reads one file, and answers null when the server does not', async () => {
    mockApi.mockResolvedValueOnce(okJson({ items: [entry] }))
    expect((await fetchFileProgress(64))?.cfi).toBe('epubcfi(/6/22!/4/108/1:0)')
    expect(mockApi).toHaveBeenCalledWith('/api/v1/reading-progress?fileId=64')

    mockApi.mockResolvedValueOnce({ ok: false } as Response)
    expect(await fetchFileProgress(64)).toBeNull()
  })

  it('reads every file of a book', async () => {
    mockApi.mockResolvedValueOnce(okJson({ items: [entry, { ...entry, fileId: 65 }] }))
    expect((await fetchBookProgress(60))?.map((row) => row.fileId)).toEqual([64, 65])
    expect(mockApi).toHaveBeenCalledWith('/api/v1/reading-progress?bookId=60')
  })

  it('puts one write and deletes one file', async () => {
    mockApi.mockResolvedValue(okJson({}))
    await saveReadingProgress({ fileId: 64, kind: 'text', percentage: 8, text: { cfi: 'epubcfi(/6/2)' } })
    expect(mockApi).toHaveBeenCalledWith('/api/v1/reading-progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: [{ fileId: 64, kind: 'text', percentage: 8, text: { cfi: 'epubcfi(/6/2)' } }] }),
    })

    await clearReadingProgress(64)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/reading-progress/64', { method: 'DELETE' })
  })
})
