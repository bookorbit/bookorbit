import { AiNetworkError } from './ai-network';
import { readSseEvents, type AiSseEvent } from './ai-sse';

const LIMITS = { maxEventBytes: 1024, maxTotalBytes: 8 * 1024, idleMs: 1_000 };

function body(chunks: string[], options: { stall?: boolean } = {}): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  const encoder = new TextEncoder();
  let cancelled = false;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]));
      else if (!options.stall) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

async function collect(stream: ReadableStream<Uint8Array>, limits = LIMITS): Promise<AiSseEvent[]> {
  const events: AiSseEvent[] = [];
  for await (const event of readSseEvents(stream, limits)) events.push(event);
  return events;
}

describe('readSseEvents', () => {
  it('reads events split across chunks, with names, multi-line data and every line ending', async () => {
    const { stream } = body(['data: {"a"', ':1}\n\nevent: message_start\r\ndata: one\r\ndata: two\r\n\r\n', 'data: last\r\r']);
    expect(await collect(stream)).toEqual([{ data: '{"a":1}' }, { event: 'message_start', data: 'one\ntwo' }, { data: 'last' }]);
  });

  it('skips comment lines and events with no data', async () => {
    const { stream } = body([': OPENROUTER PROCESSING\n\nevent: ping\n\ndata: [DONE]\n\n']);
    expect(await collect(stream)).toEqual([{ data: '[DONE]' }]);
  });

  it('keeps a final event the provider did not end with a blank line', async () => {
    const { stream } = body(['data: first\n\ndata: tail']);
    expect(await collect(stream)).toEqual([{ data: 'first' }, { data: 'tail' }]);
  });

  it('refuses an event larger than the limit', async () => {
    const { stream } = body([`data: ${'x'.repeat(2_000)}\n\n`]);
    await expect(collect(stream)).rejects.toBeInstanceOf(AiNetworkError);
  });

  it('refuses a stream larger than the total limit', async () => {
    const { stream } = body(Array.from({ length: 20 }, () => `data: ${'y'.repeat(500)}\n\n`));
    await expect(collect(stream)).rejects.toThrow(/more than BookOrbit reads/);
  });

  it('times out a provider that goes quiet, and cancels the body', async () => {
    vi.useFakeTimers();
    try {
      const { stream, cancelled } = body(['data: one\n\n'], { stall: true });
      const result = collect(stream).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1_001);
      const error = (await result) as AiNetworkError;
      expect(error).toBeInstanceOf(AiNetworkError);
      expect(error.failure).toBe('timeout');
      expect(cancelled()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the body when the reader stops early', async () => {
    const { stream, cancelled } = body(['data: one\n\ndata: two\n\n'], { stall: true });
    for await (const event of readSseEvents(stream, LIMITS)) {
      expect(event.data).toBe('one');
      break;
    }
    expect(cancelled()).toBe(true);
  });
});
