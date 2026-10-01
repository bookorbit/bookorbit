import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useAudioProgress } from '../useAudioProgress'

const apiMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

const ASSET_ID = 'aud_00000000-0000-4000-8000-000000000001'
const REVISION_A = 'a'.repeat(64)
const REVISION_B = 'b'.repeat(64)

function response(status: number, body: unknown = null) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }
}

function serverState(overrides: Record<string, unknown> = {}) {
  return {
    assetId: ASSET_ID,
    positionMs: 1_000,
    percentage: 1,
    completed: false,
    capturedAt: new Date().toISOString(),
    revision: 1,
    manifestRevision: REVISION_A,
    ...overrides,
  }
}

function puts() {
  return apiMock.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(init!.body as string) as Record<string, unknown>)
}

function setup() {
  const manifestRevision = ref(REVISION_A)
  const onManifestStale = vi.fn<() => void>()
  const progress = useAudioProgress(1, {
    manifestRevision,
    assets: [{ assetId: ASSET_ID, durationMs: 20_000 }],
    onManifestStale,
  })
  return { progress, manifestRevision, onManifestStale }
}

describe('useAudioProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T10:00:00.000Z'))
    apiMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('persists playback state when randomUUID is unavailable on an insecure origin', async () => {
    const getRandomValues = vi.fn<(bytes: Uint8Array) => Uint8Array>((bytes) => {
      bytes.fill(0)
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })
    apiMock.mockResolvedValue(response(200, serverState({ revision: 1 })))
    const { progress } = setup()

    expect(() => progress.update(ASSET_ID, 12)).not.toThrow()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(puts()).toEqual([
      expect.objectContaining({
        positionMs: 12_000,
        operationId: '00000000-0000-4000-8000-000000000000',
      }),
    ])
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('stamps capturedAt when the position is captured and clamps it to the asset duration', async () => {
    apiMock.mockResolvedValue(response(200, serverState({ revision: 1 })))
    const { progress } = setup()

    progress.update(ASSET_ID, 20.3)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(puts()).toEqual([expect.objectContaining({ positionMs: 20_000, capturedAt: '2026-09-01T10:00:00.000Z', baseRevision: 0 })])
    expect(progress.revision.value).toBe(1)
  })

  it('retries a network failure with the same operationId and capturedAt', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(response(200, serverState()))
    const { progress } = setup()

    progress.update(ASSET_ID, 5)
    await vi.advanceTimersByTimeAsync(10_000)

    const [first, second] = puts()
    expect(puts()).toHaveLength(2)
    expect(second!.operationId).toBe(first!.operationId)
    expect(second!.capturedAt).toBe(first!.capturedAt)
  })

  it('retries a server error but drops a write the server rejects with 400', async () => {
    apiMock.mockResolvedValueOnce(response(503)).mockResolvedValue(response(400))
    const { progress } = setup()

    progress.update(ASSET_ID, 5)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(puts()).toHaveLength(2)
  })

  it('holds the write on 412 until the manifest is reloaded', async () => {
    apiMock.mockResolvedValueOnce(response(412)).mockResolvedValue(response(200, serverState()))
    const { progress, manifestRevision, onManifestStale } = setup()

    progress.update(ASSET_ID, 5)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(puts()).toHaveLength(1)
    expect(onManifestStale).toHaveBeenCalledTimes(1)

    manifestRevision.value = REVISION_B
    progress.flush()
    await vi.advanceTimersByTimeAsync(0)

    const [stale, fresh] = puts()
    expect(fresh).toMatchObject({ manifestRevision: REVISION_B, operationId: stale!.operationId, capturedAt: stale!.capturedAt })
  })

  it('drops the write on 409 when the server state is at least as new', async () => {
    apiMock.mockImplementation((_url, init) =>
      Promise.resolve(init?.method === 'PUT' ? response(409) : response(200, serverState({ revision: 4, capturedAt: '2026-09-01T10:00:02.000Z' }))),
    )
    const { progress } = setup()

    progress.update(ASSET_ID, 5)
    await vi.advanceTimersByTimeAsync(60_000)

    expect(puts()).toHaveLength(1)
    expect(progress.revision.value).toBe(4)
  })

  it('retries on 409 with the reloaded revision when the local write is newer', async () => {
    apiMock
      .mockResolvedValueOnce(response(409))
      .mockResolvedValueOnce(response(200, serverState({ revision: 4, capturedAt: '2026-09-01T09:59:00.000Z' })))
      .mockResolvedValue(response(200, serverState({ revision: 5 })))
    const { progress } = setup()

    progress.update(ASSET_ID, 5)
    await vi.advanceTimersByTimeAsync(10_000)

    const [first, retry] = puts()
    expect(puts()).toHaveLength(2)
    expect(retry).toMatchObject({ baseRevision: 4, operationId: first!.operationId })
    expect(progress.revision.value).toBe(5)
  })
})
