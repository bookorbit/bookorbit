import { createHash } from 'node:crypto';

export interface FileValidators {
  etag: string;
  lastModified: string;
}

export interface FileConditionalHeaders {
  range?: string;
  ifRange?: string;
  ifNoneMatch?: string;
}

export type FileResponsePlan =
  { kind: 'full' } | { kind: 'partial'; start: number; end: number } | { kind: 'not-modified' } | { kind: 'unsatisfiable' };

const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/i;

/**
 * Strong validators for a file on disk. Range responses and resumed downloads (URLSession sends
 * `If-Range` from resume data) splice byte offsets, so the ETag must change whenever the bytes can.
 */
export function fileValidators(file: { id: number; size: number; mtimeMs: number }): FileValidators {
  const mtime = Math.floor(file.mtimeMs);
  return {
    etag: `"${createHash('sha256').update(`${file.id}:${file.size}:${mtime}`).digest('hex')}"`,
    lastModified: new Date(mtime).toUTCString(),
  };
}

export function planFileResponse(size: number, validators: FileValidators, headers: FileConditionalHeaders): FileResponsePlan {
  const range = headers.range?.trim();
  if (!range) {
    return headers.ifNoneMatch !== undefined && matchesAnyEntityTag(headers.ifNoneMatch, validators.etag)
      ? { kind: 'not-modified' }
      : { kind: 'full' };
  }
  // A stale If-Range means the client's partial copy belongs to an older file: send all of it.
  if (headers.ifRange !== undefined && !ifRangeMatches(headers.ifRange, validators)) return { kind: 'full' };
  return parseSingleByteRange(range, size) ?? { kind: 'full' };
}

/**
 * RFC 9110 single byte range. Returns null for anything this server chooses to ignore (other units,
 * multiple ranges, malformed or inverted specs), which the caller answers with the whole file.
 */
export function parseSingleByteRange(header: string, size: number): FileResponsePlan | null {
  const match = SINGLE_BYTE_RANGE.exec(header.trim());
  if (!match) return null;
  const [, first, last] = match;
  if (!first && !last) return null;

  if (!first) {
    const suffixLength = Number(last);
    if (suffixLength === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(first);
  const end = last ? Number(last) : size - 1;
  if (last && end < start) return null;
  if (start >= size) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end: Math.min(end, size - 1) };
}

function ifRangeMatches(ifRange: string, validators: FileValidators): boolean {
  const value = ifRange.trim();
  // If-Range needs a strong comparison, so a weak tag never matches.
  if (value.startsWith('"') || value.startsWith('W/')) return value === validators.etag;
  const date = Date.parse(value);
  return Number.isFinite(date) && date === Date.parse(validators.lastModified);
}

function matchesAnyEntityTag(header: string, etag: string): boolean {
  const value = header.trim();
  if (value === '*') return true;
  const opaque = stripWeakPrefix(etag);
  return value.split(',').some((candidate) => stripWeakPrefix(candidate.trim()) === opaque);
}

function stripWeakPrefix(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}
