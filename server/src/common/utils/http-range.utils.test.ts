import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs/promises', () => ({ open: vi.fn() }));

import { open } from 'fs/promises';

import { buildFileEtag, isIfRangeSatisfied, isMtimeSettled, parseRangeHeader, sendFileWithRanges } from './http-range.utils';

const mockOpen = vi.mocked(open);

// The send tests run against a frozen clock: `isMtimeSettled` compares the
// recorded mtime to `Date.now()`, so a fixture derived from the real clock would
// cross the tick boundary mid-suite and flip the tag it asserts on.
const NOW_MS = 1_700_000_010_000;
const SETTLED_MTIME_MS = 1_700_000_000_000;
const SETTLED_MTIME_NS = 1_700_000_000_000_000_000n;
const OPEN_TICK_MTIME_MS = NOW_MS - 500;
const OPEN_TICK_MTIME_NS = BigInt(OPEN_TICK_MTIME_MS) * 1_000_000n;

function makeReply() {
  const headers: Record<string, string | number> = {};
  const reply = {
    header: vi.fn((key: string, value: string | number) => {
      headers[key] = value;
      return reply;
    }),
    type: vi.fn(() => reply),
    status: vi.fn(() => reply),
    send: vi.fn(() => reply),
  };
  return { reply, headers };
}

type StubIdentity = { size?: number; mtimeNs?: bigint; ino?: bigint };

function stubOpen(identity: StubIdentity = {}) {
  const stream = { destroy: vi.fn() };
  const handle = {
    stat: vi.fn(() =>
      Promise.resolve({
        size: BigInt(identity.size ?? 500),
        mtimeNs: identity.mtimeNs ?? SETTLED_MTIME_NS,
        ino: identity.ino ?? 42n,
      }),
    ),
    createReadStream: vi.fn(() => stream),
    close: vi.fn(() => Promise.resolve(undefined)),
  };
  mockOpen.mockResolvedValue(handle as never);
  return { handle, stream };
}

describe('parseRangeHeader', () => {
  it('parses closed, open and suffix ranges', () => {
    expect(parseRangeHeader('bytes=10-19', 500)).toEqual({ start: 10, end: 19 });
    expect(parseRangeHeader('bytes=10-', 500)).toEqual({ start: 10, end: 499 });
    expect(parseRangeHeader('bytes=-100', 500)).toEqual({ start: 400, end: 499 });
  });

  it('tolerates whitespace and header casing', () => {
    expect(parseRangeHeader('  Bytes = 10 - 19 ', 500)).toEqual({ start: 10, end: 19 });
  });

  it('clamps an end past the last byte instead of rejecting the request', () => {
    expect(parseRangeHeader('bytes=490-99999', 500)).toEqual({ start: 490, end: 499 });
    expect(parseRangeHeader('bytes=-99999', 500)).toEqual({ start: 0, end: 499 });
  });

  it('reports ranges that start past the end as unsatisfiable', () => {
    expect(parseRangeHeader('bytes=500-', 500)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=600-700', 500)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=-0', 500)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=0-', 0)).toBe('unsatisfiable');
  });

  it('falls back to the full representation for absent, malformed and multi-range specs', () => {
    expect(parseRangeHeader(undefined, 500)).toBeNull();
    expect(parseRangeHeader('', 500)).toBeNull();
    expect(parseRangeHeader('items=0-10', 500)).toBeNull();
    expect(parseRangeHeader('bytes=-', 500)).toBeNull();
    expect(parseRangeHeader('bytes=abc-def', 500)).toBeNull();
    expect(parseRangeHeader('bytes=20-10', 500)).toBeNull();
    expect(parseRangeHeader('bytes=0-10,20-30', 500)).toBeNull();
  });

  it('rejects offsets that cannot be represented exactly', () => {
    expect(parseRangeHeader('bytes=99999999999999999999-', 500)).toBeNull();
  });
});

