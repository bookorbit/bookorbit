import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDetail } from '@projectx/types'
import { useMetadataEditor } from '../useMetadataEditor'

const apiMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 1,
    libraryId: 1,
    libraryName: 'Test Library',
    status: 'present',
    folderPath: '/books',
    addedAt: '2026-01-01T00:00:00.000Z',
    title: 'Test Book',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    coverSource: null,
    providerIds: {},
    authors: [],
    genres: [],
    tags: [],
    files: [
      {
        id: 11,
        format: 'epub',
        role: 'primary',
        sizeBytes: 10,
        absolutePath: '/books/test.epub',
        createdAt: '2026-01-01T00:00:00.000Z',
        filename: 'test.epub',
        durationSeconds: null,
      },
    ],
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    ...overrides,
  }
}

describe('useMetadataEditor', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('omits audioMetadata when book has no audio files', async () => {
    const book = makeBook()
    apiMock.mockResolvedValue({ ok: true, json: async () => book })

    const { load, save } = useMetadataEditor()
    load(book)
    await save(book.id)

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(String(req.body)) as Record<string, unknown>
    expect(payload.audioMetadata).toBeUndefined()
  })

  it('includes audioMetadata when book has audio files', async () => {
    const book = makeBook({
      files: [
        {
          id: 12,
          format: 'm4b',
          role: 'primary',
          sizeBytes: 10,
          absolutePath: '/books/test.m4b',
          createdAt: '2026-01-01T00:00:00.000Z',
          filename: 'test.m4b',
          durationSeconds: 3600,
        },
      ],
      audioMetadata: {
        narrators: [{ id: 2, name: 'Narrator One', sortName: null, displayOrder: 0 }],
        durationSeconds: 3600,
        abridged: false,
        chapters: null,
      },
    })
    apiMock.mockResolvedValue({ ok: true, json: async () => book })

    const { load, save } = useMetadataEditor()
    load(book)
    await save(book.id)

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(String(req.body)) as {
      audioMetadata?: { narrators?: string[]; durationSeconds?: number | null; abridged?: boolean }
    }
    expect(payload.audioMetadata).toEqual({
      narrators: ['Narrator One'],
      durationSeconds: 3600,
      abridged: false,
    })
  })
})
