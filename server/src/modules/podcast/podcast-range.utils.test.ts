import { describe, expect, it } from 'vitest';

import { parsePodcastByteRange } from './podcast-range.utils';

describe('parsePodcastByteRange', () => {
  it('parses open and closed byte ranges', () => {
    expect(parsePodcastByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parsePodcastByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
  });

  it('supports suffix ranges and clamps oversized suffixes', () => {
    expect(parsePodcastByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parsePodcastByteRange('bytes=-200', 100)).toEqual({ start: 0, end: 99 });
  });

  it('clamps an end beyond the file size', () => {
    expect(parsePodcastByteRange('bytes=90-1000', 100)).toEqual({ start: 90, end: 99 });
  });

  it.each(['items=0-1', 'bytes=', 'bytes=-0', 'bytes=20-10', 'bytes=100-', 'bytes=0-1,3-4', 'bytes=9007199254740992-'])(
    'rejects an invalid or unsatisfiable range: %s',
    (value) => {
      expect(parsePodcastByteRange(value, 100)).toBeNull();
    },
  );

  it('rejects ranges for empty files', () => {
    expect(parsePodcastByteRange('bytes=0-', 0)).toBeNull();
  });
});
