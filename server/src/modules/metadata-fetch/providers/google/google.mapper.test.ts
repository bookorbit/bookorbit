import { MetadataProviderKey } from '@projectx/types';

import { mapGoogleVolume } from './google.mapper';
import { GoogleVolumeItem } from './google.types';

describe('GoogleMapper', () => {
  it('should map a complete GoogleVolumeItem correctly', () => {
    const mockItem: GoogleVolumeItem = {
      id: 'vol123',
      volumeInfo: {
        title: 'The Great Gatsby',
        subtitle: 'A Novel',
        authors: ['F. Scott Fitzgerald'],
        publisher: "Charles Scribner's Sons",
        publishedDate: '1925-04-10',
        description: 'A classic story.',
        industryIdentifiers: [
          { type: 'ISBN_10', identifier: '1234567890' },
          { type: 'ISBN_13', identifier: '1234567890123' },
        ],
        pageCount: 180,
        categories: ['Fiction'],
        imageLinks: {
          thumbnail: 'http://books.google.com/thumbnail?id=vol123&zoom=1&edge=curl',
        },
        language: 'en',
      },
    };

    const result = mapGoogleVolume(mockItem);

    expect(result).toEqual({
      provider: MetadataProviderKey.GOOGLE,
      providerId: 'vol123',
      title: 'The Great Gatsby',
      subtitle: 'A Novel',
      authors: ['F. Scott Fitzgerald'],
      description: 'A classic story.',
      publisher: "Charles Scribner's Sons",
      publishedYear: 1925,
      language: 'en',
      pageCount: 180,
      isbn10: '1234567890',
      isbn13: '1234567890123',
      genres: ['Fiction'],
      coverUrl: 'https://books.google.com/thumbnail?id=vol123&zoom=0',
      sourceUrl: 'https://books.google.com/books?id=vol123',
    });
  });

  it('should handle missing imageLinks or thumbnail', () => {
    const mockItem: Partial<GoogleVolumeItem> = {
      id: 'vol123',
      volumeInfo: {
        title: 'No Image',
      } as any,
    };

    const result = mapGoogleVolume(mockItem as GoogleVolumeItem);
    expect(result.coverUrl).toBeUndefined();
  });

  it('should handle partial publishedDate', () => {
    const mockItem: Partial<GoogleVolumeItem> = {
      id: 'vol123',
      volumeInfo: {
        title: 'Only Year',
        publishedDate: '1925',
      } as any,
    };

    const result = mapGoogleVolume(mockItem as GoogleVolumeItem);
    expect(result.publishedYear).toBe(1925);
  });

  it('should handle missing industryIdentifiers', () => {
    const mockItem: Partial<GoogleVolumeItem> = {
      id: 'vol123',
      volumeInfo: {
        title: 'No ISBN',
      } as any,
    };

    const result = mapGoogleVolume(mockItem as GoogleVolumeItem);
    expect(result.isbn10).toBeUndefined();
    expect(result.isbn13).toBeUndefined();
  });
});
