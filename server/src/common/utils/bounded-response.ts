/**
 * Reading a response from a source BookOrbit does not control, without letting that source decide
 * how much memory the read costs.
 *
 * Two guards, because a body is only ever as honest as its sender. `Content-Length` is checked
 * first, so an over-declared response fails before a byte is read; the stream is then counted as
 * it arrives, so an understated or chunked one fails at the ceiling rather than after the whole
 * thing is already resident.
 */
export class ResponseTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`The response was larger than the ${limitBytes} byte limit`);
    this.name = 'ResponseTooLargeError';
  }
}

/** Statuses the Response constructor refuses to attach a body to, so they are handed back as-is. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** What the sender claims, where it claims anything readable. */
function declaredLength(response: Response): number | null {
  const header = response.headers.get('content-length');
  if (header === null) return null;
  const declared = Number(header);
  return Number.isFinite(declared) && declared >= 0 ? declared : null;
}

function refuseIfDeclaredTooLarge(response: Response, limitBytes: number): void {
  const declared = declaredLength(response);
  if (declared !== null && declared > limitBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(limitBytes);
  }
}

/** Reads a whole body, stopping at `limitBytes` rather than discovering the size once resident. */
export async function readBoundedBytes(response: Response, limitBytes: number): Promise<Buffer> {
  refuseIfDeclaredTooLarge(response, limitBytes);
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limitBytes) throw new ResponseTooLargeError(limitBytes);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks, size);
}

export async function readBoundedText(response: Response, limitBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(response, limitBytes));
}

/**
 * The same ceiling, for a body someone else will read.
 *
 * Handing a raw `Response` to a plugin makes the size of what it reads the plugin's choice; this
 * keeps it ours, whatever the plugin does with the stream.
 */
export function boundedResponse(response: Response, limitBytes: number): Response {
  refuseIfDeclaredTooLarge(response, limitBytes);
  if (!response.body || NULL_BODY_STATUSES.has(response.status)) return response;

  let seen = 0;
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limitBytes) throw new ResponseTooLargeError(limitBytes);
        controller.enqueue(chunk);
      },
    }),
  );

  const wrapped = new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
  // Rebuilding the response otherwise reports the URL as empty, and a plugin that follows a
  // relative link off a page it fetched would resolve it against nothing.
  Object.defineProperty(wrapped, 'url', { value: response.url, enumerable: true });
  return wrapped;
}
