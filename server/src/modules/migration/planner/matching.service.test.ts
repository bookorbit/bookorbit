import type { SourceBook } from '../adapters/source-adapter.types';
import { describe, expect, it, vi } from 'vitest';

import { applyPathMappings, deriveUnresolvedReason, MatchingService } from './matching.service';

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

  it('returns null when filePath is null', () => {
    expect(applyPathMappings(null, [{ sourcePrefix: '/mnt', targetPrefix: '/lib' }])).toBeNull();
  });

  it('handles empty mappings list', () => {
    expect(applyPathMappings('/mnt/books/file.epub', [])).toBe('/mnt/books/file.epub');
  });

  it('strips trailing slash from prefixes', () => {
    const mapped = applyPathMappings('/mnt/books/file.epub', [{ sourcePrefix: '/mnt/books/', targetPrefix: '/library/' }]);
    expect(mapped).toBe('/library/file.epub');
  });

  it('skips mappings with empty prefixes', () => {
    const mapped = applyPathMappings('/mnt/books/file.epub', [
      { sourcePrefix: '', targetPrefix: '/library' },
      { sourcePrefix: '/mnt/books', targetPrefix: '/target' },
    ]);
    expect(mapped).toBe('/target/file.epub');
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

  it('returns title_author even if earlier strategies are missing', () => {
    expect(deriveUnresolvedReason(['title_author'])).toBe('no_title_author_match');
  });
});

function sourceBook(overrides: Partial<SourceBook>): SourceBook {
  return {
    sourceBookId: 'source-1',
    title: null,
    author: null,
    subtitle: null,
    isbn10: null,
    isbn13: null,
    description: null,
    publisher: null,
    publishedYear: null,
    language: null,
    filePath: null,
    fileHash: null,
    genres: [],
    tags: [],
    ...overrides,
  };
}

describe('MatchingService.matchBooks', () => {
  it('prioritizes match strategies and reports unresolved reasons with cache-aware lookups', async () => {
    const service = new MatchingService({} as never);

    vi.spyOn(service as never, 'batchLookupIsbns').mockResolvedValue(
      new Map([
        ['9781111111111', { kind: 'found', bookId: 101 }],
        ['9782222222222', { kind: 'ambiguous' }],
      ]),
    );
    vi.spyOn(service as never, 'batchLookupFileHashes').mockResolvedValue(
      new Map([
        ['hash-hit', { kind: 'found', bookId: 202 }],
        ['hash-amb', { kind: 'ambiguous' }],
      ]),
    );

    const lookupByFilePath = vi.spyOn(service as never, 'lookupByFilePath').mockImplementation((path: string) => {
      if (path === '/target/matched.epub') return Promise.resolve({ kind: 'found', bookId: 303 });
      if (path === '/target/ambiguous.epub') return Promise.resolve({ kind: 'ambiguous' });
      return Promise.resolve({ kind: 'none' });
    });

    const lookupByTitleAuthor = vi.spyOn(service as never, 'lookupByTitleAuthor').mockImplementation((title: string) => {
      if (title === 'Title Match') return Promise.resolve({ kind: 'found', bookId: 404 });
      return Promise.resolve({ kind: 'none' });
    });

    const result = await service.matchBooks(
      [
        sourceBook({ sourceBookId: 'isbn', isbn13: '9781111111111' }),
        sourceBook({ sourceBookId: 'hash', isbn13: '9782222222222', fileHash: 'hash-hit' }),
        sourceBook({ sourceBookId: 'path', filePath: '/source/matched.epub' }),
        sourceBook({ sourceBookId: 'path-cache', filePath: '/source/matched.epub' }),
        sourceBook({ sourceBookId: 'title', title: 'Title Match', author: 'Frank Herbert' }),
        sourceBook({ sourceBookId: 'ambiguous-path', filePath: '/source/ambiguous.epub', fileHash: 'hash-amb' }),
        sourceBook({ sourceBookId: 'insufficient' }),
      ],
      [{ sourcePrefix: '/source', targetPrefix: '/target' }],
    );

    expect(result.matches).toEqual([
      { sourceBookId: 'isbn', targetBookId: 101, strategy: 'isbn' },
      { sourceBookId: 'hash', targetBookId: 202, strategy: 'file_hash' },
      { sourceBookId: 'path', targetBookId: 303, strategy: 'path_mapping' },
      { sourceBookId: 'path-cache', targetBookId: 303, strategy: 'path_mapping' },
      { sourceBookId: 'title', targetBookId: 404, strategy: 'title_author' },
    ]);

    expect(result.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceBookId: 'ambiguous-path',
          reason: 'ambiguous_file_hash_match',
        }),
        expect.objectContaining({
          sourceBookId: 'insufficient',
          reason: 'insufficient_source_data',
        }),
      ]),
    );

    expect(lookupByFilePath).toHaveBeenCalledTimes(2);
    expect(lookupByTitleAuthor).toHaveBeenCalledTimes(1);
  });
});

