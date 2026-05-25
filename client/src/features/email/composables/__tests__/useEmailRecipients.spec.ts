import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeResponse(data?: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response
}

function makeRecipient(id: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    userId: 42,
    name: `Recipient ${id}`,
    email: `recipient${id}@example.com`,
    isDefault: false,
    deviceType: null,
    preferredFormat: null,
    defaultTemplateId: null,
    createdAt: '2026-05-22T00:00:00.000Z',
    ...overrides,
  }
}

describe('useEmailRecipients', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('fetches recipients and stores them', async () => {
    const rows = [makeRecipient(1), makeRecipient(2)]
    apiMock.mockResolvedValueOnce(makeResponse(rows))

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { recipients, fetchRecipients } = useEmailRecipients()

    await fetchRecipients()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/email/recipients')
    expect(recipients.value).toEqual(rows)
  })

  it('deduplicates concurrent fetches using the in-flight promise', async () => {
    let resolveFetch: ((value: Response) => void) | null = null
    apiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { fetchRecipients } = useEmailRecipients()

    const first = fetchRecipients()
    const second = fetchRecipients()

    expect(apiMock).toHaveBeenCalledTimes(1)
    resolveFetch!(makeResponse([makeRecipient(1)]))
    await Promise.all([first, second])
  })

  it('allows retry after a failed fetch', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({}, false)).mockResolvedValueOnce(makeResponse([makeRecipient(3)]))

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { recipients, fetchRecipients } = useEmailRecipients()

    await expect(fetchRecipients()).rejects.toThrow('Failed to load recipients')
    await fetchRecipients()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(recipients.value).toEqual([makeRecipient(3)])
  })

  it('creates a recipient and appends it to local state', async () => {
    const existing = makeRecipient(1)
    const created = makeRecipient(2)
    apiMock.mockResolvedValueOnce(makeResponse(created))

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { recipients, createRecipient } = useEmailRecipients()
    recipients.value = [existing]

    await createRecipient({
      name: created.name,
      email: created.email,
      deviceType: null,
      preferredFormat: null,
      defaultTemplateId: null,
    })

    const [, request] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(request.method).toBe('POST')
    expect(JSON.parse(String(request.body))).toEqual({
      name: created.name,
      email: created.email,
      deviceType: null,
      preferredFormat: null,
      defaultTemplateId: null,
    })
    expect(recipients.value).toEqual([existing, created])
  })

  it('surfaces backend message on create failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'duplicate recipient' }, false))

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { createRecipient } = useEmailRecipients()

    await expect(
      createRecipient({
        name: 'Kindle',
        email: 'kindle@example.com',
        deviceType: null,
        preferredFormat: null,
        defaultTemplateId: null,
      }),
    ).rejects.toThrow('duplicate recipient')
  })

  it('updates a recipient in local state', async () => {
    const first = makeRecipient(1)
    const second = makeRecipient(2)
    const updated = makeRecipient(1, { name: 'Updated name', preferredFormat: 'epub' })
    apiMock.mockResolvedValueOnce(makeResponse(updated))

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { recipients, updateRecipient } = useEmailRecipients()
    recipients.value = [first, second]

    await updateRecipient(1, { name: 'Updated name', preferredFormat: 'epub' })

    expect(recipients.value).toEqual([updated, second])
  })

  it('surfaces backend message on update failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'email already exists' }, false))

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { updateRecipient } = useEmailRecipients()

    await expect(updateRecipient(7, { email: 'duplicate@example.com' })).rejects.toThrow('email already exists')
  })

  it('deletes a recipient from local state', async () => {
    apiMock.mockResolvedValueOnce(makeResponse())

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { recipients, deleteRecipient } = useEmailRecipients()
    recipients.value = [makeRecipient(1), makeRecipient(2)]

    await deleteRecipient(1)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/email/recipients/1', { method: 'DELETE' })
    expect(recipients.value).toEqual([makeRecipient(2)])
  })

  it('throws when delete recipient request fails', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({}, false))

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { deleteRecipient } = useEmailRecipients()

    await expect(deleteRecipient(11)).rejects.toThrow('Failed to delete recipient')
  })

  it('sets default recipient and clears default from others', async () => {
    const first = makeRecipient(1, { isDefault: false })
    const second = makeRecipient(2, { isDefault: true })
    const updated = makeRecipient(1, { isDefault: true })
    apiMock.mockResolvedValueOnce(makeResponse(updated))

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { recipients, setDefaultRecipient } = useEmailRecipients()
    recipients.value = [first, second]

    await setDefaultRecipient(1)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/email/recipients/1/default', { method: 'PATCH' })
    expect(recipients.value).toEqual([
      { ...first, isDefault: true },
      { ...second, isDefault: false },
    ])
  })

  it('throws when set default request fails', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({}, false))

    const { useEmailRecipients } = await import('../useEmailRecipients')
    const { setDefaultRecipient } = useEmailRecipients()

    await expect(setDefaultRecipient(3)).rejects.toThrow('Failed to set default')
  })
})
