import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Library, PrescanResult } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

describe('useLibraryCreator', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('requires an icon before saving a library', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()

    creator.form.name = 'Main Library'
    creator.form.folders = ['/books']

    await expect(creator.save()).resolves.toBeNull()
    expect(creator.error.value).toBe('Choose an icon')
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('requires a name before saving a library', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()

    creator.form.icon = 'BookOpen'
    creator.form.folders = ['/books']

    await expect(creator.save()).resolves.toBeNull()
    expect(creator.error.value).toBe('Library name is required')
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('does not run prescan without folders', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()

    await creator.runPrescan()

    expect(apiMock).not.toHaveBeenCalled()
    expect(creator.prescanLoading.value).toBe(false)
    expect(creator.prescanResult.value).toBeNull()
  })

  it('stores successful prescan results', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()
    const result: PrescanResult = { paths: [{ path: '/books', accessible: true, fileCount: 2 }], totalFiles: 2 }
    apiMock.mockResolvedValue(jsonResponse(result))

    creator.form.folders = ['/books']

    await creator.runPrescan()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/libraries/prescan',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paths: ['/books'] }),
      }),
    )
    expect(creator.prescanLoading.value).toBe(false)
    expect(creator.prescanResult.value).toEqual(result)
  })

  it('uses audio write-back defaults for blank library forms', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()

    expect(creator.form.fileWriteAudioEnabled).toBe(true)
    expect(creator.form.fileWriteAudioMaxFileSizeMb).toBe(500)
  })

  it('hydrates file rename and audio write settings when editing a library', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()

    creator.initEdit({
      id: 1,
      name: 'Main Library',
      icon: 'BookOpen',
      displayOrder: 0,
      coverAspectRatio: '2/3',
      watch: false,
      autoScanCronExpression: null,
      metadataPrecedence: ['embedded'],
      formatPriority: ['epub'],
      allowedFormats: ['epub'],
      organizationMode: 'book_per_folder',
      excludePatterns: [],
      readingThreshold: 0.25,
      markAsFinishedPercentComplete: 98,
      fileNamingPattern: null,
      fileWriteEnabled: false,
      fileWriteWriteCover: true,
      fileWriteEpubEnabled: true,
      fileWriteEpubMaxFileSizeMb: 100,
      fileWritePdfEnabled: true,
      fileWritePdfMaxFileSizeMb: 100,
      fileWriteCbxEnabled: false,
      fileWriteCbxMaxFileSizeMb: 500,
      fileWriteAudioEnabled: false,
      fileWriteAudioMaxFileSizeMb: 750,
      fileRenameEnabled: true,
      folders: [{ id: 1, path: '/books', createdAt: '2026-01-01T00:00:00.000Z' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(creator.form.fileRenameEnabled).toBe(true)
    expect(creator.form.fileWriteAudioEnabled).toBe(false)
    expect(creator.form.fileWriteAudioMaxFileSizeMb).toBe(750)
  })

  it('creates a library with audio write-back settings in the payload', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()
    const saved = makeLibrary({ id: 9, name: 'Audio' })
    apiMock.mockResolvedValue(jsonResponse(saved, 201))

    creator.form.name = 'Audio'
    creator.form.icon = 'Headphones'
    creator.form.folders = ['/audio']
    creator.form.fileWriteAudioEnabled = true
    creator.form.fileWriteAudioMaxFileSizeMb = 750

    await expect(creator.save()).resolves.toEqual(saved)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/libraries',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    )
    expect(JSON.parse(apiMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      fileWriteAudioEnabled: true,
      fileWriteAudioMaxFileSizeMb: 750,
    })
    expect(creator.loading.value).toBe(false)
  })

  it('updates an existing library and surfaces backend errors', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()
    creator.initEdit(makeLibrary({ id: 12, name: 'Original' }))
    apiMock.mockResolvedValue(jsonResponse({ message: 'Name already exists' }, 409))

    await expect(creator.save()).resolves.toBeNull()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/libraries/12', expect.objectContaining({ method: 'PATCH' }))
    expect(creator.error.value).toBe('Name already exists')
    expect(creator.loading.value).toBe(false)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    id: 1,
    name: 'Main Library',
    icon: 'BookOpen',
    displayOrder: 0,
    coverAspectRatio: '2/3',
    watch: false,
    autoScanCronExpression: null,
    metadataPrecedence: ['embedded'],
    formatPriority: ['epub'],
    allowedFormats: ['epub'],
    organizationMode: 'book_per_folder',
    excludePatterns: [],
    readingThreshold: 0.25,
    markAsFinishedPercentComplete: 98,
    fileNamingPattern: null,
    fileWriteEnabled: false,
    fileWriteWriteCover: true,
    fileWriteEpubEnabled: true,
    fileWriteEpubMaxFileSizeMb: 100,
    fileWritePdfEnabled: true,
    fileWritePdfMaxFileSizeMb: 100,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 500,
    fileWriteAudioEnabled: false,
    fileWriteAudioMaxFileSizeMb: 750,
    fileRenameEnabled: true,
    folders: [{ id: 1, path: '/books', createdAt: '2026-01-01T00:00:00.000Z' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}
