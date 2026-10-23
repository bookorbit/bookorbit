import { describe, expect, it } from 'vitest';

import { fileValidators, parseSingleByteRange, planFileResponse } from './file-range.utils';

const SIZE = 1000;
const MTIME_MS = Date.UTC(2026, 0, 2, 3, 4, 5, 678);
const validators = fileValidators({ id: 42, size: SIZE, mtimeMs: MTIME_MS });

describe('fileValidators', () => {
  it('builds a strong quoted ETag and an HTTP-date Last-Modified', () => {
    expect(validators.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(validators.lastModified).toBe('Fri, 02 Jan 2026 03:04:05 GMT');
  });

  it('is stable for the same file and changes when its id, size or mtime changes', () => {
    expect(fileValidators({ id: 42, size: SIZE, mtimeMs: MTIME_MS }).etag).toBe(validators.etag);
    expect(fileValidators({ id: 42, size: SIZE, mtimeMs: MTIME_MS + 0.4 }).etag).toBe(validators.etag);
    expect(fileValidators({ id: 43, size: SIZE, mtimeMs: MTIME_MS }).etag).not.toBe(validators.etag);
    expect(fileValidators({ id: 42, size: SIZE + 1, mtimeMs: MTIME_MS }).etag).not.toBe(validators.etag);
    expect(fileValidators({ id: 42, size: SIZE, mtimeMs: MTIME_MS + 1 }).etag).not.toBe(validators.etag);
  });
});

describe('parseSingleByteRange', () => {
  it('serves a closed range', () => {
    expect(parseSingleByteRange('bytes=10-19', SIZE)).toEqual({ kind: 'partial', start: 10, end: 19 });
  });

  it('serves an open-ended range to the last byte', () => {
    expect(parseSingleByteRange('bytes=900-', SIZE)).toEqual({ kind: 'partial', start: 900, end: 999 });
  });

  it('clamps an end past the file instead of rejecting it', () => {
    expect(parseSingleByteRange('bytes=900-5000', SIZE)).toEqual({ kind: 'partial', start: 900, end: 999 });
    expect(parseSingleByteRange('bytes=0-999', SIZE)).toEqual({ kind: 'partial', start: 0, end: 999 });
  });

  it('serves suffix ranges as the last N bytes', () => {
    expect(parseSingleByteRange('bytes=-100', SIZE)).toEqual({ kind: 'partial', start: 900, end: 999 });
    expect(parseSingleByteRange('bytes=-5000', SIZE)).toEqual({ kind: 'partial', start: 0, end: 999 });
  });

  it('rejects ranges that start at or past the end, and an empty suffix', () => {
    expect(parseSingleByteRange('bytes=1000-', SIZE)).toEqual({ kind: 'unsatisfiable' });
    expect(parseSingleByteRange('bytes=1000-1200', SIZE)).toEqual({ kind: 'unsatisfiable' });
    expect(parseSingleByteRange('bytes=-0', SIZE)).toEqual({ kind: 'unsatisfiable' });
    expect(parseSingleByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
    expect(parseSingleByteRange('bytes=-10', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('ignores malformed, inverted, multi-range and foreign-unit headers', () => {
    for (const header of ['bytes=', 'bytes=-', 'bytes=abc-', 'bytes=20-10', 'bytes=0-1,5-6', 'items=0-1', 'pages 0-1', 'xbytes=0-1']) {
      expect(parseSingleByteRange(header, SIZE)).toBeNull();
    }
  });

  it('accepts the unit case-insensitively and tolerates surrounding whitespace', () => {
    expect(parseSingleByteRange(' Bytes=0-0 ', SIZE)).toEqual({ kind: 'partial', start: 0, end: 0 });
  });
});

describe('planFileResponse', () => {
  it('sends the whole file when no range is asked for', () => {
    expect(planFileResponse(SIZE, validators, {})).toEqual({ kind: 'full' });
    expect(planFileResponse(SIZE, validators, { range: '' })).toEqual({ kind: 'full' });
  });

  it('serves a range without If-Range', () => {
    expect(planFileResponse(SIZE, validators, { range: 'bytes=500-' })).toEqual({ kind: 'partial', start: 500, end: 999 });
  });

  it('resumes when If-Range carries the current ETag', () => {
    expect(planFileResponse(SIZE, validators, { range: 'bytes=500-', ifRange: validators.etag })).toEqual({
      kind: 'partial',
      start: 500,
      end: 999,
    });
  });

  it('resumes when If-Range carries the current Last-Modified date', () => {
    expect(planFileResponse(SIZE, validators, { range: 'bytes=500-', ifRange: validators.lastModified })).toEqual({
      kind: 'partial',
      start: 500,
      end: 999,
    });
  });

  it('sends the whole file when If-Range names an older ETag or date', () => {
    const older = fileValidators({ id: 42, size: SIZE, mtimeMs: MTIME_MS - 60_000 });
    expect(planFileResponse(SIZE, validators, { range: 'bytes=500-', ifRange: older.etag })).toEqual({ kind: 'full' });
    expect(planFileResponse(SIZE, validators, { range: 'bytes=500-', ifRange: older.lastModified })).toEqual({ kind: 'full' });
    expect(planFileResponse(SIZE, validators, { range: 'bytes=500-', ifRange: 'not a date' })).toEqual({ kind: 'full' });
  });

  it('never resumes from a weak If-Range tag', () => {
    expect(planFileResponse(SIZE, validators, { range: 'bytes=500-', ifRange: `W/${validators.etag}` })).toEqual({ kind: 'full' });
  });

  it('sends the whole file rather than 416 when a stale If-Range resumes past the new end', () => {
    const older = fileValidators({ id: 42, size: 5000, mtimeMs: MTIME_MS - 60_000 });
    expect(planFileResponse(SIZE, validators, { range: 'bytes=4000-', ifRange: older.etag })).toEqual({ kind: 'full' });
  });

  it('answers 416 for an unsatisfiable range that If-Range still validates', () => {
    expect(planFileResponse(SIZE, validators, { range: 'bytes=4000-', ifRange: validators.etag })).toEqual({ kind: 'unsatisfiable' });
  });

  it('sends the whole file for a range it ignores', () => {
    expect(planFileResponse(SIZE, validators, { range: 'bytes=0-1,5-6' })).toEqual({ kind: 'full' });
  });

  it('answers 304 when If-None-Match lists the current ETag on a plain GET', () => {
    expect(planFileResponse(SIZE, validators, { ifNoneMatch: validators.etag })).toEqual({ kind: 'not-modified' });
    expect(planFileResponse(SIZE, validators, { ifNoneMatch: `"other", W/${validators.etag}` })).toEqual({ kind: 'not-modified' });
    expect(planFileResponse(SIZE, validators, { ifNoneMatch: '*' })).toEqual({ kind: 'not-modified' });
  });

  it('sends the file when If-None-Match does not match', () => {
    expect(planFileResponse(SIZE, validators, { ifNoneMatch: '"other"' })).toEqual({ kind: 'full' });
  });

  it('keeps serving ranges when If-None-Match accompanies a Range header', () => {
    expect(planFileResponse(SIZE, validators, { range: 'bytes=0-9', ifNoneMatch: validators.etag })).toEqual({
      kind: 'partial',
      start: 0,
      end: 9,
    });
  });

  it('ignores If-Range without a Range header', () => {
    expect(planFileResponse(SIZE, validators, { ifRange: '"stale"' })).toEqual({ kind: 'full' });
  });
});
