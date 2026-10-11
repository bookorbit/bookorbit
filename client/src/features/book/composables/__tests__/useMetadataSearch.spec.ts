import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import {
  METADATA_PROVIDER_STATUS_EVENT,
  MetadataProviderKey,
  type MetadataCandidate,
  type MetadataCandidateCacheInfo,
  type MetadataProviderInfo,
  type MetadataProviderSearchOutcome,
} from '@bookorbit/types'
import { useMetadataSearch } from '../useMetadataSearch'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

describe('useMetadataSearch', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  function provider(key: MetadataProviderKey, selectedByFieldRules?: boolean, coverPriority?: number): MetadataProviderInfo {
    return {
      key,
      label: key,
      identifiable: true,
      ...(selectedByFieldRules !== undefined ? { selectedByFieldRules } : {}),
      ...(coverPriority !== undefined ? { coverPriority } : {}),
    }
  }

  function candidate(providerKey: MetadataProviderKey, providerId: string): MetadataCandidate {
    return {
      provider: providerKey,
      providerId,
      title: `${providerKey} ${providerId}`,
    }
  }

  function streamResponse(chunks: string[]): Response {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })

    return { ok: true, body: stream } as Response
  }

  function event(data: unknown): string {
    return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`
  }

  function statusEvent(providerKey: MetadataProviderKey, outcome: MetadataProviderSearchOutcome): string {
    return `event: ${METADATA_PROVIDER_STATUS_EVENT}\ndata: ${JSON.stringify({ provider: providerKey, outcome })}\n\n`
  }

  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('loads globally available providers when no book is provided', async () => {
    apiMock.mockResolvedValue({ ok: true, json: async () => [provider(MetadataProviderKey.GOOGLE)] })

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.loadProviders()
    scope.stop()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/metadata-fetch/providers')
    expect(state.providers.value).toEqual([provider(MetadataProviderKey.GOOGLE)])
    expect(state.selectedProviders.value).toEqual([MetadataProviderKey.GOOGLE])
  })

  it('loads providers scoped to the current book', async () => {
    apiMock.mockResolvedValue({ ok: true, json: async () => [] })

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.loadProviders(42)
    scope.stop()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/metadata-fetch/providers?bookId=42')
  })

  it('selects all loaded providers by default and can switch to field rule providers', async () => {
    apiMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [provider(MetadataProviderKey.GOOGLE, true), provider(MetadataProviderKey.LUBIMYCZYTAC, false)],
      })
      .mockResolvedValueOnce({ ok: false })

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.loadProviders(42)

    expect(state.selectedProviders.value).toEqual([MetadataProviderKey.GOOGLE, MetadataProviderKey.LUBIMYCZYTAC])

    state.selectFieldRuleProviders()
    expect(state.selectedProviders.value).toEqual([MetadataProviderKey.GOOGLE])

    state.selectAllProviders()
    await state.search({ title: 'Dune', bookId: 42, isAudiobook: false })
    scope.stop()

    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/metadata-fetch/stream?title=Dune&bookId=42&isAudiobook=false&providers=google%2Clubimyczytac', {
      signal: expect.any(AbortSignal),
    })
  })

  it('exposes the configured cover provider order independently of registry order', async () => {
    apiMock.mockResolvedValue({
      ok: true,
      json: async () => [
        provider(MetadataProviderKey.GOOGLE, undefined, 2),
        provider(MetadataProviderKey.OPEN_LIBRARY, undefined, 1),
        provider(MetadataProviderKey.AMAZON, undefined, 0),
      ],
    })

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.loadProviders()
    scope.stop()

    expect(state.coverProviderOrder.value).toEqual([MetadataProviderKey.AMAZON, MetadataProviderKey.OPEN_LIBRARY, MetadataProviderKey.GOOGLE])
  })

  it('includes bookId in metadata stream searches', async () => {
    apiMock.mockResolvedValue({ ok: false })

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    state.selectedProviders.value = [MetadataProviderKey.GOOGLE]
    await state.search({ title: 'Dune', bookId: 42, isAudiobook: false })
    scope.stop()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/metadata-fetch/stream?title=Dune&bookId=42&isAudiobook=false&providers=google', {
      signal: expect.any(AbortSignal),
    })
    expect(state.isStreaming.value).toBe(false)
  })

  it('requests the sole available provider when no provider filter is selected', async () => {
    apiMock.mockResolvedValue({ ok: false })

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    state.providers.value = [provider(MetadataProviderKey.AUDIBLE)]
    await state.search({ title: 'Confessor', author: 'Terry Goodkind', bookId: 42, isAudiobook: false })
    scope.stop()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/metadata-fetch/stream?title=Confessor&author=Terry+Goodkind&bookId=42&isAudiobook=false&providers=audible',
      {
        signal: expect.any(AbortSignal),
      },
    )
  })

  it('records a provider that stopped early instead of counting it as a result', async () => {
    apiMock.mockResolvedValue(streamResponse([statusEvent(MetadataProviderKey.COMICVINE, 'timeout')]))

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.search({ title: 'Amazing Spider-Man' })
    scope.stop()

    expect(state.filteredResults.value).toEqual([])
    expect(state.providerCounts[MetadataProviderKey.COMICVINE]).toBeUndefined()
    expect(state.interruptedProviders.value).toEqual([{ provider: MetadataProviderKey.COMICVINE, outcome: 'timeout' }])
  })

  it('reports a provider that stopped early alongside the results others returned', async () => {
    const google = candidate(MetadataProviderKey.GOOGLE, 'g1')
    apiMock.mockResolvedValue(streamResponse([event(google), statusEvent(MetadataProviderKey.COMICVINE, 'throttled')]))

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.search({ title: 'Dune' })
    scope.stop()

    expect(state.filteredResults.value).toEqual([google])
    expect(state.interruptedProviders.value).toEqual([{ provider: MetadataProviderKey.COMICVINE, outcome: 'throttled' }])
  })

  it('clears an earlier interruption when a new search starts', async () => {
    apiMock.mockResolvedValueOnce(streamResponse([statusEvent(MetadataProviderKey.COMICVINE, 'failed')]))
    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.search({ title: 'Amazing Spider-Man' })
    expect(state.interruptedProviders.value).toHaveLength(1)

    apiMock.mockResolvedValueOnce(streamResponse([event(candidate(MetadataProviderKey.COMICVINE, 'c1'))]))
    await state.search({ title: 'Amazing Spider-Man' })
    scope.stop()

    expect(state.interruptedProviders.value).toEqual([])
  })

  it('hides an interruption from a provider the user has filtered out', async () => {
    apiMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [provider(MetadataProviderKey.GOOGLE), provider(MetadataProviderKey.COMICVINE)],
    })
    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.loadProviders()

    apiMock.mockResolvedValueOnce(streamResponse([statusEvent(MetadataProviderKey.COMICVINE, 'timeout')]))
    await state.search({ title: 'Dune' })
    expect(state.interruptedProviders.value).toHaveLength(1)

    state.toggleProvider(MetadataProviderKey.COMICVINE)
    scope.stop()

    expect(state.selectedProviders.value).toEqual([MetadataProviderKey.GOOGLE])
    expect(state.interruptedProviders.value).toEqual([])
  })

  it('streams metadata candidates and counts providers', async () => {
    const google = candidate(MetadataProviderKey.GOOGLE, 'g1')
    const comicvine = candidate(MetadataProviderKey.COMICVINE, 'c1')
    apiMock.mockResolvedValue(
      streamResponse([event(google).slice(0, 12), event(google).slice(12), 'event: keepalive\n\n', event('not-json'), event(comicvine)]),
    )

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.search({ title: 'Dune', author: 'Frank Herbert', isbn: '9780441172719' })
    scope.stop()

    expect(state.filteredResults.value).toEqual([comicvine, google])
    expect(state.providerCounts[MetadataProviderKey.GOOGLE]).toBe(1)
    expect(state.providerCounts[MetadataProviderKey.COMICVINE]).toBe(1)
    expect(state.isStreaming.value).toBe(false)
    expect(state.hasSearched.value).toBe(true)
  })

  it('filters selected provider results and clears the filter', async () => {
    const google1 = candidate(MetadataProviderKey.GOOGLE, 'g1')
    const google2 = candidate(MetadataProviderKey.GOOGLE, 'g2')
    const google3 = candidate(MetadataProviderKey.GOOGLE, 'g3')
    const comicvine = candidate(MetadataProviderKey.COMICVINE, 'c1')
    const kobo = candidate(MetadataProviderKey.KOBO, 'k1')
    apiMock.mockResolvedValue(streamResponse([event(google1), event(google2), event(google3), event(comicvine), event(kobo)]))

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.search({ title: 'Dune' })

    expect(state.filteredResults.value).toEqual([comicvine, google1, google2, kobo, google3])

    state.toggleProvider(MetadataProviderKey.GOOGLE)
    expect(state.selectedProviders.value).toEqual([MetadataProviderKey.GOOGLE])
    expect(state.filteredResults.value).toEqual([google1, google2, google3])

    state.toggleProvider(MetadataProviderKey.GOOGLE)
    expect(state.selectedProviders.value).toEqual([])

    state.toggleProvider(MetadataProviderKey.KOBO)
    state.clearProviderFilter()
    expect(state.selectedProviders.value).toEqual([])
    scope.stop()
  })

  it('ignores abort errors and resets streaming state', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    apiMock.mockRejectedValue(abortError)

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    await state.search({ title: 'Dune' })
    scope.stop()

    expect(state.filteredResults.value).toEqual([])
    expect(state.isStreaming.value).toBe(false)
  })

  it('does not let an aborted previous search clear the active search state', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const secondResponse = deferred<Response>()
    apiMock
      .mockImplementationOnce((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError))
        })
      })
      .mockImplementationOnce(() => secondResponse.promise)

    const scope = effectScope()
    const state = scope.run(() => useMetadataSearch())!
    const firstSearch = state.search({ title: 'First' })
    const secondSearch = state.search({ title: 'Second' })

    await firstSearch
    expect(state.isStreaming.value).toBe(true)

    secondResponse.resolve({ ok: false } as Response)
    await secondSearch
    scope.stop()

    expect(state.isStreaming.value).toBe(false)
  })

  describe('metadata cache', () => {
    function cached(candidateValue: MetadataCandidate, cache: MetadataCandidateCacheInfo) {
      return { ...candidateValue, cache }
    }

    function streamUrls(): string[] {
      return apiMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith('/api/v1/metadata-fetch/stream'))
    }

    it('keeps the cache marker beside a candidate rather than on it and summarizes the visible results', async () => {
      const google = candidate(MetadataProviderKey.GOOGLE, 'g1')
      const amazon = candidate(MetadataProviderKey.AMAZON, 'a1')
      const kobo = candidate(MetadataProviderKey.KOBO, 'k1')
      apiMock.mockResolvedValue(
        streamResponse([
          event(cached(google, { fetchedAt: '2026-10-07T10:00:00.000Z', stale: false })),
          event(cached(amazon, { fetchedAt: '2026-10-01T10:00:00.000Z', stale: true })),
          event(kobo),
        ]),
      )

      const scope = effectScope()
      const state = scope.run(() => useMetadataSearch())!
      await state.search({ title: 'Dune' })

      expect(state.results.value.every((result) => !('cache' in result))).toBe(true)
      expect(state.cacheInfoFor(google)).toEqual({ fetchedAt: '2026-10-07T10:00:00.000Z', stale: false })
      expect(state.cacheInfoFor(amazon)).toEqual({ fetchedAt: '2026-10-01T10:00:00.000Z', stale: true })
      expect(state.cacheInfoFor(kobo)).toBeNull()
      expect(state.cacheSummary.value).toEqual({ cachedCount: 2, staleCount: 1, oldestFetchedAt: '2026-10-01T10:00:00.000Z' })
      scope.stop()
    })

    it('leaves the cache query off a normal search', async () => {
      apiMock.mockResolvedValue({ ok: false })

      const scope = effectScope()
      const state = scope.run(() => useMetadataSearch())!
      await state.search({ title: 'Dune' })
      scope.stop()

      expect(streamUrls()).toEqual(['/api/v1/metadata-fetch/stream?title=Dune'])
    })

    it('runs the last search again with cache=refresh and forgets earlier cache markers', async () => {
      const google = candidate(MetadataProviderKey.GOOGLE, 'g1')
      apiMock
        .mockResolvedValueOnce(streamResponse([event(cached(google, { fetchedAt: '2026-10-07T10:00:00.000Z', stale: false }))]))
        .mockResolvedValueOnce(streamResponse([event(google)]))

      const scope = effectScope()
      const state = scope.run(() => useMetadataSearch())!
      state.selectedProviders.value = [MetadataProviderKey.GOOGLE]
      await state.search({ title: 'Dune', bookId: 42 })
      expect(state.cacheSummary.value.cachedCount).toBe(1)

      await state.searchFresh()
      scope.stop()

      expect(streamUrls()).toEqual([
        '/api/v1/metadata-fetch/stream?title=Dune&bookId=42&providers=google',
        '/api/v1/metadata-fetch/stream?title=Dune&bookId=42&providers=google&cache=refresh',
      ])
      expect(state.cacheInfoFor(google)).toBeNull()
      expect(state.cacheSummary.value.cachedCount).toBe(0)
    })

    it('does nothing when asked to search fresh before any search', async () => {
      const scope = effectScope()
      const state = scope.run(() => useMetadataSearch())!
      await state.searchFresh()
      scope.stop()

      expect(apiMock).not.toHaveBeenCalled()
    })

    it('retries a provider live and drops only its cache markers', async () => {
      const google = candidate(MetadataProviderKey.GOOGLE, 'g1')
      const amazon = candidate(MetadataProviderKey.AMAZON, 'a1')
      apiMock
        .mockResolvedValueOnce(
          streamResponse([
            event(cached(google, { fetchedAt: '2026-10-07T10:00:00.000Z', stale: false })),
            event(cached(amazon, { fetchedAt: '2026-10-02T10:00:00.000Z', stale: true })),
          ]),
        )
        .mockResolvedValueOnce(streamResponse([event(amazon)]))

      const scope = effectScope()
      const state = scope.run(() => useMetadataSearch())!
      await state.search({ title: 'Dune' })
      await state.retryProvider(MetadataProviderKey.AMAZON)
      scope.stop()

      expect(streamUrls()[1]).toBe('/api/v1/metadata-fetch/stream?title=Dune&providers=amazon&cache=refresh')
      expect(state.cacheInfoFor(amazon)).toBeNull()
      expect(state.cacheInfoFor(google)).toEqual({ fetchedAt: '2026-10-07T10:00:00.000Z', stale: false })
      expect(state.cacheSummary.value).toEqual({ cachedCount: 1, staleCount: 0, oldestFetchedAt: '2026-10-07T10:00:00.000Z' })
    })
  })
})
