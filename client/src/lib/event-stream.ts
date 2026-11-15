/**
 * Reads a server-sent event stream and hands each `data:` line's JSON to `onEvent`. Lines are
 * buffered across chunks, since one event can straddle two and one chunk can carry several, and a
 * last line the stream ends without a newline still counts. Anything that is not a JSON `data:`
 * line is ignored. Aborting `signal` stops reading and resolves; the server is not told.
 */
export async function readEventStream<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void, signal?: AbortSignal): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  // A reader that cannot cancel, or one already released, still stops at the next read.
  const stop = () =>
    void Promise.resolve()
      .then(() => reader.cancel())
      .catch(() => undefined)
  const dispatch = (raw: string) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data) return
    let event: T
    try {
      event = JSON.parse(data) as T
    } catch {
      return
    }
    onEvent(event)
  }

  if (signal?.aborted) {
    stop()
    return
  }
  signal?.addEventListener('abort', stop, { once: true })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done || signal?.aborted) break
      const lines = (pending + decoder.decode(value, { stream: true })).split('\n')
      pending = lines.pop() ?? ''
      lines.forEach(dispatch)
    }
    if (!signal?.aborted) dispatch(pending + decoder.decode())
  } finally {
    signal?.removeEventListener('abort', stop)
  }
}
