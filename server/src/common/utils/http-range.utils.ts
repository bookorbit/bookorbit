import { open } from 'fs/promises';

import type { FastifyReply } from 'fastify';

const MAX_RANGE_DIGITS = 15;

/**
 * How long a file must have been untouched before its entity tag is advertised
 * as strong. Filesystem timestamp resolution is 1s on many of the mounts this
 * project targets and 2s on FAT/exFAT, so a rewrite inside that window can land
 * on the same recorded mtime as the read that preceded it.
 */
const MTIME_TICK_MS = 2000;

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * A parsed range spec, `unsatisfiable` when it addresses bytes past the end of
 * the file, or null when the request carries no usable range and the full
 * representation must be sent.
 */
export type ParsedRange = ByteRange | 'unsatisfiable' | null;

/**
 * Range headers as they arrive from a client, threaded down to the stream
 * helper. A repeated header reaches Fastify as an array, which is malformed for
 * both of these: a repeated Range means no usable range, while a repeated
 * If-Range means an unmet precondition rather than an absent one.
 */
export interface FileRangeRequest {
  rangeHeader?: string | string[];
  ifRangeHeader?: string | string[];
}

/**
 * Identity of the bytes on disk, read from a single `stat({ bigint: true })`.
 * `size` stays a number because the range arithmetic and `createReadStream` both
 * reject bigints; the two fields that feed the entity tag stay bigint because
 * nanosecond timestamps are past `Number.MAX_SAFE_INTEGER`.
 */
export interface FileIdentity {
  size: number;
  mtimeNs: bigint;
  ino: bigint;
}

export interface FileStreamOptions extends FileRangeRequest {
  path: string;
  contentType: string;
  contentDisposition?: string;
}

/**
 * `size` is reported back because the helper is now the only place that stats
 * the file, and every caller logs the served size.
 */
export interface FileStreamResult {
  status: 200 | 206 | 416;
  size: number;
  start: number;
  end: number;
  partial: boolean;
}

/**
 * The digit cap is what keeps the result exact: the caller only ever passes a
 * run of digits, and 15 of them cannot reach `Number.MAX_SAFE_INTEGER`, so
 * anything that clears the length check parses to an offset the range
 * arithmetic can hold.
 */
function parseByteCount(value: string): number | null {
  if (value.length === 0 || value.length > MAX_RANGE_DIGITS) return null;
  return Number.parseInt(value, 10);
}

/**
 * Size alone collides on any same-length rewrite, and a millisecond mtime adds
 * nothing on a mount that records seconds. The inode is the component that moves
 * for every rewrite this server performs, since they all go through
 * `replaceFileAtomically`. Rendered unsigned so a mount reporting a 64-bit inode
 * as negative still produces a canonical tag.
 */
export function buildFileEtag({ size, mtimeNs, ino }: FileIdentity): string {
  return `"${size.toString(16)}-${BigInt.asUintN(64, mtimeNs).toString(16)}-${BigInt.asUintN(64, ino).toString(16)}"`;
}

function mtimeMsOf(mtimeNs: bigint): number {
  return Number(mtimeNs / 1_000_000n);
}

/**
 * Whether the recorded mtime is old enough that another write cannot still be
 * hiding inside the same filesystem tick.
 *
 * The guard has to run when the tag is minted, not when it is compared. On a
 * 1s-resolution mount: a GET at 12:00:00.2 reads mtime 12:00:00.0 and mints tag
 * E; a foreign same-size rewrite at 12:00:00.7 truncates to the same mtime and
 * keeps the same inode, so the tag is still E; a resume at 12:00:06 is 6s past
 * the mtime and would pass any compare-time check, then splice. Refusing to
 * call E strong at 12:00:00.2 is what closes that.
 */
export function isMtimeSettled(mtimeMs: number, now: number = Date.now()): boolean {
  return now - mtimeMs >= MTIME_TICK_MS;
}

/**
 * Parses a single byte range. Multi-range requests and syntactically invalid
 * specs resolve to null: RFC 9110 lets a server answer either with the full
 * representation, which keeps one read stream per response.
 */
