import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { MetadataProviderKey, type MetadataCandidate, type MetadataProviderInfo } from '@bookorbit/types'
import { useMetadataSearch } from '../useMetadataSearch'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

describe('useMetadataSearch', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  function provider(key: MetadataProviderKey, selectedByFieldRules?: boolean): MetadataProviderInfo {
    return { key, label: key, identifiable: true, ...(selectedByFieldRules !== undefined ? { selectedByFieldRules } : {}) }
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
})
