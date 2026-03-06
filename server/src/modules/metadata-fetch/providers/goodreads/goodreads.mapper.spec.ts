import { MetadataProviderKey } from '@projectx/types';

import { mapGoodreadsApolloState } from './goodreads.mapper';

describe('GoodreadsMapper', () => {
  it('should map a complete Goodreads apollo state correctly', () => {
    const bookId = '12345';
    const mockState: Record<string, any> = {
      'Book:kca:123': {
        title: 'The Great Gatsby: A Classic Novel',
        description: 'A story about Jay Gatsby.',
        imageUrl: 'https://images.gr-assets.com/books/123.jpg',
        primaryContributorEdge: {
          node: { __ref: 'Contributor:kca:456' },
        },
        bookGenres: [{ genre: { name: 'Fiction' } }, { genre: { name: 'Classics' } }],
        details: {
          publicationTime: 123456789000, // 1973
          numPages: 180,
          publisher: 'Scribner',
          language: { name: 'English' },
          isbn: '1234567890',
          isbn13: '1234567890123',
        },
        bookSeries: [{ userPosition: '1' }],
      },
      'Contributor:kca:456': {
        name: 'F. Scott Fitzgerald',
      },
      'Series:kca:789': {
        title: 'Great American Novels',
      },
    };

    const result = mapGoodreadsApolloState(mockState, bookId);

    expect(result).toEqual({
      provider: MetadataProviderKey.GOODREADS,
      providerId: bookId,
      title: 'The Great Gatsby',
      subtitle: 'A Classic Novel',
      authors: ['F. Scott Fitzgerald'],
      description: 'A story about Jay Gatsby.',
      publisher: 'Scribner',
      publishedYear: 1973,
      language: 'English',
      pageCount: 180,
      isbn10: '1234567890',
      isbn13: '1234567890123',
      genres: ['Fiction', 'Classics'],
      coverUrl: 'https://images.gr-assets.com/books/123.jpg',
      sourceUrl: `https://www.goodreads.com/book/show/${bookId}`,
      seriesName: 'Great American Novels',
      seriesIndex: 1,
    });
  });

  it('should return null if book not found in state', () => {
    const result = mapGoodreadsApolloState({}, '12345');
    expect(result).toBeNull();
  });

  it('should handle title without subtitle', () => {
    const mockState = {
      'Book:kca:1': { title: 'Simple Title' },
    };
    const result = mapGoodreadsApolloState(mockState, '1');
    expect(result?.title).toBe('Simple Title');
    expect(result?.subtitle).toBeUndefined();
  });

  it('should handle missing optional fields', () => {
    const mockState = {
      'Book:kca:1': { title: 'Minimal' },
    };
    const result = mapGoodreadsApolloState(mockState, '1');
    expect(result).toMatchObject({
      title: 'Minimal',
      providerId: '1',
    });
    expect(result?.authors).toBeUndefined();
    expect(result?.publishedYear).toBeUndefined();
  });

  it('should fallback to findContributorWithName if primaryContributorEdge is missing', () => {
    const mockState = {
      'Book:kca:1': { title: 'Test Book' },
      'Contributor:kca:123': { name: 'Implicit Author' },
    };
    const result = mapGoodreadsApolloState(mockState, '1');
    expect(result?.authors).toEqual(['Implicit Author']);
  });

  it('should normalize "null" strings to undefined', () => {
    const mockState = {
      'Book:kca:1': {
        title: 'Test Book',
        description: 'null',
        details: {
          publisher: 'null',
          isbn: 'null',
        },
      },
    };
    const result = mapGoodreadsApolloState(mockState, '1');
    expect(result?.description).toBeUndefined();
    expect(result?.publisher).toBeUndefined();
    expect(result?.isbn10).toBeUndefined();
  });
});
