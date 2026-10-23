// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>())
vi.mock('@/lib/api', () => ({ api }))

import { useBookDockDetail } from '../useBookDockDetail'

describe('useBookDockDetail.fetchReadAlong', () => {
  beforeEach(() => api.mockReset())

  it('asks the file read that opens the EPUB, and reads its answer', async () => {
    api.mockResolvedValue({ ok: true, json: async () => ({ id: 4, readAlong: true }) } as Response)

    await expect(useBookDockDetail().fetchReadAlong(4)).resolves.toBe(true)
    expect(api).toHaveBeenCalledWith('/api/v1/book-dock/files/4?readAlong=true')
  })

  it('answers no when the read fails, so the search still goes out as an ebook', async () => {
    api.mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
    await expect(useBookDockDetail().fetchReadAlong(4)).resolves.toBe(false)

    api.mockRejectedValueOnce(new TypeError('network down'))
    await expect(useBookDockDetail().fetchReadAlong(4)).resolves.toBe(false)
  })
})
