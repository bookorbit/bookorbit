import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { Permission, type BookDetail } from '@bookorbit/types'
import { BOOK_ID, errorResponse, jsonResponse, makeCapability } from '../__tests__/fixtures'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  hasPermission: vi.fn<(name: string) => boolean>(),
  demo: { value: false },
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission, isDemoRestrictedAccount: mocks.demo }),
}))

import { useReadAloudInvite } from './useReadAloudInvite'

const CAPABILITY_URL = `/api/v1/books/${BOOK_ID}/read-aloud`

let scope: EffectScope | null = null

function setup(files: number[] = [101, 102]) {
  const book = ref({ id: BOOK_ID, files: files.map((id) => ({ id })) } as unknown as Pick<BookDetail, 'id' | 'files'>)
  scope = effectScope()
  const result = scope.run(() => useReadAloudInvite(book))!
  return { book, ...result }
}

beforeEach(() => {
  mocks.api.mockReset()
  mocks.hasPermission.mockReset()
  mocks.hasPermission.mockImplementation((name) => name === Permission.LibraryGenerateReadAloud)
  mocks.demo.value = false
})

afterEach(() => {
  scope?.stop()
  scope = null
})

describe('useReadAloudInvite', () => {
  it('invites when the book can be made into a read-aloud and has none yet', async () => {
    mocks.api.mockResolvedValue(jsonResponse(makeCapability()))
    const { invite } = setup()
    await flushPromises()

    expect(invite.value).toBe(true)
    expect(mocks.api).toHaveBeenCalledWith(CAPABILITY_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('does not ask, or invite, without the permission', async () => {
    mocks.hasPermission.mockReturnValue(false)
    const { invite } = setup()
    await flushPromises()

    expect(invite.value).toBe(false)
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('does not ask a demo-restricted account', async () => {
    mocks.demo.value = true
    const { invite } = setup()
    await flushPromises()

    expect(invite.value).toBe(false)
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it.each([
    ['the worker is offline', makeCapability({ eligible: false, reason: 'worker_unavailable' })],
    ['a job is already running', makeCapability({ eligible: false, reason: 'job_active' })],
    ['the book has no audiobook', makeCapability({ eligible: false, reason: 'no_audiobook' })],
    ['no worker is configured', makeCapability({ workerConfigured: false, eligible: false, reason: 'worker_not_configured' })],
  ])('does not invite when %s', async (_name, capability) => {
    mocks.api.mockResolvedValue(jsonResponse(capability))
    const { invite } = setup()
    await flushPromises()

    expect(invite.value).toBe(false)
  })

  it('does not invite a book that already has a read-aloud', async () => {
    mocks.api.mockResolvedValue(
      jsonResponse(makeCapability({ existingReadAlongs: [{ fileId: 9, filename: 'book.readaloud.epub', sizeBytes: 1, generatedByJobId: null }] })),
    )
    const { invite } = setup()
    await flushPromises()

    expect(invite.value).toBe(false)
  })

  it('offers nothing when the lookup fails', async () => {
    mocks.api.mockResolvedValue(errorResponse(500))
    const { invite } = setup()
    await flushPromises()

    expect(invite.value).toBe(false)
  })

  it('offers nothing when the lookup throws', async () => {
    mocks.api.mockRejectedValue(new Error('offline'))
    const { invite } = setup()
    await flushPromises()

    expect(invite.value).toBe(false)
  })

  it('asks again when the book gains a file, so a finished read-aloud retires the invitation', async () => {
    mocks.api.mockResolvedValueOnce(jsonResponse(makeCapability()))
    const { invite, book } = setup()
    await flushPromises()
    expect(invite.value).toBe(true)

    mocks.api.mockResolvedValueOnce(
      jsonResponse(makeCapability({ existingReadAlongs: [{ fileId: 9, filename: 'book.readaloud.epub', sizeBytes: 1, generatedByJobId: 'job' }] })),
    )
    book.value = { id: BOOK_ID, files: [{ id: 101 }, { id: 102 }, { id: 103 }] } as unknown as Pick<BookDetail, 'id' | 'files'>
    await flushPromises()

    expect(mocks.api).toHaveBeenCalledTimes(2)
    expect(invite.value).toBe(false)
  })

  it('keeps the invite for the same book while it asks again, instead of blinking it off', async () => {
    mocks.api.mockResolvedValueOnce(jsonResponse(makeCapability()))
    const { invite, book } = setup()
    await flushPromises()
    expect(invite.value).toBe(true)

    let answer!: (response: Response) => void
    mocks.api.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)))
    book.value = { id: BOOK_ID, files: [{ id: 101 }, { id: 102 }, { id: 103 }] } as unknown as Pick<BookDetail, 'id' | 'files'>
    await flushPromises()

    expect(mocks.api).toHaveBeenCalledTimes(2)
    expect(invite.value).toBe(true)

    answer(jsonResponse(makeCapability()))
    await flushPromises()
    expect(invite.value).toBe(true)
  })

  it("drops the last book's invite the moment another book takes its place", async () => {
    mocks.api.mockResolvedValueOnce(jsonResponse(makeCapability()))
    const { invite, book } = setup()
    await flushPromises()
    expect(invite.value).toBe(true)

    let answer!: (response: Response) => void
    mocks.api.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)))
    book.value = { id: BOOK_ID + 1, files: [{ id: 201 }] } as unknown as Pick<BookDetail, 'id' | 'files'>

    expect(invite.value).toBe(false)
    await flushPromises()
    expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/books/${BOOK_ID + 1}/read-aloud`, expect.any(Object))
    expect(invite.value).toBe(false)

    answer(jsonResponse(makeCapability()))
    await flushPromises()
    expect(invite.value).toBe(true)
  })
})
