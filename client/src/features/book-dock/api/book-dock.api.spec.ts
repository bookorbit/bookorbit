import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

import { api } from '@/lib/api'
import { refetchBookDockMetadata } from './book-dock.api'

const mockApi = vi.mocked(api)

describe('book-dock.api', () => {
  beforeEach(() => {
    mockApi.mockReset()
  })

  it('posts to the dedicated per-file metadata refetch endpoint', async () => {
    mockApi.mockResolvedValue({ ok: true } as Response)

    await expect(refetchBookDockMetadata(42)).resolves.toBe(true)

    expect(mockApi).toHaveBeenCalledWith('/api/v1/book-dock/files/42/refetch-metadata', {
      method: 'POST',
    })
  })

  it('reports a rejected refetch response', async () => {
    mockApi.mockResolvedValue({ ok: false } as Response)

    await expect(refetchBookDockMetadata(42)).resolves.toBe(false)
  })
})
