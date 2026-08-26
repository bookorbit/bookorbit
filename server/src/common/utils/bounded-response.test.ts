import { boundedResponse, readBoundedBytes, readBoundedText, ResponseTooLargeError } from './bounded-response';

/** A body that never ends, and counts how much of it anyone actually pulled. */
function endlessBody(chunkBytes: number): { response: Response; pulled: () => number } {
  let pulls = 0;
  // No read-ahead, so the count is what the reader asked for rather than what the queue primed.
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(chunkBytes));
      },
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(stream), pulled: () => pulls };
}

describe('readBoundedBytes', () => {
  it('returns a body that fits', async () => {
    await expect(readBoundedBytes(new Response('a real file'), 1024)).resolves.toEqual(Buffer.from('a real file'));
  });

  /** The point of the header check: nothing is read at all when the sender already said too much. */
  it('refuses an over-declared body before reading it', async () => {
    const { response, pulled } = endlessBody(1024);
    const declared = new Response(response.body, { headers: { 'content-length': String(64 * 1024) } });

    await expect(readBoundedBytes(declared, 1024)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(pulled()).toBe(0);
  });

  /**
   * The case the header check cannot cover, and the one that matters: a chunked body with nothing
   * declared has to fail at the ceiling rather than once it is all resident.
   */
  it('stops an endless body at the ceiling rather than after buffering it', async () => {
    const chunk = 1024;
    const limit = 16 * chunk;
    const { response, pulled } = endlessBody(chunk);

    await expect(readBoundedBytes(response, limit)).rejects.toBeInstanceOf(ResponseTooLargeError);
    // One chunk past the ceiling is what it takes to notice; anything more is buffering.
    expect(pulled()).toBe(limit / chunk + 1);
  });

  it('accepts a body of exactly the ceiling', async () => {
    const body = new Response(new Uint8Array(1024));

    await expect(readBoundedBytes(body, 1024)).resolves.toHaveLength(1024);
  });

  it('reads a body with no content at all as empty', async () => {
    await expect(readBoundedBytes(new Response(null, { status: 204 }), 1024)).resolves.toHaveLength(0);
  });
});

describe('readBoundedText', () => {
  it('decodes what it read', async () => {
    await expect(readBoundedText(new Response('<rss/>'), 1024)).resolves.toBe('<rss/>');
  });
});

describe('boundedResponse', () => {
  it('hands back a response that still reads normally', async () => {
    const wrapped = boundedResponse(new Response('ok', { status: 201, headers: { 'x-source': 'tracker' } }), 1024);

    expect(wrapped.status).toBe(201);
    expect(wrapped.headers.get('x-source')).toBe('tracker');
    await expect(wrapped.text()).resolves.toBe('ok');
  });

  it('refuses an over-declared body without reading it', () => {
    const declared = new Response('x', { headers: { 'content-length': String(64 * 1024) } });

    expect(() => boundedResponse(declared, 1024)).toThrow(ResponseTooLargeError);
  });

  /** Whatever the reader does with the stream, it cannot get more than the ceiling out of it. */
  it('errors the stream at the ceiling for whoever is reading it', async () => {
    const chunk = 1024;
    const limit = 16 * chunk;
    const { response, pulled } = endlessBody(chunk);

    const wrapped = boundedResponse(response, limit);

    await expect(wrapped.arrayBuffer()).rejects.toThrow();
    expect(pulled()).toBeLessThanOrEqual(limit / chunk + 2);
  });

  /** A relative link on a page a plugin fetched is resolved against this. */
  it('keeps the URL the response came from', () => {
    const original = new Response('ok');
    Object.defineProperty(original, 'url', { value: 'https://tracker.example.com/page' });

    expect(boundedResponse(original, 1024).url).toBe('https://tracker.example.com/page');
  });

  /** A 304 carries no body, and the Response constructor refuses to give it one. */
  it('leaves a status that cannot carry a body alone', () => {
    const notModified = new Response(null, { status: 304 });

    expect(boundedResponse(notModified, 1024)).toBe(notModified);
  });
});
