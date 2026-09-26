import { beforeEach, describe, expect, it, vi } from 'vitest'
import { READ_ALONG_FORMAT_PRIORITY } from '@bookorbit/types'
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
    expect(creator.error.value).toBe('Choose an icon.')
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('requires a name before saving a library', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()

    creator.form.icon = 'BookOpen'
    creator.form.folders = ['/books']

    await expect(creator.save()).resolves.toBeNull()
    expect(creator.error.value).toBe('Enter a library name.')
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

  it('includes the current library ID when prescanning an edit', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()
    const result: PrescanResult = { paths: [{ path: '/books', accessible: true, fileCount: 2 }], totalFiles: 2 }
    apiMock.mockResolvedValue(jsonResponse(result))
    creator.initEdit(makeLibrary({ id: 12 }))

    await creator.runPrescan()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/libraries/prescan',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paths: ['/books'], libraryId: 12 }),
      }),
    )
  })

  it('surfaces prescan connection failures', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()
    apiMock.mockRejectedValue(new TypeError('network error'))

    creator.form.folders = ['/books']
    await creator.runPrescan()

    expect(creator.error.value).toBe('Could not connect to the server to scan folders.')
    expect(creator.prescanLoading.value).toBe(false)
  })

  it('validates cron expressions and file size limits before saving', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()
    creator.form.name = 'Main Library'
    creator.form.icon = 'BookOpen'
    creator.form.folders = ['/books']
    creator.form.autoScanCronExpression = 'not a cron'

    expect(creator.validationErrors.value.schedule).toBe('Enter a valid 5-field cron expression.')
    await expect(creator.save()).resolves.toBeNull()
    expect(apiMock).not.toHaveBeenCalled()

    creator.form.autoScanCronExpression = null
    creator.form.fileWritePdfMaxFileSizeMb = 10_001
    expect(creator.validationErrors.value.fileWrite).toBe('File-size limits must be whole numbers from 1 to 10,000 MB.')
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
      type: 'books',
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
      addedAtSource: 'imported',
      excludePatterns: [],
      readingThreshold: 0.25,
      markAsFinishedPercentComplete: 98,
      fileNamingPattern: null,
      fileWriteEnabled: false,
      fileWriteWriteCover: true,
      fileWriteEpubEnabled: true,
      fileWriteEpubMaxFileSizeMb: 100,
      fileWriteFb2Enabled: false,
      fileWriteFb2MaxFileSizeMb: 100,
      fileWritePdfEnabled: true,
      fileWritePdfMaxFileSizeMb: 100,
      fileWriteCbxEnabled: false,
      fileWriteCbxMaxFileSizeMb: 500,
      fileWriteKindleEnabled: false,
      fileWriteKindleMaxFileSizeMb: 100,
      fileWriteAudioEnabled: false,
      fileWriteAudioMaxFileSizeMb: 750,
      fileRenameEnabled: true,
      folders: [{ id: 1, path: '/books', role: 'downloads' as const, createdAt: '2026-01-01T00:00:00.000Z' }],
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
    const payload = JSON.parse(apiMock.mock.calls[0]?.[1]?.body as string)
    expect(payload).toMatchObject({
      name: 'Audio',
      fileWriteAudioEnabled: true,
      fileWriteAudioMaxFileSizeMb: 750,
    })
    expect(payload).not.toHaveProperty('localFolders')
    expect(payload).not.toHaveProperty('watchLocalFolders')
    expect(creator.loading.value).toBe(false)
  })

  it('sends the podcast local-folder watcher setting without book automation fields', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()
    const saved = makeLibrary({ id: 13, type: 'podcasts', name: 'Podcasts', watchLocalFolders: false })
    apiMock.mockResolvedValue(jsonResponse(saved, 201))

    creator.form.type = 'podcasts'
    creator.form.name = 'Podcasts'
    creator.form.icon = 'Podcast'
    creator.form.folders = ['/podcasts/downloads']
    creator.form.localFolders = ['/podcasts/local']
    creator.form.watchLocalFolders = false

    await expect(creator.save()).resolves.toEqual(saved)

    const payload = JSON.parse(apiMock.mock.calls[0]?.[1]?.body as string)
    expect(payload).toMatchObject({
      type: 'podcasts',
      localFolders: ['/podcasts/local'],
      watchLocalFolders: false,
    })
    expect(payload).not.toHaveProperty('watch')
    expect(payload).not.toHaveProperty('autoScanCronExpression')
  })

  it('trims user-entered values and surfaces save connection failures', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()
    const saved = makeLibrary({ name: 'Main Library' })
    apiMock.mockResolvedValueOnce(jsonResponse(saved, 201))
    creator.form.name = '  Main Library  '
    creator.form.icon = '  BookOpen  '
    creator.form.folders = [' /books ', '/books']

    await creator.save()

    const payload = JSON.parse(apiMock.mock.calls[0]?.[1]?.body as string)
    expect(payload).toMatchObject({ name: 'Main Library', icon: 'BookOpen', folders: ['/books'] })

    apiMock.mockRejectedValueOnce(new TypeError('network error'))
    await expect(creator.save()).resolves.toBeNull()
    expect(creator.error.value).toBe('Could not connect to the server. Check your connection and try again.')
    expect(creator.loading.value).toBe(false)
  })

  it('updates an existing library and surfaces backend errors', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()
    creator.initEdit(makeLibrary({ id: 12, name: 'Original' }))
    apiMock.mockResolvedValue(jsonResponse({ message: 'Name already exists' }, 409))

    await expect(creator.save()).resolves.toBeNull()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/libraries/12', expect.objectContaining({ method: 'PATCH' }))
    expect(JSON.parse(apiMock.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty('type')
    expect(creator.error.value).toBe('Name already exists')
    expect(creator.loading.value).toBe(false)
  })

  it('shows the read-along entry above EPUB and saves it only once it is moved', async () => {
    const { useLibraryCreator } = await import('../useLibraryCreator')
    const creator = useLibraryCreator()
    creator.initEdit(makeLibrary({ id: 12, formatPriority: ['m4b', 'epub', 'pdf'] }))
    apiMock.mockResolvedValue(jsonResponse(makeLibrary({ id: 12 })))

    expect(creator.form.formatPriority.slice(0, 4)).toEqual(['m4b', READ_ALONG_FORMAT_PRIORITY, 'epub', 'pdf'])

    await creator.save()
    const unmoved = JSON.parse(apiMock.mock.calls[0]?.[1]?.body as string).formatPriority as string[]
    expect(unmoved.slice(0, 3)).toEqual(['m4b', 'epub', 'pdf'])
    expect(unmoved).not.toContain(READ_ALONG_FORMAT_PRIORITY)

    creator.form.formatPriority = [
      READ_ALONG_FORMAT_PRIORITY,
      ...creator.form.formatPriority.filter((format) => format !== READ_ALONG_FORMAT_PRIORITY),
    ]
    await creator.save()
    const moved = JSON.parse(apiMock.mock.calls[1]?.[1]?.body as string).formatPriority as string[]
    expect(moved.slice(0, 3)).toEqual([READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub'])
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
    type: 'books',
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
    addedAtSource: 'imported',
    excludePatterns: [],
    readingThreshold: 0.25,
    markAsFinishedPercentComplete: 98,
    fileNamingPattern: null,
    fileWriteEnabled: false,
    fileWriteWriteCover: true,
    fileWriteEpubEnabled: true,
    fileWriteEpubMaxFileSizeMb: 100,
    fileWriteFb2Enabled: false,
    fileWriteFb2MaxFileSizeMb: 100,
    fileWritePdfEnabled: true,
    fileWritePdfMaxFileSizeMb: 100,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 500,
    fileWriteKindleEnabled: false,
    fileWriteKindleMaxFileSizeMb: 100,
    fileWriteAudioEnabled: false,
    fileWriteAudioMaxFileSizeMb: 750,
    fileRenameEnabled: true,
    folders: [{ id: 1, path: '/books', role: 'downloads' as const, createdAt: '2026-01-01T00:00:00.000Z' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}
