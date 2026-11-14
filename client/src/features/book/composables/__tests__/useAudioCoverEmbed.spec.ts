// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useAudioCoverEmbed } from '../useAudioCoverEmbed'

const toast = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  info: vi.fn<(message: string) => void>(),
  warning: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}))

vi.mock('vue-sonner', () => ({ toast }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, values?: { reason?: string }) => (values?.reason ? `${key}:${values.reason}` : key) }),
}))
vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

function response(ok: boolean, body: unknown = {}): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

describe('useAudioCoverEmbed', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    Object.values(toast).forEach((fn) => fn.mockReset())
  })

  it('posts for the book and announces the outcome by its code', async () => {
    const result = { status: 'success', code: 'embedded', fieldsWritten: ['audioCoverBytes'], durationMs: 3 }
    vi.mocked(api).mockResolvedValue(response(true, result))
    const { embed, embedding } = useAudioCoverEmbed()

    await expect(embed(7)).resolves.toEqual(result)

    expect(api).toHaveBeenCalledWith('/api/v1/books/7/embed-audio-cover', { method: 'POST' })
    expect(toast.success).toHaveBeenCalledWith('book.audioCoverEmbed.results.embedded')
    expect(embedding.value).toBe(false)
  })

  it.each([
    ['unchanged', 'info'],
    ['write_disabled', 'warning'],
    ['failed', 'error'],
  ] as const)('announces %s as %s', async (code, tone) => {
    vi.mocked(api).mockResolvedValue(response(true, { status: 'skipped', code, fieldsWritten: [], durationMs: 1 }))

    await useAudioCoverEmbed().embed(7)

    expect(toast[tone]).toHaveBeenCalledWith(`book.audioCoverEmbed.results.${code}`)
  })

  it('passes the server reason into a failure message', async () => {
    vi.mocked(api).mockResolvedValue(response(true, { status: 'failed', code: 'failed', reason: 'disk full', fieldsWritten: [], durationMs: 1 }))

    await useAudioCoverEmbed().embed(7)

    expect(toast.error).toHaveBeenCalledWith('book.audioCoverEmbed.results.failed:disk full')
  })

  it('reports a request the server refused or that never arrived', async () => {
    vi.mocked(api).mockResolvedValueOnce(response(false))
    const { embed, embedding } = useAudioCoverEmbed()
    await expect(embed(7)).resolves.toBeNull()

    vi.mocked(api).mockRejectedValueOnce(new Error('offline'))
    await expect(embed(7)).resolves.toBeNull()

    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledWith('book.audioCoverEmbed.requestFailed')
    expect(embedding.value).toBe(false)
  })

  it('ignores a second request while one is writing', async () => {
    let finish!: (value: Response) => void
    vi.mocked(api).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { embed } = useAudioCoverEmbed()

    const first = embed(7)
    await expect(embed(7)).resolves.toBeNull()
    finish(response(true, { status: 'success', code: 'embedded', fieldsWritten: [], durationMs: 1 }))
    await first

    expect(api).toHaveBeenCalledTimes(1)
  })
})
