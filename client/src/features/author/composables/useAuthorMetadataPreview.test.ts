import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { AuthorMetadataCandidate, MetadataCandidateCacheInfo } from '@bookorbit/types'
import { useAuthorMetadataPreview } from './useAuthorMetadataPreview'

type CandidateHandler = (candidate: AuthorMetadataCandidate, cache: MetadataCandidateCacheInfo | null) => void

const streamMock = vi.hoisted(() => vi.fn<(params: Record<string, unknown>, onCandidate: CandidateHandler, signal?: AbortSignal) => Promise<void>>())
const lookupMock = vi.hoisted(() => vi.fn<(typeof import('../api/author'))['lookupAuthorMetadata']>())

vi.mock('../api/author', () => ({
  streamAuthorMetadataCandidates: streamMock,
  lookupAuthorMetadata: lookupMock,
}))

function candidate(overrides: Partial<AuthorMetadataCandidate> = {}): AuthorMetadataCandidate {
  return { provider: 'goodreads', providerId: 'g1', name: 'Ursula K. Le Guin', ...overrides } as AuthorMetadataCandidate
}

describe('useAuthorMetadataPreview', () => {
  beforeEach(() => {
    streamMock.mockReset()
    lookupMock.mockReset()
  })

  it('previews the pinned person by id instead of searching by name', async () => {
    const cache = { fetchedAt: '2026-09-01T00:00:00.000Z', stale: false }
    lookupMock.mockResolvedValue({ candidate: candidate({ providerId: '2222', description: 'Scottish novelist.' }), cache })

    const state = useAuthorMetadataPreview(ref('John Reid'), ref({ provider: 'goodreads', providerId: '2222' }))
    await state.load()
    await state.loadFresh()

    expect(streamMock).not.toHaveBeenCalled()
    expect(lookupMock.mock.calls[0]![0]).toEqual({ provider: 'goodreads', providerId: '2222' })
    expect(lookupMock.mock.calls[1]![1]).toEqual(expect.objectContaining({ cache: 'refresh' }))
    expect(state.preview.value?.description).toBe('Scottish novelist.')
    expect(state.previewCache.value).toEqual(cache)
    expect(state.searched.value).toBe(true)
  })

  it('shows no preview when the pinned id matches nobody', async () => {
    lookupMock.mockResolvedValue(null)

    const state = useAuthorMetadataPreview(ref('John Reid'), ref({ provider: 'goodreads', providerId: '2222' }))
    await state.load()

    expect(state.preview.value).toBeNull()
    expect(state.searched.value).toBe(true)
  })

  it('tracks which candidates the cache answered for and which one the preview shows', async () => {
    const older = { fetchedAt: '2026-09-01T00:00:00.000Z', stale: false }
    const newer = { fetchedAt: '2026-10-01T00:00:00.000Z', stale: true }
    streamMock.mockImplementation(async (_params, onCandidate) => {
      onCandidate(candidate({ providerId: 'g1' }), older)
      onCandidate(candidate({ provider: 'audnexus', providerId: 'a1', imageUrl: 'https://example.test/a.jpg' }), newer)
      onCandidate(candidate({ providerId: 'g2' }), null)
    })

    const state = useAuthorMetadataPreview(ref('Ursula K. Le Guin'))
    await state.load()

    expect(streamMock.mock.calls[0]![0]).toEqual({ q: 'Ursula K. Le Guin', region: 'us', limit: 6 })
    expect(state.preview.value?.providerId).toBe('a1')
    expect(state.previewCache.value).toEqual(newer)
    expect(state.cacheSummary.value).toEqual({ cachedCount: 2, staleCount: 1, oldestFetchedAt: older.fetchedAt })
  })

  it('asks for a live search on loadFresh and clears the previous markers', async () => {
    streamMock.mockImplementationOnce(async (_params, onCandidate) => {
      onCandidate(candidate(), { fetchedAt: '2026-09-01T00:00:00.000Z', stale: false })
    })
    streamMock.mockImplementationOnce(async (_params, onCandidate) => {
      onCandidate(candidate(), null)
    })

    const state = useAuthorMetadataPreview(ref('Ursula K. Le Guin'))
    await state.load()
    await state.loadFresh()

    expect(streamMock.mock.calls[1]![0]).toEqual({ q: 'Ursula K. Le Guin', region: 'us', limit: 6, cache: 'refresh' })
    expect(state.previewCache.value).toBeNull()
    expect(state.cacheSummary.value.cachedCount).toBe(0)
  })

  it('marks the lookup searched once it finishes, even with nothing found, and not after a failure', async () => {
    streamMock.mockResolvedValueOnce(undefined)
    streamMock.mockRejectedValueOnce(new Error('offline'))

    const state = useAuthorMetadataPreview(ref('Ursula K. Le Guin'))
    expect(state.searched.value).toBe(false)
    await state.load()
    expect(state.preview.value).toBeNull()
    expect(state.searched.value).toBe(true)

    await state.load()
    expect(state.searched.value).toBe(false)
    expect(state.error.value).toBe('offline')
  })
})