describe('buildFileEtag', () => {
  it('renders size, nanosecond mtime and inode as three hex fields in one pair of quotes', () => {
    expect(buildFileEtag({ size: 500, mtimeNs: SETTLED_MTIME_NS, ino: 42n })).toBe('"1f4-17979cfe362a0000-2a"');
  });

  it('renders a negative inode unsigned so mounts that overflow still produce a canonical tag', () => {
    expect(buildFileEtag({ size: 500, mtimeNs: SETTLED_MTIME_NS, ino: -2n })).toBe('"1f4-17979cfe362a0000-fffffffffffffffe"');
  });

  it('separates two files that differ only in inode', () => {
    const a = buildFileEtag({ size: 500, mtimeNs: SETTLED_MTIME_NS, ino: 42n });
    const b = buildFileEtag({ size: 500, mtimeNs: SETTLED_MTIME_NS, ino: 43n });
    expect(a).not.toBe(b);
  });
});

describe('isMtimeSettled', () => {
  it('refuses a file written inside the filesystem tick window', () => {
    expect(isMtimeSettled(10_000, 10_000)).toBe(false);
    expect(isMtimeSettled(10_000, 11_999)).toBe(false);
  });

  it('accepts a file whose tick has closed', () => {
    expect(isMtimeSettled(10_000, 12_000)).toBe(true);
    expect(isMtimeSettled(10_000, 60_000)).toBe(true);
  });

  it('fails safe on a clock that reads behind the recorded mtime', () => {
    expect(isMtimeSettled(10_000, 9_000)).toBe(false);
  });
});

describe('isIfRangeSatisfied', () => {
  const etag = buildFileEtag({ size: 500, mtimeNs: SETTLED_MTIME_NS, ino: 42n });
  const lastModified = new Date(SETTLED_MTIME_MS).toUTCString();

  it('accepts a missing header and a matching strong entity tag', () => {
    expect(isIfRangeSatisfied(undefined, etag)).toBe(true);
    expect(isIfRangeSatisfied(etag, etag)).toBe(true);
  });

  it('rejects the HTTP-date form, which a filesystem second cannot make strong', () => {
    expect(isIfRangeSatisfied(lastModified, etag)).toBe(false);
    expect(isIfRangeSatisfied(new Date(1_600_000_000_000).toUTCString(), etag)).toBe(false);
  });

  it('rejects a stale validator and any weak entity tag', () => {
    expect(isIfRangeSatisfied('"deadbeef-1"', etag)).toBe(false);
    expect(isIfRangeSatisfied(`W/${etag}`, etag)).toBe(false);
    expect(isIfRangeSatisfied('not-a-date', etag)).toBe(false);
  });

  it('rejects an empty validator rather than reading it as an absent header', () => {
    expect(isIfRangeSatisfied('', etag)).toBe(false);
    expect(isIfRangeSatisfied('   ', etag)).toBe(false);
  });

  it('rejects every validator while no strong tag exists', () => {
    expect(isIfRangeSatisfied(etag, null)).toBe(false);
    expect(isIfRangeSatisfied(lastModified, null)).toBe(false);
    expect(isIfRangeSatisfied(undefined, null)).toBe(true);
  });

  it('rejects a repeated header rather than treating it as absent', () => {
    expect(isIfRangeSatisfied([etag, etag], etag)).toBe(false);
    expect(isIfRangeSatisfied([etag], etag)).toBe(false);
    expect(isIfRangeSatisfied([], etag)).toBe(false);
  });
});

