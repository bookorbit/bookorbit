import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MetadataProviderKey, type BookDetail } from '@bookorbit/types'
import { useMetadataEditor } from '../useMetadataEditor'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>())

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
    updatedAt: null,
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
    communityRatings: [],
    coverSource: null,
    hardcoverEditionId: null,
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
    customMetadata: [],
    lockedFields: [],
    collections: [],
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
    await save(book.id, [])

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    const { metadata } = JSON.parse(String(req.body)) as { metadata: Record<string, unknown> }
    expect(metadata.audioMetadata).toBeUndefined()
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

    const { form, load, save } = useMetadataEditor()
    load(book)
    form.narrators = ['Narrator Two']
    await save(book.id, [])

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(String(req.body)) as {
      metadata: { audioMetadata?: { narrators?: string[]; durationSeconds?: number | null; abridged?: boolean } }
    }
    expect(payload.metadata.audioMetadata).toEqual({
      narrators: ['Narrator Two'],
    })
  })

  it('sends only changed fields in the metadata payload', async () => {
    const book = makeBook({ title: 'Original Title', publisher: 'Original Publisher' })
    apiMock.mockResolvedValue({ ok: true, json: async () => book })

    const { form, load, save } = useMetadataEditor()
    load(book)
    form.publisher = 'Updated Publisher'
    await save(book.id, [])

    const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/books/1/metadata-and-locks?syncFileWrite=true')
    const payload = JSON.parse(String(req.body)) as Record<string, unknown>
    expect(payload).toEqual({
      metadata: { publisher: 'Updated Publisher' },
      lockedFields: [],
    })
  })

  it('sends only changed custom metadata values in the metadata payload', async () => {
    const book = makeBook({
      customMetadata: [
        { fieldId: 7, key: 'original_title', label: 'Original Title', type: 'text', displayOrder: 0, value: null },
        { fieldId: 8, key: 'translated', label: 'Translated', type: 'boolean', displayOrder: 1, value: false },
      ],
    })
    apiMock.mockResolvedValue({ ok: true, json: async () => book })

    const { form, load, save } = useMetadataEditor()
    load(book)
    form.customMetadata[0]!.value = 'Le Comte de Monte-Cristo'
    await save(book.id, [])

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(req.body))).toEqual({
      metadata: {
        customMetadata: [{ fieldId: 7, value: 'Le Comte de Monte-Cristo' }],
      },
      lockedFields: [],
    })
  })

  it('sends changed community rating rows in the metadata payload', async () => {
    const book = makeBook()
    apiMock.mockResolvedValue({ ok: true, json: async () => book })

    const { form, load, save } = useMetadataEditor()
    load(book)
    form.communityRatings = [
      { provider: MetadataProviderKey.HARDCOVER, rating: 4.2, ratingCount: 6, updatedAt: null },
      { provider: MetadataProviderKey.AMAZON, rating: 4.8, ratingCount: 104451, updatedAt: null },
    ]
    await save(book.id, [])

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(req.body))).toEqual({
      metadata: {
        communityRatings: [
          { provider: MetadataProviderKey.HARDCOVER, rating: 4.2, ratingCount: 6 },
          { provider: MetadataProviderKey.AMAZON, rating: 4.8, ratingCount: 104451 },
        ],
      },
      lockedFields: [],
    })
  })

  it('returns the metadata save result from the API response', async () => {
    const book = makeBook({ title: 'Original Title' })
    apiMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        book: { ...book, title: 'Updated Title' },
        write: { status: 'success', fieldsWritten: ['title'], durationMs: 12 },
        libraryAutoWriteEnabled: true,
      }),
    })

    const { form, load, save } = useMetadataEditor()
    load(book)
    form.title = 'Updated Title'
    const result = await save(book.id, [])

    expect(result).toEqual({
      book: { ...book, title: 'Updated Title' },
      write: { status: 'success', fieldsWritten: ['title'], durationMs: 12 },
      libraryAutoWriteEnabled: true,
    })
  })

  it('saves changed metadata and final locks through the atomic endpoint', async () => {
    const book = makeBook({ providerIds: { goodreads: null } })
    apiMock.mockResolvedValue({ ok: true, json: async () => ({ ...book, lockedFields: ['goodreadsId'] }) })

    const { form, load, save } = useMetadataEditor()
    load(book)
    form.goodreadsId = 'manual-goodreads-id'
    await save(book.id, ['goodreadsId'])

    const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/books/1/metadata-and-locks?syncFileWrite=true')
    expect(JSON.parse(String(req.body))).toEqual({
      metadata: { goodreadsId: 'manual-goodreads-id' },
      lockedFields: ['goodreadsId'],
    })
  })

  it('loads and saves Kobo provider IDs', async () => {
    const book = makeBook({ providerIds: { kobo: 'old-kobo-id' } })
    apiMock.mockResolvedValue({ ok: true, json: async () => ({ ...book, providerIds: { kobo: 'new-kobo-id' } }) })

    const { form, load, save } = useMetadataEditor()
    load(book)
    expect(form.koboId).toBe('old-kobo-id')

    form.koboId = 'new-kobo-id'
    await save(book.id, [])

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(req.body))).toEqual({
      metadata: { koboId: 'new-kobo-id' },
      lockedFields: [],
    })
  })

  it('loads and saves Hardcover edition IDs separately from Hardcover book IDs', async () => {
    const book = makeBook({ providerIds: { hardcover: 'old-book-slug' }, hardcoverEditionId: '8941973' })
    apiMock.mockResolvedValue({ ok: true, json: async () => ({ ...book, hardcoverEditionId: '8941974' }) })

    const { form, load, save } = useMetadataEditor()
    load(book)
    expect(form.hardcoverId).toBe('old-book-slug')
    expect(form.hardcoverEditionId).toBe('8941973')

    form.hardcoverEditionId = '8941974'
    await save(book.id, [])

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(req.body))).toEqual({
      metadata: { hardcoverEditionId: '8941974' },
      lockedFields: [],
    })
  })

  it('normalizes a zero page count to null in the save payload', async () => {
    const book = makeBook({ pageCount: 320 })
    apiMock.mockResolvedValue({ ok: true, json: async () => book })

    const { form, load, save } = useMetadataEditor()
    load(book)
    form.pageCount = 0
    await save(book.id, [])

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    const { metadata } = JSON.parse(String(req.body)) as { metadata: Record<string, unknown> }
    expect(metadata.pageCount).toBeNull()
  })

  it('sends a positive page count change unchanged', async () => {
    const book = makeBook({ pageCount: null })
    apiMock.mockResolvedValue({ ok: true, json: async () => book })

    const { form, load, save } = useMetadataEditor()
    load(book)
    form.pageCount = 250
    await save(book.id, [])

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    const { metadata } = JSON.parse(String(req.body)) as { metadata: Record<string, unknown> }
    expect(metadata.pageCount).toBe(250)
  })

  it('omits an unchanged page count when a zero normalizes to the existing null', async () => {
    const book = makeBook({ pageCount: null })
    apiMock.mockResolvedValue({ ok: true, json: async () => book })

    const { form, load, save } = useMetadataEditor()
    load(book)
    form.pageCount = 0
    await save(book.id, [])

    const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
    const { metadata } = JSON.parse(String(req.body)) as { metadata: Record<string, unknown> }
    expect(metadata).not.toHaveProperty('pageCount')
    expect(url).toBe('/api/v1/books/1/metadata-and-locks')
  })

  it('can save lock-only changes through the atomic endpoint without metadata fields', async () => {
    const book = makeBook()
    apiMock.mockResolvedValue({ ok: true, json: async () => ({ ...book, lockedFields: ['title'] }) })

    const { load, save } = useMetadataEditor()
    load(book)
    await save(book.id, ['title'])

    const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/books/1/metadata-and-locks')
    expect(JSON.parse(String(req.body))).toEqual({
      metadata: {},
      lockedFields: ['title'],
    })
  })

  it('reset restores the loaded snapshot and clears the dirty flag', () => {
    const book = makeBook({ title: 'Original Title' })

    const { form, load, reset, isDirty } = useMetadataEditor()
    load(book)
    form.title = 'Changed Title'
    expect(isDirty.value).toBe(true)

    reset()
    expect(form.title).toBe('Original Title')
    expect(isDirty.value).toBe(false)
  })

  it('captures an error message when the save request fails', async () => {
    const book = makeBook()
    apiMock.mockResolvedValue({ ok: false, status: 400 })

    const { load, save, error } = useMetadataEditor()
    load(book)
    const result = await save(book.id, [])

    expect(result).toBeNull()
    expect(error.value).toBe('HTTP 400')
  })
})
