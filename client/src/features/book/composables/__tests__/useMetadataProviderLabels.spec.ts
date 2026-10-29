import { describe, expect, it, vi } from 'vitest'
import { refreshMetadataProviderLabels, useMetadataProviderLabels } from '../useMetadataProviderLabels'

const responses: Array<{ status: number; body?: unknown }> = []

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<unknown>>(() => {
    const next = responses.shift() ?? { status: 500 }
    return Promise.resolve({ ok: next.status < 400, status: next.status, json: () => Promise.resolve(next.body) })
  }),
}))

describe('useMetadataProviderLabels', () => {
  it('asks again after an outage, and picks up providers added later on refresh', async () => {
    responses.push({ status: 503 })
    const { labels } = useMetadataProviderLabels()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(labels.value).toEqual({})

    responses.push({ status: 200, body: [{ key: 'fantlab', label: 'FantLab' }] })
    useMetadataProviderLabels()
    await vi.waitFor(() => expect(labels.value).toEqual({ fantlab: 'FantLab' }))

    responses.push({
      status: 200,
      body: [
        { key: 'fantlab', label: 'FantLab (fantlab:8080)' },
        { key: 'libris', label: 'Libris' },
      ],
    })
    await refreshMetadataProviderLabels()
    expect(labels.value).toEqual({ fantlab: 'FantLab (fantlab:8080)', libris: 'Libris' })
  })
})
