import { AiNetworkError } from './ai-network';

/** One server-sent event from a provider: its `event:` name, when it has one, and its joined `data:` lines. */
export interface AiSseEvent {
  event?: string;
  data: string;
}

export interface AiSseLimits {
  /** The most one event may carry before the stream is treated as broken. */
  maxEventBytes: number;
  /** The most the whole stream may carry, the same ceiling a whole reply has. */
  maxTotalBytes: number;
  /** How long the provider may go quiet between chunks. */
  idleMs: number;
}

/**
 * Reads a provider's `text/event-stream` body as events, bounded in event size, total size and
 * silence. Comment lines (`:` keep-alives, OpenRouter's processing notes) are skipped. Leaving the
 * loop early cancels the body, which closes the connection to the provider.
 */
export async function* readSseEvents(body: ReadableStream<Uint8Array>, limits: AiSseLimits): AsyncGenerator<AiSseEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;
  let name: string | undefined;
  let data: string[] = [];
  let eventBytes = 0;

  const dispatch = (): AiSseEvent | null => {
    const event = data.length > 0 ? { ...(name ? { event: name } : {}), data: data.join('\n') } : null;
    name = undefined;
    data = [];
    eventBytes = 0;
    return event;
  };

  try {
    for (;;) {
      const { done, value } = await readWithin(reader, limits.idleMs);
      if (done) break;
      total += value.byteLength;
      if (total > limits.maxTotalBytes) throw new AiNetworkError('provider-error', 'The provider streamed more than BookOrbit reads');
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.search(/\r\n|\r|\n/);
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        const width = buffer.startsWith('\r\n', newline) ? 2 : 1;
        buffer = buffer.slice(newline + width);
        newline = buffer.search(/\r\n|\r|\n/);

        if (line === '') {
          const event = dispatch();
          if (event) yield event;
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const raw = colon === -1 ? '' : line.slice(colon + 1);
        const content = raw.startsWith(' ') ? raw.slice(1) : raw;
        if (field === 'data') {
          eventBytes += content.length;
          if (eventBytes > limits.maxEventBytes)
            throw new AiNetworkError('provider-error', 'The provider streamed an event larger than BookOrbit reads');
          data.push(content);
        } else if (field === 'event') {
          name = content;
        }
      }
      if (buffer.length > limits.maxEventBytes)
        throw new AiNetworkError('provider-error', 'The provider streamed a line larger than BookOrbit reads');
    }
    buffer += decoder.decode();
    if (buffer.length > 0 && buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
    const last = dispatch();
    if (last) yield last;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiNetworkError('timeout', 'The provider stopped sending the answer')), idleMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([reader.read(), idle]);
  } finally {
    clearTimeout(timer);
  }
}