describe('sendFileWithRanges', () => {
  const base = { path: '/books/book.epub', contentType: 'application/epub+zip' };
  const settledEtag = buildFileEtag({ size: 500, mtimeNs: SETTLED_MTIME_NS, ino: 42n });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    stubOpen();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockOpen.mockReset();
  });

  it('sends the full file with validators when no range is requested', async () => {
    const { reply, headers } = makeReply();
    const { handle } = stubOpen();

    const result = await sendFileWithRanges(reply as never, { ...base, contentDisposition: 'attachment; filename="book.epub"' });

    expect(result).toEqual({ status: 200, size: 500, start: 0, end: 499, partial: false });
    expect(headers['Accept-Ranges']).toBe('bytes');
    expect(headers['ETag']).toBe(settledEtag);
    expect(headers['Last-Modified']).toBe(new Date(SETTLED_MTIME_MS).toUTCString());
    expect(headers['Content-Disposition']).toBe('attachment; filename="book.epub"');
    expect(headers['Content-Length']).toBe(500);
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(handle.createReadStream).toHaveBeenCalledWith({ start: 0 });
  });

  it('reads the identity and the bytes from one descriptor, never from the path twice', async () => {
    const { reply } = makeReply();
    const { handle, stream } = stubOpen();

    await sendFileWithRanges(reply as never, base);

    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledWith('/books/book.epub', 'r');
    expect(handle.stat).toHaveBeenCalledWith({ bigint: true });
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('leaves the descriptor to the stream once a body is on its way out', async () => {
    const { reply } = makeReply();
    const { handle } = stubOpen();

    await sendFileWithRanges(reply as never, base);

    expect(handle.close).not.toHaveBeenCalled();
  });

  it('sends partial content for a resume range', async () => {
    const { reply, headers } = makeReply();
    const { handle } = stubOpen();

    const result = await sendFileWithRanges(reply as never, { ...base, rangeHeader: 'bytes=200-' });

    expect(result).toEqual({ status: 206, size: 500, start: 200, end: 499, partial: true });
    expect(reply.status).toHaveBeenCalledWith(206);
    expect(headers['Content-Range']).toBe('bytes 200-499/500');
    expect(headers['Content-Length']).toBe(300);
    expect(handle.createReadStream).toHaveBeenCalledWith({ start: 200, end: 499 });
  });

  it('answers an unsatisfiable range with 416, no stream, and a closed descriptor', async () => {
    const { reply, headers } = makeReply();
    const { handle } = stubOpen();

    const result = await sendFileWithRanges(reply as never, { ...base, rangeHeader: 'bytes=600-700' });

    expect(result.status).toBe(416);
    expect(reply.status).toHaveBeenCalledWith(416);
    expect(headers['Content-Range']).toBe('bytes */500');
    expect(handle.createReadStream).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('closes the descriptor when the stat behind it fails', async () => {
    const { reply } = makeReply();
    const { handle } = stubOpen();
    handle.stat.mockRejectedValueOnce(new Error('EIO'));

    await expect(sendFileWithRanges(reply as never, base)).rejects.toThrow('EIO');
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it('destroys the stream when the reply refuses it, so the descriptor is not orphaned', async () => {
    const { reply } = makeReply();
    const { stream } = stubOpen();
    reply.send.mockImplementationOnce(() => {
      throw new Error('reply already sent');
    });

    await expect(sendFileWithRanges(reply as never, base)).rejects.toThrow('reply already sent');
    expect(stream.destroy).toHaveBeenCalledTimes(1);
  });

  it('surfaces a missing path as the raw fs error for the caller to map', async () => {
    const { reply } = makeReply();
    const missing = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockOpen.mockRejectedValueOnce(missing);

    await expect(sendFileWithRanges(reply as never, base)).rejects.toBe(missing);
  });

  it('ignores the range when If-Range no longer matches the file', async () => {
    const { reply, headers } = makeReply();
    const { handle } = stubOpen();

    const result = await sendFileWithRanges(reply as never, { ...base, rangeHeader: 'bytes=200-', ifRangeHeader: '"stale-1"' });

    expect(result).toEqual({ status: 200, size: 500, start: 0, end: 499, partial: false });
    expect(headers['Content-Range']).toBeUndefined();
    expect(headers['Content-Length']).toBe(500);
    expect(handle.createReadStream).toHaveBeenCalledWith({ start: 0 });
  });

  it('ignores the range when If-Range arrives repeated', async () => {
    const { reply, headers } = makeReply();

    const result = await sendFileWithRanges(reply as never, { ...base, rangeHeader: 'bytes=200-', ifRangeHeader: [settledEtag, settledEtag] });

    expect(result).toEqual({ status: 200, size: 500, start: 0, end: 499, partial: false });
    expect(headers['Content-Range']).toBeUndefined();
  });

  it('ignores the range when If-Range arrives empty', async () => {
    const { reply, headers } = makeReply();

    const result = await sendFileWithRanges(reply as never, { ...base, rangeHeader: 'bytes=200-', ifRangeHeader: '' });

    expect(result).toEqual({ status: 200, size: 500, start: 0, end: 499, partial: false });
    expect(headers['Content-Range']).toBeUndefined();
  });

  it('ignores the range when If-Range carries the Last-Modified date', async () => {
    const { reply, headers } = makeReply();

    const result = await sendFileWithRanges(reply as never, {
      ...base,
      rangeHeader: 'bytes=200-',
      ifRangeHeader: new Date(SETTLED_MTIME_MS).toUTCString(),
    });

    expect(result).toEqual({ status: 200, size: 500, start: 0, end: 499, partial: false });
    expect(headers['Content-Range']).toBeUndefined();
  });

  it('serves the range when If-Range still matches the file', async () => {
    const { reply, headers } = makeReply();

    const result = await sendFileWithRanges(reply as never, { ...base, rangeHeader: 'bytes=200-', ifRangeHeader: settledEtag });

    expect(result.partial).toBe(true);
    expect(headers['Content-Range']).toBe('bytes 200-499/500');
  });

  it('weakens the tag for a file still inside the filesystem tick window', async () => {
    const { reply, headers } = makeReply();
    stubOpen({ mtimeNs: OPEN_TICK_MTIME_NS });

    const result = await sendFileWithRanges(reply as never, base);

    expect(result.status).toBe(200);
    expect(headers['ETag']).toBe(`W/${buildFileEtag({ size: 500, mtimeNs: OPEN_TICK_MTIME_NS, ino: 42n })}`);
  });

  it('declines If-Range while the tick window is open, even for the tag it just sent', async () => {
    const { reply, headers } = makeReply();
    stubOpen({ mtimeNs: OPEN_TICK_MTIME_NS });

    const result = await sendFileWithRanges(reply as never, {
      ...base,
      rangeHeader: 'bytes=200-',
      ifRangeHeader: buildFileEtag({ size: 500, mtimeNs: OPEN_TICK_MTIME_NS, ino: 42n }),
    });

    expect(result).toEqual({ status: 200, size: 500, start: 0, end: 499, partial: false });
    expect(headers['Content-Range']).toBeUndefined();
  });

  it('sends an empty file as a zero-length body rather than a negative end offset', async () => {
    const { reply, headers } = makeReply();
    const { handle } = stubOpen({ size: 0 });

    const result = await sendFileWithRanges(reply as never, base);

    expect(result).toEqual({ status: 200, size: 0, start: 0, end: 0, partial: false });
    expect(headers['Content-Length']).toBe(0);
    expect(handle.createReadStream).toHaveBeenCalledWith({ start: 0 });
  });

  it('still answers a bare range with 206 inside the tick window', async () => {
    const { reply, headers } = makeReply();
    stubOpen({ mtimeNs: OPEN_TICK_MTIME_NS });

    const result = await sendFileWithRanges(reply as never, { ...base, rangeHeader: 'bytes=200-' });

    expect(result).toEqual({ status: 206, size: 500, start: 200, end: 499, partial: true });
    expect(headers['Content-Range']).toBe('bytes 200-499/500');
  });
});
