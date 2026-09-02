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
    expect(deriveUnresolvedReason(['isbn', 'asin'])).toBe('no_asin_match');
    expect(deriveUnresolvedReason(['isbn', 'asin', 'file_hash'])).toBe('no_file_hash_match');
    expect(deriveUnresolvedReason(['isbn', 'asin', 'file_hash', 'file_path'])).toBe('no_file_path_match');
    expect(deriveUnresolvedReason(['isbn', 'asin', 'file_hash', 'file_path', 'title_author'])).toBe('no_title_author_match');
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
    vi.spyOn(service as never, 'batchLookupAsins').mockResolvedValue(
      new Map([
        ['asin', { kind: 'found', bookId: 151 }],
        ['hash', { kind: 'none' }],
        ['ambiguous-asin', { kind: 'ambiguous' }],
      ]),
    );
    vi.spyOn(service as never, 'batchLookupFileHashes').mockResolvedValue(
      new Map([
        ['hash-hit', { kind: 'found', bookId: 202 }],
        ['hash-amb', { kind: 'ambiguous' }],
      ]),
    );

    const batchLookupFilePaths = vi.spyOn(service as never, 'batchLookupFilePaths').mockResolvedValue(
      new Map([
        ['/target/matched.epub', { kind: 'found', bookId: 303 }],
        ['/target/ambiguous.epub', { kind: 'ambiguous' }],
      ]),
    );
    const batchLookupTitleAuthors = vi
      .spyOn(service as never, 'batchLookupTitleAuthors')
      .mockResolvedValue(new Map([['title match|frank herbert', { kind: 'found', bookId: 404 }]]));

    const result = await service.matchBooks(
      [
        sourceBook({ sourceBookId: 'isbn', isbn13: '9781111111111' }),
        sourceBook({ sourceBookId: 'asin', asin: 'A000000001', fileHash: 'hash-hit' }),
        sourceBook({ sourceBookId: 'hash', isbn13: '9782222222222', asin: 'A000000002', fileHash: 'hash-hit' }),
        sourceBook({ sourceBookId: 'path', filePath: '/source/matched.epub' }),
        sourceBook({ sourceBookId: 'path-cache', filePath: '/source/matched.epub' }),
        sourceBook({ sourceBookId: 'title', title: 'Title Match', author: 'Frank Herbert' }),
        sourceBook({ sourceBookId: 'ambiguous-path', filePath: '/source/ambiguous.epub', fileHash: 'hash-amb' }),
        sourceBook({ sourceBookId: 'ambiguous-asin', asin: 'A000000003' }),
        sourceBook({ sourceBookId: 'insufficient' }),
      ],
      [{ sourcePrefix: '/source', targetPrefix: '/target' }],
    );

    expect(result.matches).toEqual([
      { sourceBookId: 'isbn', targetBookId: 101, strategy: 'isbn' },
      { sourceBookId: 'asin', targetBookId: 151, strategy: 'asin' },
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
        expect.objectContaining({
          sourceBookId: 'ambiguous-asin',
          reason: 'ambiguous_asin_match',
        }),
      ]),
    );

    expect(batchLookupFilePaths).toHaveBeenCalledTimes(1);
    expect(batchLookupTitleAuthors).toHaveBeenCalledTimes(1);
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

  it('batchLookupAsins resolves unique matches across Amazon and Audible identifiers', async () => {
    const where = vi.fn().mockResolvedValue([
      { bookId: 1, amazonId: 'A000000001', audibleId: null },
      { bookId: 2, amazonId: null, audibleId: 'A000000002' },
      { bookId: 3, amazonId: 'A000000003', audibleId: null },
      { bookId: 4, amazonId: null, audibleId: 'A000000003' },
      { bookId: 5, amazonId: 'A000000004', audibleId: 'A000000004' },
    ]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const service = new MatchingService({ select } as never);

    const lookup = await (service as never).batchLookupAsins([
      sourceBook({ sourceBookId: 'amazon', asin: ' a000000001 ' }),
      sourceBook({ sourceBookId: 'audible', asin: 'a000000002' }),
      sourceBook({ sourceBookId: 'ambiguous', asin: 'A000000003' }),
      sourceBook({ sourceBookId: 'same-book-both-columns', asin: 'A000000004' }),
      sourceBook({ sourceBookId: 'provider-fields', amazonId: 'A000000001', audibleId: 'A000000001' }),
      sourceBook({ sourceBookId: 'missing', asin: 'A000000005' }),
      sourceBook({ sourceBookId: 'invalid', asin: 'not-an-asin' }),
    ]);

    expect(lookup.get('amazon')).toEqual({ kind: 'found', bookId: 1 });
    expect(lookup.get('audible')).toEqual({ kind: 'found', bookId: 2 });
    expect(lookup.get('ambiguous')).toEqual({ kind: 'ambiguous' });
    expect(lookup.get('same-book-both-columns')).toEqual({ kind: 'found', bookId: 5 });
    expect(lookup.get('provider-fields')).toEqual({ kind: 'found', bookId: 1 });
    expect(lookup.get('missing')).toEqual({ kind: 'none' });
    expect(lookup.has('invalid')).toBe(false);
  });

  it('batchLookupAsins treats different provider-specific source matches as ambiguous', async () => {
    const where = vi.fn().mockResolvedValue([
      { bookId: 1, amazonId: 'A000000001', audibleId: null },
      { bookId: 2, amazonId: null, audibleId: 'A000000002' },
    ]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const service = new MatchingService({ select } as never);

    const lookup = await (service as never).batchLookupAsins([
      sourceBook({ sourceBookId: 'provider-conflict', amazonId: 'A000000001', audibleId: 'A000000002' }),
    ]);

    expect(lookup.get('provider-conflict')).toEqual({ kind: 'ambiguous' });
  });

  it('batchLookupTitleAuthors prefers exact matches and falls back to approximate matches', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { match_key: 'dune|frank herbert', book_id: 11, match_level: 'approx' },
        { match_key: 'dune|frank herbert', book_id: 10, match_level: 'exact' },
        { match_key: 'foundation|isaac asimov', book_id: 20, match_level: 'approx' },
      ],
    });
    // The strategy runs each chunk in its own transaction (SET LOCAL statement_timeout, then
    // the real query), so `execute` is called twice per chunk rather than once.
    const transaction = vi.fn((cb: (tx: { execute: typeof execute }) => unknown) => cb({ execute }));
    const service = new MatchingService({ execute, transaction } as never);

    const lookup = await (service as never).batchLookupTitleAuthors([
      sourceBook({ sourceBookId: 'exact', title: 'Dune', author: 'Frank Herbert' }),
      sourceBook({ sourceBookId: 'approx', title: 'Foundation', author: 'Isaac Asimov' }),
    ]);

    expect(lookup.get('dune|frank herbert')).toEqual({ kind: 'found', bookId: 10 });
    expect(lookup.get('foundation|isaac asimov')).toEqual({ kind: 'found', bookId: 20 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
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

  it('batchLookupFilePaths resolves unique and ambiguous paths without changing path case', async () => {
    const where = vi.fn().mockResolvedValue([
      { bookId: 55, absolutePath: '/books/Dune.epub' },
      { bookId: 56, absolutePath: '/books/duplicate.epub' },
      { bookId: 57, absolutePath: '/books/duplicate.epub' },
    ]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const service = new MatchingService({ select } as never);

    const result = await (service as never).batchLookupFilePaths(
      [
        sourceBook({ sourceBookId: 'found', filePath: '/source/Dune.epub' }),
        sourceBook({ sourceBookId: 'ambiguous', filePath: '/source/duplicate.epub' }),
        sourceBook({ sourceBookId: 'case-sensitive-miss', filePath: '/source/dune.epub' }),
      ],
      [{ sourcePrefix: '/source', targetPrefix: '/books' }],
    );

    expect(result.get('/books/Dune.epub')).toEqual({ kind: 'found', bookId: 55 });
    expect(result.get('/books/duplicate.epub')).toEqual({ kind: 'ambiguous' });
    expect(result.has('/books/dune.epub')).toBe(false);
  });

  it('batchLookupTitleAuthors reports exact ambiguity and missing candidates', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        { match_key: 'dune|frank herbert', book_id: 1, match_level: 'exact' },
        { match_key: 'dune|frank herbert', book_id: 2, match_level: 'exact' },
      ],
    });
    const transaction = vi.fn((cb: (tx: { execute: typeof execute }) => unknown) => cb({ execute }));
    const service = new MatchingService({ execute, transaction } as never);

    const result = await (service as never).batchLookupTitleAuthors([
      sourceBook({ sourceBookId: 'ambiguous', title: 'Dune', author: 'Frank Herbert' }),
      sourceBook({ sourceBookId: 'missing', title: 'Missing', author: 'Unknown' }),
      sourceBook({ sourceBookId: 'empty-title', title: ' ', author: 'Author' }),
      sourceBook({ sourceBookId: 'empty-author', title: 'No Author', author: ' ' }),
    ]);

    expect(result.get('dune|frank herbert')).toEqual({ kind: 'ambiguous' });
    expect(result.get('missing|unknown')).toEqual({ kind: 'none' });
    expect(result.has('|author')).toBe(false);
    expect(result.has('no author|')).toBe(false);
  });

  it('matchBooks handles books with multiple file paths via files array', async () => {
    const service = new MatchingService({} as never);

    vi.spyOn(service as never, 'batchLookupIsbns').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'batchLookupAsins').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'batchLookupFileHashes').mockResolvedValue(new Map());

    const batchLookupFilePaths = vi
      .spyOn(service as never, 'batchLookupFilePaths')
      .mockResolvedValue(new Map([['/target/file.epub', { kind: 'found', bookId: 900 }]]));
    vi.spyOn(service as never, 'batchLookupTitleAuthors').mockResolvedValue(new Map());

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
    expect(batchLookupFilePaths).toHaveBeenCalledTimes(1);
  });

  it('batchLookupFilePaths deduplicates paths and queries by bounded chunks', async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const service = new MatchingService({ select } as never);
    const books = Array.from({ length: 1_001 }, (_, index) => sourceBook({ sourceBookId: `path-${index}`, filePath: `/source/${index}.epub` }));
    books.push(sourceBook({ sourceBookId: 'duplicate', filePath: '/source/0.epub' }));

    await (service as never).batchLookupFilePaths(books, [{ sourcePrefix: '/source', targetPrefix: '/target' }]);

    expect(select).toHaveBeenCalledTimes(3);
  });

  it('matchBooks uses authors array when available for title_author strategy', async () => {
    const service = new MatchingService({} as never);
    vi.spyOn(service as never, 'batchLookupIsbns').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'batchLookupAsins').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'batchLookupFileHashes').mockResolvedValue(new Map());
    vi.spyOn(service as never, 'batchLookupFilePaths').mockResolvedValue(new Map());
    const batchLookupTitleAuthors = vi
      .spyOn(service as never, 'batchLookupTitleAuthors')
      .mockResolvedValue(new Map([['structured title|structured author 1;structured author 2', { kind: 'found', bookId: 42 }]]));

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

    expect(batchLookupTitleAuthors).toHaveBeenCalledTimes(1);
  });

  it('batchLookupTitleAuthors queries by bounded chunks rather than per source book', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const transaction = vi.fn((cb: (tx: { execute: typeof execute }) => unknown) => cb({ execute }));
    const service = new MatchingService({ execute, transaction } as never);
    const books = Array.from({ length: 1_001 }, (_, index) =>
      sourceBook({ sourceBookId: `title-${index}`, title: `Title ${index}`, author: `Author ${index}` }),
    );
    books.push(sourceBook({ sourceBookId: 'duplicate-title-author', title: ' Title 0 ', author: 'Author 0' }));

    await (service as never).batchLookupTitleAuthors(books);

    expect(transaction).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(6);
  });
});
