import { describe, expect, it } from 'vitest';

import { applyPathMappings, deriveUnresolvedReason } from './matching.service';

describe('applyPathMappings', () => {
  it('uses the most specific source prefix when multiple mappings match', () => {
    const mapped = applyPathMappings('/mnt/books/fiction/Dune.epub', [
      { sourcePrefix: '/mnt/books', targetPrefix: '/library' },
      { sourcePrefix: '/mnt/books/fiction', targetPrefix: '/library/fiction' },
    ]);

    expect(mapped).toBe('/library/fiction/Dune.epub');
  });

  it('returns the original path when no prefix matches', () => {
    const mapped = applyPathMappings('/other/path/file.epub', [{ sourcePrefix: '/mnt/books', targetPrefix: '/library' }]);
    expect(mapped).toBe('/other/path/file.epub');
  });
});

describe('deriveUnresolvedReason', () => {
  it('returns the highest-signal reason based on attempted strategies', () => {
    expect(deriveUnresolvedReason(['isbn'])).toBe('no_isbn_match');
    expect(deriveUnresolvedReason(['isbn', 'file_hash'])).toBe('no_file_hash_match');
    expect(deriveUnresolvedReason(['isbn', 'file_hash', 'file_path'])).toBe('no_file_path_match');
    expect(deriveUnresolvedReason(['isbn', 'file_hash', 'file_path', 'title_author'])).toBe('no_title_author_match');
  });

  it('returns insufficient_source_data when no strategy could be attempted', () => {
    expect(deriveUnresolvedReason([])).toBe('insufficient_source_data');
  });
});
