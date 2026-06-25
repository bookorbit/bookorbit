import { MetadataProviderKey } from '@bookorbit/types';
import { mapITunesResult } from './itunes.mapper';
import { ITunesResult } from './itunes.types';

describe('itunes.mapper', () => {
  it('should map a full iTunes result correctly', () => {
    const result: ITunesResult = {
      trackId: 12345,
      trackName: 'The Hobbit',
      artistName: 'J.R.R. Tolkien',
      description: 'A great adventure',
      releaseDate: '1937-09-21T08:00:00Z',
      genres: ['Fantasy', 'Adventure'],
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/8a/d8/61/8ad861cd/9780547951973.jpg/100x100bb.jpg',
      kind: 'ebook',
      trackViewUrl: 'https://books.apple.com/us/book/the-hobbit/id12345',
      sellerName: 'HarperCollins',
      languageCodesISO2A: ['EN'],
      averageUserRating: 4.6,
      userRatingCount: 789,
    };

    const mapped = mapITunesResult(result);

    expect(mapped.provider).toBe(MetadataProviderKey.ITUNES);
    expect(mapped.providerId).toBe('12345');
    expect(mapped.title).toBe('The Hobbit');
    expect(mapped.authors).toEqual(['J.R.R. Tolkien']);
    expect(mapped.description).toBe('A great adventure');
    expect(mapped.publisher).toBe('HarperCollins');
    expect(mapped.publishedYear).toBe(1937);
    expect(mapped.language).toBe('EN');
    expect(mapped.genres).toEqual(['Fantasy', 'Adventure']);
    expect(mapped.communityRating).toBe(4.6);
    expect(mapped.communityRatingCount).toBe(789);
    expect(mapped.coverUrl).toBe('https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/8a/d8/61/8ad861cd/9780547951973.jpg/10000x10000bb.jpg');
    expect(mapped.sourceUrl).toBe('https://books.apple.com/us/book/the-hobbit/id12345');
  });

  it('should map standard resolution cover when explicitly requested', () => {
    const result: ITunesResult = {
      trackId: 12345,
      trackName: 'The Hobbit',
      artistName: 'J.R.R. Tolkien',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/8a/d8/61/8ad861cd/9780547951973.jpg/100x100bb.jpg',
      kind: 'ebook',
    };

    const mapped = mapITunesResult(result, 'standard');
    expect(mapped.coverUrl).toBe('https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/8a/d8/61/8ad861cd/9780547951973.jpg/600x600bb.jpg');
  });

  it('should handle missing fields', () => {
    const result: ITunesResult = {
      trackId: 12345,
      trackName: 'Title Only',
      artistName: 'Author Only',
      kind: 'ebook',
    };

    const mapped = mapITunesResult(result);

    expect(mapped.title).toBe('Title Only');
    expect(mapped.authors).toEqual(['Author Only']);
    expect(mapped.description).toBeUndefined();
    expect(mapped.publishedYear).toBeUndefined();
    expect(mapped.coverUrl).toBeUndefined();
  });

  it("should not break if artwork URL doesn't match expected pattern", () => {
    const result: ITunesResult = {
      trackId: 12345,
      trackName: 'Test',
      artistName: 'Test',
      kind: 'ebook',
      artworkUrl100: 'https://example.com/some-other-image.jpg',
    };

    const mapped = mapITunesResult(result);
    expect(mapped.coverUrl).toBe('https://example.com/some-other-image.jpg');
  });

  it('should map an audiobook iTunes result with collectionId and collectionName correctly', () => {
    const result: ITunesResult = {
      collectionId: 98765,
      collectionName: 'The Fellowship of the Ring',
      artistName: 'J.R.R. Tolkien',
      description: 'The first part of the Lord of the Rings',
      releaseDate: '1954-07-29T08:00:00Z',
      genres: ['Fantasy'],
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Audiobook/v4/a/b/c/d/e/100x100bb.jpg',
      kind: 'audiobook',
      collectionViewUrl: 'https://books.apple.com/us/audiobook/the-fellowship/id98765',
    };

    const mapped = mapITunesResult(result);

    expect(mapped.providerId).toBe('98765');
    expect(mapped.title).toBe('The Fellowship of the Ring');
    expect(mapped.sourceUrl).toBe('https://books.apple.com/us/audiobook/the-fellowship/id98765');
  });

  it('should throw error if both trackId and collectionId are missing', () => {
    const result: any = {
      trackName: 'Test',
      artistName: 'Test',
      kind: 'ebook',
    };

    expect(() => mapITunesResult(result)).toThrow('iTunes result missing both trackId and collectionId');
  });
});
