import { describe, expect, it } from 'vitest'

import { readEventStream } from './event-stream'

/** A stream that hands over `chunks` exactly as given, one read each. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(chunks: string[]): Promise<unknown[]> {
  const events: unknown[] = []
  await readEventStream(streamOf(chunks), (event) => events.push(event))
  return events
}

describe('readEventStream', () => {
  it('reassembles an event split across chunks', async () => {
    const line = `data: ${JSON.stringify({ bookId: 7, success: true })}\n\n`
    expect(await collect([line.slice(0, 9), line.slice(9, 20), line.slice(20)])).toEqual([{ bookId: 7, success: true }])
  })

  it('hands over every event a single chunk carries, in order', async () => {
    expect(await collect([`data: {"bookId":1}\n\ndata: {"bookId":2}\n\ndata: {"done":true}\n\n`])).toEqual([
      { bookId: 1 },
      { bookId: 2 },
      { done: true },
    ])
  })

  it('keeps a last event the stream ends without a newline', async () => {
    expect(await collect([`data: {"bookId":1}\n`, `data: {"done":true,"processed":1}`])).toEqual([{ bookId: 1 }, { done: true, processed: 1 }])
  })

  it('reads lines ending in CRLF and data lines without a space', async () => {
    expect(await collect([`data:{"a":1}\r\n\r\ndata: {"b":2}\r\n`])).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('ignores comments, other fields and malformed data', async () => {
    expect(await collect([`: keep-alive\n`, `event: progress\n`, `data: {not json\n`, `data:\n`, `data: {"ok":true}\n`])).toEqual([{ ok: true }])
  })

  it('stops reading once its signal aborts, without throwing', async () => {
    const encoder = new TextEncoder()
    let push: ((text: string) => void) | null = null
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (text) => controller.enqueue(encoder.encode(text))
      },
    })
    const controller = new AbortController()
    const events: unknown[] = []
    const reading = readEventStream(body, (event) => events.push(event), controller.signal)

    push!(`data: {"bookId":1}\n`)
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    await reading

    expect(events).toEqual([{ bookId: 1 }])
  })

  it('does not read at all when its signal has already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const events: unknown[] = []

    await readEventStream(streamOf([`data: {"bookId":1}\n`]), (event) => events.push(event), controller.signal)

    expect(events).toEqual([])
  })
})