export function parseRangeHeader(header: string | string[] | undefined, size: number): ParsedRange {
  if (typeof header !== 'string' || header === '') return null;
  const spec = /^bytes\s*=(.*)$/i.exec(header.trim());
  if (!spec) return null;
  if (spec[1].includes(',')) return null;

  const match = /^\s*(\d*)\s*-\s*(\d*)\s*$/.exec(spec[1]);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;

  if (rawStart === '') {
    const suffix = parseByteCount(rawEnd);
    if (suffix === null) return null;
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = parseByteCount(rawStart);
  if (start === null) return null;
  if (start >= size) return 'unsatisfiable';
  if (rawEnd === '') return { start, end: size - 1 };

  const end = parseByteCount(rawEnd);
  if (end === null || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * If-Range demands strong comparison, so a weak entity tag never authorizes a
 * partial response: the client gets the full file back instead of silently
 * splicing bytes from a representation that may have changed. `strongEtag` is
 * null while the mtime tick is still open, which declines every If-Range for
 * the duration.
 *
 * Only a genuinely absent header skips the check. Everything else that is not a
 * matching strong tag is unsatisfied: a repeated header arrives as an array and
 * guessing which value the client meant could splice, and an empty value is a
 * validator that parses as nothing, so honouring it would hand a client that
 * asked for the guarantee exactly none of it. The HTTP-date form is refused
 * outright: RFC 9110 13.1.3 admits it only where the date is itself a strong
 * validator, and a filesystem second is not, which made the date branch strictly
 * weaker than the tag beside it.
 */
export function isIfRangeSatisfied(ifRangeHeader: string | string[] | undefined, strongEtag: string | null): boolean {
  if (ifRangeHeader === undefined) return true;
  if (typeof ifRangeHeader !== 'string') return false;
  return strongEtag !== null && ifRangeHeader.trim() === strongEtag;
}

/**
 * Sends a file with range support and returns what was actually served, so the
 * caller can log the outcome. Partial responses carry Content-Range, which also
 * keeps @fastify/compress off the payload: its byte offsets describe the
 * unencoded representation.
 *
 * The descriptor is opened once and both the stat and the read stream hang off
 * it, so the identity in the headers and the bytes in the body always come from
 * the same inode. Statting a path and then opening it again leaves a window in
 * which a rewrite swaps the file underneath: the response would advertise the
 * old entity tag and Content-Length while streaming the new file, which resumes
 * a splice for an If-Range client and misframes the body for everyone else.
 *
 * Missing paths surface as the raw fs error; callers translate that into a 404,
 * matching the convention `isMissingFilesystemEntry` documents.
 *
 * A file written within the last MTIME_TICK_MS goes out with a weak tag, which
 * costs it If-Range resumes until the tick closes. The weak form is still sent
 * rather than no tag at all, because If-None-Match revalidation is defined on
 * weak comparison and keeps working. A bare Range with no If-Range is answered
 * 206 either way, so ordinary streaming is unaffected.
 */
export async function sendFileWithRanges(reply: FastifyReply, options: FileStreamOptions): Promise<FileStreamResult> {
  const handle = await open(options.path, 'r');
  let handedOff = false;

  try {
    const stats = await handle.stat({ bigint: true });
    const identity: FileIdentity = { size: Number(stats.size), mtimeNs: stats.mtimeNs, ino: stats.ino };
    const { size } = identity;
    const etag = buildFileEtag(identity);
    const mtimeMs = mtimeMsOf(identity.mtimeNs);
    const strongEtag = isMtimeSettled(mtimeMs) ? etag : null;

    reply.header('Accept-Ranges', 'bytes');
    reply.header('ETag', strongEtag ?? `W/${etag}`);
    reply.header('Last-Modified', new Date(mtimeMs).toUTCString());
    if (options.contentDisposition) reply.header('Content-Disposition', options.contentDisposition);
    reply.type(options.contentType);

    const range = isIfRangeSatisfied(options.ifRangeHeader, strongEtag) ? parseRangeHeader(options.rangeHeader, size) : null;

    if (range === 'unsatisfiable') {
      reply.status(416);
      reply.header('Content-Range', `bytes */${size}`);
      reply.send();
      return { status: 416, size, start: 0, end: 0, partial: false };
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : Math.max(0, size - 1);

    if (range) {
      reply.status(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
      reply.header('Content-Length', end - start + 1);
    } else {
      reply.header('Content-Length', size);
    }

    // `start` is explicit on both paths: without it the stream reads from the
    // descriptor's current position rather than the head of the file.
    const stream = range ? handle.createReadStream({ start, end }) : handle.createReadStream({ start: 0 });
    handedOff = true;
    try {
      reply.send(stream);
    } catch (err) {
      stream.destroy();
      throw err;
    }

    return { status: range ? 206 : 200, size, start, end, partial: Boolean(range) };
  } finally {
    // Once the stream owns the descriptor it closes it on both end and destroy,
    // and closing here would truncate a body Fastify has not written yet.
    if (!handedOff) await handle.close();
  }
}
