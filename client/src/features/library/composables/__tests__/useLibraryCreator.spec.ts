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
})
