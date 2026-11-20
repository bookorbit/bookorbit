import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const engine = vi.hoisted(() => ({ prefetchPdfEngine: vi.fn<() => Promise<void>>() }))

vi.mock('../pdf-engine', () => engine)
vi.mock('../PdfV4ReaderView.vue', () => ({ default: {} }))

import { prefetchPdfReader, resetPdfReaderPrefetchForTests } from '../prefetch-pdf-reader'

function setSaveData(saveData: boolean | undefined) {
  Object.defineProperty(navigator, 'connection', { configurable: true, value: saveData === undefined ? undefined : { saveData } })
}

async function runIdleWork() {
  await vi.runAllTimersAsync()
}

describe('prefetchPdfReader', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => setTimeout(callback, 0))
    engine.prefetchPdfEngine.mockReset().mockResolvedValue(undefined)
    resetPdfReaderPrefetchForTests()
    setSaveData(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setSaveData(undefined)
  })

  it('warms the engine once however many PDF pages ask', async () => {
    prefetchPdfReader()
    prefetchPdfReader()
    await runIdleWork()
    prefetchPdfReader()
    await runIdleWork()

    expect(engine.prefetchPdfEngine).toHaveBeenCalledTimes(1)
  })

  it('fetches nothing on a connection asking to save data', async () => {
    setSaveData(true)
    prefetchPdfReader()
    await runIdleWork()

    expect(engine.prefetchPdfEngine).not.toHaveBeenCalled()
  })

  it('tries again on a later page after a failed warm-up', async () => {
    engine.prefetchPdfEngine.mockRejectedValueOnce(new Error('offline'))
    prefetchPdfReader()
    await runIdleWork()
    prefetchPdfReader()
    await runIdleWork()

    expect(engine.prefetchPdfEngine).toHaveBeenCalledTimes(2)
  })
})
