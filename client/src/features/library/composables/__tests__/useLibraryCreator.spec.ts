import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('hydrates fileRenameEnabled when editing a library', async () => {
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
      fileRenameEnabled: true,
      folders: [{ id: 1, path: '/books', createdAt: '2026-01-01T00:00:00.000Z' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(creator.form.fileRenameEnabled).toBe(true)
  })
})
