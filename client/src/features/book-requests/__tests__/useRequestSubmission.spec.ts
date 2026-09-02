// @vitest-environment node
import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types'

import { submitFailureText, useRequestSubmission } from '../composables/useRequestSubmission'

const api = vi.hoisted(() => vi.fn<(input: string, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({ api }))

describe('useRequestSubmission', () => {
  beforeEach(() => {
    api.mockReset()
  })

  it('submits the usable grouped cover without changing the selected provider identity', async () => {
    api
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request: { id: 12, status: 'pending' }, subscribed: false }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ limit: null, remaining: null }) } as Response)
    const candidate: MetadataCandidate = {
      provider: MetadataProviderKey.GOOGLE,
      providerId: 'google-id',
      title: 'Dune',
      authors: ['Frank Herbert'],
      coverUrl: 'https://google.test/broken.jpg',
    }
    const scope = effectScope()
    const state = scope.run(() => useRequestSubmission())!

    await state.submit(candidate, { coverUrl: 'https://amazon.test/usable.jpg' })
    scope.stop()

    const request = api.mock.calls[0]!
    expect(request[0]).toBe('/api/v1/book-requests')
    expect(JSON.parse(request[1]!.body as string)).toEqual(
      expect.objectContaining({
        providerKey: MetadataProviderKey.GOOGLE,
        providerId: 'google-id',
        coverUrl: 'https://amazon.test/usable.jpg',
      }),
    )
  })

  it('submits grouped provenance without inventing one winning provider or ISBN', async () => {
    api.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request: { id: 12, status: 'pending' }, subscribed: false }),
    } as Response)
    const candidate: MetadataCandidate = {
      provider: MetadataProviderKey.GOOGLE,
      providerId: 'google-id',
      title: 'Dune',
      isbn13: '9780441013593',
    }
    const metadataSources = [
      {
        providerKey: MetadataProviderKey.GOOGLE,
        providerId: 'google-id',
        providerLabel: 'Google Books',
        isbn10: null,
        isbn13: '9780441013593',
      },
      {
        providerKey: MetadataProviderKey.AMAZON,
        providerId: 'amazon-id',
        providerLabel: 'Amazon',
        isbn10: null,
        isbn13: '9781250301697',
      },
    ]
    const scope = effectScope()
    const state = scope.run(() => useRequestSubmission())!

    await state.submit(candidate, { isbn10: null, isbn13: null, providerKey: null, providerId: null, metadataSources })
    scope.stop()

    const payload = JSON.parse(api.mock.calls[0]![1]!.body as string)
    expect(payload).toEqual(expect.objectContaining({ isbn10: null, isbn13: null, providerKey: null, providerId: null, metadataSources }))
  })

  it('drops a provider cover whose URL is not HTTP', async () => {
    api.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ request: { id: 12, status: 'pending' }, subscribed: false }),
    } as Response)
    const candidate: MetadataCandidate = {
      provider: MetadataProviderKey.GOOGLE,
      providerId: 'google-id',
      title: 'Dune',
      coverUrl: 'data:image/png;base64,AAAA',
    }
    const scope = effectScope()
    const state = scope.run(() => useRequestSubmission())!

    await state.submit(candidate, {})
    scope.stop()

    expect(JSON.parse(api.mock.calls[0]![1]!.body as string)).toMatchObject({ coverUrl: null })
  })
})

/**
 * Every refusal the submit endpoint raises is application copy about a rule this instance applies,
 * so it has to reach the reader in their own language. English prose in a toast is what the codes
 * exist to replace, and the prose stays only for what nothing classified.
 */
describe('submit refusals', () => {
  const t = (key: string, named: Record<string, unknown>) => `${key} ${JSON.stringify(named)}`

  function refusal(body: unknown) {
    return { ok: false, json: async () => body } as Response
  }

  async function submitAgainst(body: unknown) {
    api.mockResolvedValueOnce(refusal(body))
    const scope = effectScope()
    const state = scope.run(() => useRequestSubmission())!
    await state.submitFreeText({ title: 'Dune' }, {})
    scope.stop()
    return state.lastFailure.value
  }

  beforeEach(() => {
    api.mockReset()
  })

  it('reads the code and its parameters off the refusal', async () => {
    const failure = await submitAgainst({
      message: 'Finish or cancel some downloads first: 10 can be in flight at once',
      errorCode: 'SUBMIT_SELF_SERVE_LIMIT',
      errorMeta: { limit: 10 },
    })

    expect(failure).toEqual({
      code: 'SUBMIT_SELF_SERVE_LIMIT',
      meta: { limit: 10 },
      message: 'Finish or cancel some downloads first: 10 can be in flight at once',
    })
    expect(submitFailureText(failure, t)).toBe('bookRequests.submitError.SUBMIT_SELF_SERVE_LIMIT {"limit":10}')
  })

  /** A code this build does not know is not a code; showing the sentence beats showing its name. */
  it('falls back to the server sentence for an unrecognised code', async () => {
    const failure = await submitAgainst({ message: 'Something else entirely', errorCode: 'SUBMIT_FROM_THE_FUTURE' })

    expect(failure?.code).toBeNull()
    expect(submitFailureText(failure, t)).toBe('Something else entirely')
  })

  /** A validation error carries an array of field messages and no code at all. */
  it('falls back to the first validation message', async () => {
    const failure = await submitAgainst({ message: ['title should not be empty', 'mediaKind must be one of'] })

    expect(submitFailureText(failure, t)).toBe('title should not be empty')
  })

  it('says nothing it cannot read, leaving the caller its own fallback', async () => {
    const failure = await submitAgainst({})

    expect(submitFailureText(failure, t)).toBeNull()
    expect(submitFailureText(null, t)).toBeNull()
  })

  /**
   * A network failure never reached the server, so there is no classified refusal to read. Without
   * a catch the promise rejected out of the caller: the button un-disabled and the person was told
   * nothing at all had happened.
   */
  it.each([
    [
      'a candidate',
      (state: ReturnType<typeof useRequestSubmission>) =>
        state.submit({ provider: MetadataProviderKey.GOOGLE, providerId: 'g1', title: 'Dune' } as MetadataCandidate, {}),
    ],
    ['free text', (state: ReturnType<typeof useRequestSubmission>) => state.submitFreeText({ title: 'Dune' }, {})],
  ])('reports a network failure submitting %s rather than rejecting', async (_label, submit) => {
    api.mockRejectedValueOnce(new Error('Failed to fetch'))
    const scope = effectScope()
    const state = scope.run(() => useRequestSubmission())!

    await expect(submit(state)).resolves.toBeNull()

    expect(state.lastFailure.value).toEqual({ code: null, meta: null, message: null })
    expect(state.submitting.value).toBeNull()
    scope.stop()
  })
})
