import { MetadataProviderKey } from '@projectx/types';

import { mapOpenLibraryDoc, mapOpenLibraryWork } from './open-library.mapper';
import { OpenLibraryDoc, OpenLibraryWork } from './open-library.types';

describe('OpenLibraryMapper', () => {
  describe('mapOpenLibraryDoc', () => {
    it('should map a complete OpenLibraryDoc correctly', () => {
      const mockDoc: OpenLibraryDoc = {
        key: '/works/OL12345W',
        title: 'The Great Gatsby',
        author_name: ['F. Scott Fitzgerald'],
        first_publish_year: 1925,
        isbn: ['1234567890', '1234567890123'],
        cover_i: 12345,
        publisher: ["Charles Scribner's Sons"],
        language: ['eng'],
        number_of_pages_median: 180,
        subject: ['Fiction', 'Classic'],
      };

      const result = mapOpenLibraryDoc(mockDoc);

      expect(result).toEqual({
        provider: MetadataProviderKey.OPEN_LIBRARY,
        providerId: 'OL12345W',
        title: 'The Great Gatsby',
        authors: ['F. Scott Fitzgerald'],
        publishedYear: 1925,
        isbn10: '1234567890',
        isbn13: '1234567890123',
        publisher: "Charles Scribner's Sons",
        language: 'eng',
        pageCount: 180,
        genres: ['Fiction', 'Classic'],
        coverUrl: 'https://covers.openlibrary.org/b/id/12345-L.jpg',
        sourceUrl: 'https://openlibrary.org/works/OL12345W',
      });
    });

    it('should handle missing fields', () => {
      const mockDoc: Partial<OpenLibraryDoc> = {
        key: '/works/OL12345W',
        title: 'Minimal Book',
      };

      const result = mapOpenLibraryDoc(mockDoc as OpenLibraryDoc);

      expect(result).toMatchObject({
        providerId: 'OL12345W',
        title: 'Minimal Book',
      });
      expect(result.authors).toBeUndefined();
      expect(result.isbn10).toBeUndefined();
      expect(result.coverUrl).toBeUndefined();
    });

    it('should slice genres to 10 items', () => {
      const mockDoc: Partial<OpenLibraryDoc> = {
        key: '/works/OL1',
        title: 'Many Genres',
        subject: Array(15)
          .fill(0)
          .map((_, i) => `Genre ${i}`),
      };

      const result = mapOpenLibraryDoc(mockDoc as OpenLibraryDoc);

      expect(result.genres).toHaveLength(10);
      expect(result.genres?.[9]).toBe('Genre 9');
    });
  });

  describe('mapOpenLibraryWork', () => {
    it('should map a complete OpenLibraryWork correctly', () => {
      const mockWork: OpenLibraryWork = {
        key: '/works/OL12345W',
        title: 'The Great Gatsby',
        description: 'A classic novel.',
        first_publish_date: '1925',
        subjects: ['Fiction'],
        covers: [12345],
      };

      const result = mapOpenLibraryWork(mockWork);

      expect(result).toEqual({
        provider: MetadataProviderKey.OPEN_LIBRARY,
        providerId: 'OL12345W',
        title: 'The Great Gatsby',
        description: 'A classic novel.',
        publishedYear: 1925,
        genres: ['Fiction'],
        coverUrl: 'https://covers.openlibrary.org/b/id/12345-L.jpg',
        sourceUrl: 'https://openlibrary.org/works/OL12345W',
      });
    });

    it('should handle complex description object', () => {
      const mockWork: Partial<OpenLibraryWork> = {
        key: '/works/OL1',
        title: 'Complex Description',
        description: {
          type: '/type/text',
          value: 'This is the description value.',
        },
      };

      const result = mapOpenLibraryWork(mockWork as OpenLibraryWork);

      expect(result.description).toBe('This is the description value.');
    });

    it('should handle missing publish date or invalid format', () => {
      const mockWork: Partial<OpenLibraryWork> = {
        key: '/works/OL1',
        title: 'No Date',
        first_publish_date: 'invalid',
      };

      const result = mapOpenLibraryWork(mockWork as OpenLibraryWork);

      expect(result.publishedYear).toBeUndefined();
    });
  });
});
