import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { AuthorDetail, AuthorMetadataCandidate, MetadataCandidateCacheInfo } from '@bookorbit/types'
import { useAuthorMatchPicker } from './useAuthorMatchPicker'

type AuthorApi = typeof import('../api/author')
type CandidateHandler = (candidate: AuthorMetadataCandidate, cache: MetadataCandidateCacheInfo | null) => void

const api = vi.hoisted(() => ({
  streamAuthorMetadataCandidates: vi.fn<(params: Record<string, unknown>, onCandidate: CandidateHandler, signal?: AbortSignal) => Promise<void>>(),
  lookupAuthorMetadata: vi.fn<AuthorApi['lookupAuthorMetadata']>(),
  pinAuthorMetadataMatch: vi.fn<AuthorApi['pinAuthorMetadataMatch']>(),
  unpinAuthorMetadataMatch: vi.fn<AuthorApi['unpinAuthorMetadataMatch']>(),
}))

vi.mock('../api/author', () => api)

function candidate(overrides: Partial<AuthorMetadataCandidate> = {}): AuthorMetadataCandidate {
  return { provider: 'goodreads', providerId: '1111', name: 'John Reid', ...overrides } as AuthorMetadataCandidate
}

function author(overrides: Partial<AuthorDetail> = {}): AuthorDetail {
  return {
    id: 9,
    name: 'John Reid',
    sortName: null,
    description: null,
    imageUrl: null,
    bookCount: 3,
    lastAddedAt: null,
    birthDate: null,
    birthYear: null,
    deathDate: null,
    deathYear: null,
    website: null,
    genres: [],
    influences: [],
    metadataProvider: null,
    metadataProviderId: null,
    metadataProviderPinned: false,
    ...overrides,
  }
}

describe('useAuthorMatchPicker', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset()
  })

  it('searches by the author name and keeps every distinct candidate', async () => {
    api.streamAuthorMetadataCandidates.mockImplementation(async (_params, onCandidate) => {
      onCandidate(candidate({ providerId: '1111' }), null)
      onCandidate(candidate({ providerId: '2222' }), { fetchedAt: '2026-09-01T00:00:00.000Z', stale: false })
      onCandidate(candidate({ providerId: '1111' }), null)
    })

    const picker = useAuthorMatchPicker(ref(author()))
    await picker.search()

    expect(api.streamAuthorMetadataCandidates.mock.calls[0]![0]).toEqual({ q: 'John Reid', region: 'us', limit: 10 })
    expect(picker.rows.value.map((row) => row.key)).toEqual(['goodreads:1111', 'goodreads:2222'])
    expect(picker.cacheSummary.value.cachedCount).toBe(1)
    expect(picker.searched.value).toBe(true)
  })

  it('asks for a live search when searching fresh', async () => {
    api.streamAuthorMetadataCandidates.mockResolvedValue(undefined)

    const picker = useAuthorMatchPicker(ref(author()))
    await picker.searchFresh()

    expect(api.streamAuthorMetadataCandidates.mock.calls[0]![0]).toEqual(expect.objectContaining({ cache: 'refresh' }))
  })

  it('reports a failed search without throwing', async () => {
    api.streamAuthorMetadataCandidates.mockRejectedValue(new Error('offline'))

    const picker = useAuthorMatchPicker(ref(author()))
    await picker.search()

    expect(picker.searchFailed.value).toBe(true)
    expect(picker.searching.value).toBe(false)
  })

  it('fills a selected search row in from a lookup by id', async () => {
    api.streamAuthorMetadataCandidates.mockImplementation(async (_params, onCandidate) => {
      onCandidate(candidate({ providerId: '2222' }), null)
    })
    api.lookupAuthorMetadata.mockResolvedValue({
      candidate: candidate({ providerId: '2222', description: 'Scottish novelist.', birthYear: 1965 }),
      cache: null,
    })

    const picker = useAuthorMatchPicker(ref(author()))
    await picker.search()
    picker.select(picker.rows.value[0]!)
    await vi.waitFor(() => expect(picker.selected.value?.candidate.description).toBe('Scottish novelist.'))

    expect(api.lookupAuthorMetadata).toHaveBeenCalledWith(expect.objectContaining({ provider: 'goodreads', providerId: '2222' }))
    expect(picker.selected.value?.candidate.birthYear).toBe(1965)
  })

  it('looks a pasted link up and selects it', async () => {
    api.lookupAuthorMetadata.mockResolvedValue({ candidate: candidate({ providerId: '3333', name: 'John Reid' }), cache: null })

    const picker = useAuthorMatchPicker(ref(author()))
    picker.reference.value = 'https://www.goodreads.com/author/show/3333.John_Reid'
    await picker.lookUpReference()

    expect(api.lookupAuthorMetadata).toHaveBeenCalledWith({ provider: 'goodreads', providerId: '3333' })
    expect(picker.selectedKey.value).toBe('goodreads:3333')
    expect(picker.rows.value[0]?.key).toBe('goodreads:3333')
    expect(picker.reference.value).toBe('')
  })

  it.each([
    ['not a link', null, 'unrecognised'],
    ['3333', null, 'notFound'],
    ['3333', new Error('offline'), 'failed'],
  ])('reports %j as %s', async (input, lookup, error) => {
    if (lookup instanceof Error) api.lookupAuthorMetadata.mockRejectedValue(lookup)
    else api.lookupAuthorMetadata.mockResolvedValue(lookup)

    const picker = useAuthorMatchPicker(ref(author()))
    picker.reference.value = input
    await picker.lookUpReference()

    expect(picker.referenceError.value).toBe(error)
    expect(picker.selectedKey.value).toBeNull()
  })

  it('leads with the current match even when the search does not return it', async () => {
    api.lookupAuthorMetadata.mockResolvedValue({ candidate: candidate({ providerId: '9999' }), cache: null })
    api.streamAuthorMetadataCandidates.mockImplementation(async (_params, onCandidate) => {
      onCandidate(candidate({ providerId: '2222' }), null)
      onCandidate(candidate({ providerId: '9999' }), null)
    })

    const picker = useAuthorMatchPicker(ref(author({ metadataProvider: 'goodreads', metadataProviderId: '9999' })))
    await picker.loadCurrent()
    await picker.search()

    expect(picker.currentKey.value).toBe('goodreads:9999')
    expect(picker.rows.value.map((row) => row.key)).toEqual(['goodreads:9999', 'goodreads:2222'])
  })

  it('finishes loading the current match when its stored id no longer resolves', async () => {
    api.lookupAuthorMetadata.mockResolvedValue(null)

    const picker = useAuthorMatchPicker(ref(author({ metadataProvider: 'goodreads', metadataProviderId: '9999', metadataProviderPinned: true })))
    await picker.loadCurrent()

    expect(picker.current.value).toBeNull()
    expect(picker.currentLookupComplete.value).toBe(true)
  })

  it('pins the chosen candidate for this author', async () => {
    api.pinAuthorMetadataMatch.mockResolvedValue(author({ metadataProviderPinned: true }))

    const picker = useAuthorMatchPicker(ref(author()))
    await picker.pin({ key: 'audnexus:B001H6UH2C', candidate: candidate({ provider: 'audnexus', providerId: 'B001H6UH2C' }), cache: null })

    expect(api.pinAuthorMetadataMatch).toHaveBeenCalledWith(9, { provider: 'audnexus', providerId: 'B001H6UH2C' })
  })
})