describe('MatchingService private lookups', () => {
  it('batchLookupIsbns resolves unique, ambiguous, and missing matches', async () => {
    const where13 = vi.fn().mockResolvedValue([
      { bookId: 1, isbn13: '9780441013593' },
      { bookId: 2, isbn13: '9780000000000' },
      { bookId: 3, isbn13: '9780000000000' },
    ]);
    const where10 = vi.fn().mockResolvedValue([{ bookId: 1, isbn10: '0441013597' }]);
    const from13 = vi.fn().mockReturnValue({ where: where13 });
    const from10 = vi.fn().mockReturnValue({ where: where10 });
    const select = vi.fn().mockReturnValueOnce({ from: from13 }).mockReturnValueOnce({ from: from10 });

    const service = new MatchingService({ select } as never);
    const lookup = await (service as never).batchLookupIsbns([
      sourceBook({ sourceBookId: 'a', isbn13: '9780441013593', isbn10: '0441013597' }),
      sourceBook({ sourceBookId: 'b', isbn13: '9780000000000' }),
      sourceBook({ sourceBookId: 'c', isbn13: '9789999999999' }),
    ]);

    expect(lookup.get('9780441013593')).toEqual({ kind: 'found', bookId: 1 });
    expect(lookup.get('9780000000000')).toEqual({ kind: 'ambiguous' });
    expect(lookup.get('9789999999999')).toEqual({ kind: 'none' });
  });

  it('lookupByTitleAuthor falls back from exact to approximate author matching', async () => {
    const exactLimit = vi.fn().mockResolvedValue([]);
    const exactWhere = vi.fn().mockReturnValue({ limit: exactLimit });
    const exactInnerJoin2 = vi.fn().mockReturnValue({ where: exactWhere });
    const exactInnerJoin1 = vi.fn().mockReturnValue({ innerJoin: exactInnerJoin2 });
    const exactFrom = vi.fn().mockReturnValue({ innerJoin: exactInnerJoin1 });

    const approxLimit = vi.fn().mockResolvedValue([{ bookId: 777 }]);
    const approxWhere = vi.fn().mockReturnValue({ limit: approxLimit });
    const approxInnerJoin2 = vi.fn().mockReturnValue({ where: approxWhere });
    const approxInnerJoin1 = vi.fn().mockReturnValue({ innerJoin: approxInnerJoin2 });
    const approxFrom = vi.fn().mockReturnValue({ innerJoin: approxInnerJoin1 });

    const selectDistinct = vi.fn().mockReturnValueOnce({ from: exactFrom }).mockReturnValueOnce({ from: approxFrom });
    const service = new MatchingService({ selectDistinct } as never);

    await expect((service as never).lookupByTitleAuthor('Dune', ['Frank Herbert'])).resolves.toEqual({ kind: 'found', bookId: 777 });
  });

  it('batchLookupFileHashes returns found, ambiguous, and none results', async () => {
    const where = vi.fn().mockResolvedValue([
      { bookId: 10, hash: 'hash-unique' },
      { bookId: 20, hash: 'hash-dup' },
      { bookId: 21, hash: 'hash-dup' },
    ]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const service = new MatchingService({ select } as never);

    const lookup = await (service as never).batchLookupFileHashes([
      sourceBook({ sourceBookId: 'a', fileHash: 'hash-unique' }),
      sourceBook({ sourceBookId: 'b', fileHash: 'hash-dup' }),
      sourceBook({ sourceBookId: 'c', fileHash: 'hash-missing' }),
    ]);

    expect(lookup.get('hash-unique')).toEqual({ kind: 'found', bookId: 10 });
    expect(lookup.get('hash-dup')).toEqual({ kind: 'ambiguous' });
    expect(lookup.get('hash-missing')).toBeUndefined();
  });

  it('batchLookupFileHashes returns empty map for books without hashes', async () => {
    const service = new MatchingService({} as never);

    const lookup = await (service as never).batchLookupFileHashes([sourceBook({ sourceBookId: 'a' })]);

    expect(lookup.size).toBe(0);
  });

  it('lookupByFilePath returns found when exactly one book matches', async () => {
    const limit = vi.fn().mockResolvedValue([{ bookId: 55 }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const service = new MatchingService({ select } as never);

    const result = await (service as never).lookupByFilePath('/books/dune.epub');
    expect(result).toEqual({ kind: 'found', bookId: 55 });
  });

  it('lookupByFilePath returns ambiguous when multiple books match', async () => {
    const limit = vi.fn().mockResolvedValue([{ bookId: 55 }, { bookId: 56 }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const service = new MatchingService({ select } as never);

    const result = await (service as never).lookupByFilePath('/books/dune.epub');
    expect(result).toEqual({ kind: 'ambiguous' });
  });

  it('lookupByFilePath returns none when no books match', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const service = new MatchingService({ select } as never);

    const result = await (service as never).lookupByFilePath('/books/missing.epub');
    expect(result).toEqual({ kind: 'none' });
  });

  it('lookupByTitleAuthor returns none when title is empty', async () => {
    const service = new MatchingService({} as never);
    const result = await (service as never).lookupByTitleAuthor('', ['Author']);
    expect(result).toEqual({ kind: 'none' });
  });

  it('lookupByTitleAuthor returns none when no valid authors provided', async () => {
    const service = new MatchingService({} as never);
    const result = await (service as never).lookupByTitleAuthor('Dune', ['', '   ']);
    expect(result).toEqual({ kind: 'none' });
  });

  it('lookupByTitleAuthor returns exact ambiguous result without calling approx', async () => {
    const exactLimit = vi.fn().mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
    const exactWhere = vi.fn().mockReturnValue({ limit: exactLimit });
    const exactInnerJoin2 = vi.fn().mockReturnValue({ where: exactWhere });
    const exactInnerJoin1 = vi.fn().mockReturnValue({ innerJoin: exactInnerJoin2 });
    const exactFrom = vi.fn().mockReturnValue({ innerJoin: exactInnerJoin1 });
    const selectDistinct = vi.fn().mockReturnValueOnce({ from: exactFrom });
    const service = new MatchingService({ selectDistinct } as never);

    const result = await (service as never).lookupByTitleAuthor('Dune', ['Frank Herbert']);
    expect(result).toEqual({ kind: 'ambiguous' });
    expect(selectDistinct).toHaveBeenCalledTimes(1);
  });

  it('lookupByTitleAuthor returns none when both exact and approx return empty', async () => {
    const makeChain = () => {
      const limit = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ limit });
      const innerJoin2 = vi.fn().mockReturnValue({ where });
      const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
      const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
      return { from };
    };
    const chain1 = makeChain();
    const chain2 = makeChain();
    const selectDistinct = vi.fn().mockReturnValueOnce({ from: chain1.from }).mockReturnValueOnce({ from: chain2.from });
    const service = new MatchingService({ selectDistinct } as never);

    const result = await (service as never).lookupByTitleAuthor('Unknown Title', ['Unknown Author']);
    expect(result).toEqual({ kind: 'none' });
  });

  it('matchBooks handles books with multiple file paths via files array', async () => {
    const service = new MatchingService({} as never);

    vi.spyOn(service as never, 'batchLookupIsbns').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'batchLookupFileHashes').mockResolvedValue(new Map());

    const lookupByFilePath = vi.spyOn(service as never, 'lookupByFilePath').mockImplementation((path: string) => {
      if (path === '/target/file.epub') return Promise.resolve({ kind: 'found', bookId: 900 });
      return Promise.resolve({ kind: 'none' });
    });

    const result = await service.matchBooks(
      [
        {
          sourceBookId: 'multi-file',
          title: null,
          author: null,
          subtitle: null,
          isbn10: null,
          isbn13: null,
          description: null,
          publisher: null,
          publishedYear: null,
          language: null,
          filePath: null,
          fileHash: null,
          genres: [],
          tags: [],
          files: [
            { filePath: '/source/file.epub', fileHash: null },
            { filePath: '/source/other.epub', fileHash: null },
          ],
        },
      ],
      [{ sourcePrefix: '/source', targetPrefix: '/target' }],
    );

    expect(result.matches).toEqual([{ sourceBookId: 'multi-file', targetBookId: 900, strategy: 'path_mapping' }]);
    expect(lookupByFilePath).toHaveBeenCalledWith('/target/file.epub');
  });

  it('matchBooks deduplicates mapped paths using Set (cache reuse)', async () => {
    const service = new MatchingService({} as never);
    vi.spyOn(service as never, 'batchLookupIsbns').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'batchLookupFileHashes').mockResolvedValue(new Map());
    const lookupByFilePath = vi.spyOn(service as never, 'lookupByFilePath').mockResolvedValue({ kind: 'found', bookId: 10 });

    await service.matchBooks(
      [
        sourceBook({ sourceBookId: 'dup-path', filePath: '/source/same.epub' }),
        sourceBook({ sourceBookId: 'dup-path-2', filePath: '/source/same.epub' }),
      ],
      [{ sourcePrefix: '/source', targetPrefix: '/target' }],
    );

    expect(lookupByFilePath).toHaveBeenCalledTimes(1);
  });

  it('matchBooks uses authors array when available for title_author strategy', async () => {
    const service = new MatchingService({} as never);
    vi.spyOn(service as never, 'batchLookupIsbns').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'batchLookupFileHashes').mockResolvedValue(new Map());
    const lookupByTitleAuthor = vi.spyOn(service as never, 'lookupByTitleAuthor').mockResolvedValue({ kind: 'found', bookId: 42 });

    await service.matchBooks(
      [
        {
          sourceBookId: 'auth-arr',
          title: 'Structured Title',
          author: 'Legacy Author',
          subtitle: null,
          isbn10: null,
          isbn13: null,
          description: null,
          publisher: null,
          publishedYear: null,
          language: null,
          filePath: null,
          fileHash: null,
          genres: [],
          tags: [],
          authors: [{ name: 'Structured Author 1' }, { name: 'Structured Author 2' }],
        },
      ],
      [],
    );

    expect(lookupByTitleAuthor).toHaveBeenCalledWith('Structured Title', ['Structured Author 1', 'Structured Author 2']);
  });
});
