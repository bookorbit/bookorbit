import { describe, expect, it, vi } from 'vitest';

import type { MigrationRepository } from '../migration.repository';
import { PathMappingValidationService } from './path-mapping-validation.service';

function createRepoMock(existingPaths: string[]) {
  return {
    findExistingBookFilePaths: vi.fn(() => Promise.resolve(new Set(existingPaths))),
  } as unknown as MigrationRepository;
}

describe('PathMappingValidationService', () => {
  it('computes summary and mapping stats against target file paths', async () => {
    const repo = createRepoMock(['/target/library/book-1.epub']);
    const service = new PathMappingValidationService(repo);

    const result = await service.validate({
      sourceBooks: [
        {
          sourceBookId: '1',
          title: null,
          author: null,
          subtitle: null,
          isbn10: null,
          isbn13: null,
          description: null,
          publisher: null,
          publishedYear: null,
          language: null,
          filePath: '/source/library/book-1.epub',
          fileHash: null,
          genres: [],
          tags: [],
        },
        {
          sourceBookId: '2',
          title: null,
          author: null,
          subtitle: null,
          isbn10: null,
          isbn13: null,
          description: null,
          publisher: null,
          publishedYear: null,
          language: null,
          filePath: '/source/library/book-2.epub',
          fileHash: null,
          genres: [],
          tags: [],
        },
        {
          sourceBookId: '3',
          title: null,
          author: null,
          subtitle: null,
          isbn10: null,
          isbn13: null,
          description: null,
          publisher: null,
          publishedYear: null,
          language: null,
          filePath: '/other/no-map.epub',
          fileHash: null,
          genres: [],
          tags: [],
        },
      ],
      pathMappings: [{ sourcePrefix: '/source/library', targetPrefix: '/target/library' }],
      sampleLimit: 5,
    });

    expect(result.summary.booksWithFilePath).toBe(3);
    expect(result.summary.mappedByPrefix).toBe(2);
    expect(result.summary.matchedTargetPaths).toBe(1);
    expect(result.summary.unmatchedTargetPaths).toBe(2);

    expect(result.mappings).toEqual([
      {
        sourcePrefix: '/source/library',
        targetPrefix: '/target/library',
        affectedBooks: 2,
        matchedTargetPaths: 1,
        unmatchedTargetPaths: 1,
        unmatchedSamples: ['/target/library/book-2.epub'],
      },
    ]);
  });
});
