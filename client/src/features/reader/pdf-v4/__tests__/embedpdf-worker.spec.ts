import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdfErrorCode } from '@embedpdf/models'
import { createPdfiumEngine } from '@embedpdf/engines/pdfium-worker-engine'

class FailingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener)
  }

  postMessage(message: { type?: string }) {
    if (message.type !== 'wasmInit') return
    queueMicrotask(() => {
      const event = new MessageEvent('message', { data: { type: 'wasmError', error: 'WASM unavailable' } })
      for (const listener of this.listeners.get('message') ?? []) {
        if (typeof listener === 'function') listener(event)
        else listener.handleEvent(event)
      }
    })
  }

  terminate() {}
}

describe('patched PDFium worker initialization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects queued document work instead of hanging on a WASM error', async () => {
    vi.stubGlobal('Worker', FailingWorker)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf-worker')
    const engine = createPdfiumEngine('https://bookorbit.test/pdfium.wasm', { fontFallback: null })

    const task = engine.openDocumentBuffer({ id: 'doc-1', content: new ArrayBuffer(0) })

    await expect(task.toPromise()).rejects.toMatchObject({
      reason: {
        code: PdfErrorCode.Initialization,
        message: 'Worker initialization failed',
      },
    })
  })
})
