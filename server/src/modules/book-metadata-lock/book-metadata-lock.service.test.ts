import { ConflictException } from '@nestjs/common';
import { MetadataProviderKey } from '@bookorbit/types';

import { UpdateBookMetadataDto } from '../book/dto/update-book-metadata.dto';
import { BookMetadataLockService } from './book-metadata-lock.service';

function makeService(lockedFields: string[] = []) {
  const lockRepo = {
    findLockedFields: vi.fn().mockResolvedValue(lockedFields),
    findLockedFieldsByBookIds: vi.fn().mockResolvedValue(new Map()),
    replaceLockedFields: vi.fn().mockResolvedValue(undefined),
  };

  return {
    service: new BookMetadataLockService(lockRepo as never),
    lockRepo,
  };
}

describe('BookMetadataLockService', () => {
  it('normalizes, deduplicates, and orders locked fields', () => {
    const { service } = makeService();

    expect(service.normalizeLockedFields(['cover', 'title', 'cover', 'unknown', 'authors'])).toEqual(['title', 'authors', 'cover']);
  });

  it('rejects manual updates that target locked fields', async () => {
    const { service } = makeService(['title', 'authors']);

    await expect(service.assertManualUpdateAllowed(12, { title: 'Locked', authors: ['A'] })).rejects.toThrow(ConflictException);
  });

  it('allows manual updates that omit locked fields on transformed dto instances', async () => {
    const { service } = makeService(['title']);
    const dto = new UpdateBookMetadataDto();
    dto.publisher = 'Allowed Publisher';

    await expect(service.assertManualUpdateAllowed(12, dto)).resolves.toBeUndefined();
  });

  it('passes transaction executors through lock replacement', async () => {
    const { service, lockRepo } = makeService();
    const tx = { id: 'tx' };

    await service.replaceLockedFields(12, ['cover'], tx as never);

    expect(lockRepo.replaceLockedFields).toHaveBeenCalledWith(12, ['cover'], tx);
  });

  it('filters automated dto updates and preserves unlocked chapters', async () => {
    const { service } = makeService(['title', 'narrators', 'comicIssueNumber', 'googleBooksId', 'hardcoverEditionId']);

    const result = await service.filterAutomatedBookUpdate(12, {
      title: 'Locked title',
      authors: ['Allowed Author'],
      googleBooksId: 'g-id',
      hardcoverEditionId: '1001',
      audioMetadata: {
        narrators: ['Locked Narrator'],
        chapters: [{ title: 'Chapter 1', startMs: 0 }],
      },
      comicMetadata: {
        issueNumber: '42',
        volumeName: 'Allowed Volume',
      },
    });

    expect(result.dto).toEqual({
      authors: ['Allowed Author'],
      audioMetadata: {
        chapters: [{ title: 'Chapter 1', startMs: 0 }],
      },
      comicMetadata: {
        volumeName: 'Allowed Volume',
      },
    });
    expect(result.skippedFields).toEqual(['title', 'narrators', 'googleBooksId', 'hardcoverEditionId', 'comicIssueNumber']);
  });

  it('assertFieldsUnlocked passes when none of the checked fields are locked', async () => {
    const { service } = makeService(['cover']);

    await expect(service.assertFieldsUnlocked(1, ['title', 'authors'])).resolves.toBeUndefined();
  });

  it('reports whether a specific field is locked', async () => {
    const { service } = makeService(['cover']);

    await expect(service.isFieldLocked(1, 'cover')).resolves.toBe(true);
    await expect(service.isFieldLocked(1, 'title')).resolves.toBe(false);
  });

  it('filterResolvedMetadata passes chapters through regardless of lock state', async () => {
    const { service } = makeService(['title', 'cover']);

    const chapters = [{ title: 'Ch 1', startMs: 0 }];
    const result = await service.filterResolvedMetadata(1, { title: 'Locked', chapters }, {});

    expect(result.resolved.chapters).toEqual(chapters);
    expect('title' in result.resolved).toBe(false);
  });

  it('filters resolved series memberships as a grouped series update', async () => {
    const unlocked = makeService();
    const memberships = [
      { seriesName: 'Sword of Truth', seriesIndex: 11 },
      { seriesName: 'Chainfire Trilogy', seriesIndex: 3 },
    ];

    await expect(
      unlocked.service.filterResolvedMetadata(1, { seriesName: 'Sword of Truth', seriesIndex: 11, seriesMemberships: memberships }, {}),
    ).resolves.toEqual({
      resolved: { seriesName: 'Sword of Truth', seriesIndex: 11, seriesMemberships: memberships },
      providerIds: {},
      skippedFields: [],
    });

    const locked = makeService(['seriesIndex']);
    await expect(
      locked.service.filterResolvedMetadata(1, { seriesName: 'Sword of Truth', seriesIndex: 11, seriesMemberships: memberships }, {}),
    ).resolves.toEqual({
      resolved: {},
      providerIds: {},
      skippedFields: ['seriesIndex'],
    });
  });

  it('filters community rating rows as one lockable provider bundle', async () => {
    const unlocked = makeService();
    const communityRatings = [{ provider: MetadataProviderKey.HARDCOVER, rating: 4.25, ratingCount: 12345, updatedAt: '2026-06-25T00:00:00.000Z' }];

    await expect(
      unlocked.service.filterResolvedMetadata(
        1,
        {
          communityRatings,
        },
        {},
      ),
    ).resolves.toEqual({
      resolved: {
        communityRatings,
      },
      providerIds: {},
      skippedFields: [],
    });

    const locked = makeService(['communityRating']);

    await expect(
      locked.service.filterResolvedMetadata(
        1,
        {
          communityRatings,
        },
        {},
      ),
    ).resolves.toEqual({
      resolved: {},
      providerIds: {},
      skippedFields: ['communityRating'],
    });
  });

  it('filters automated community rating dto updates as one lockable provider bundle', async () => {
    const { service } = makeService(['communityRating']);

    const result = await service.filterAutomatedBookUpdate(12, {
      title: 'Allowed',
      communityRatings: [{ provider: MetadataProviderKey.HARDCOVER, rating: 4.25, ratingCount: 12345 }],
    });

    expect(result).toEqual({
      dto: { title: 'Allowed' },
      skippedFields: ['communityRating'],
    });
  });

  it('propagates repository errors', async () => {
    const lockRepo = {
      findLockedFields: vi.fn().mockRejectedValue(new Error('db failure')),
      replaceLockedFields: vi.fn(),
    };
    const service = new BookMetadataLockService(lockRepo as never);

    await expect(service.getLockedFields(1)).rejects.toThrow('db failure');
  });

  it('filters resolved metadata and provider ids for locked fields', async () => {
    const { service } = makeService(['cover', 'authors', 'openLibraryId', 'hardcoverEditionId', 'comicVolumeName']);

    const result = await service.filterResolvedMetadata(
      12,
      {
        title: 'Allowed Title',
        authors: ['Locked Author'],
        hardcoverEditionId: '1001',
        coverUrl: 'https://example.com/cover.jpg',
        comicMetadata: {
          issueNumber: '7',
          volumeName: 'Locked Volume',
        },
      },
      {
        [MetadataProviderKey.GOOGLE]: 'g-id',
        [MetadataProviderKey.OPEN_LIBRARY]: 'ol-id',
      },
    );

    expect(result.resolved).toEqual({
      title: 'Allowed Title',
      comicMetadata: {
        issueNumber: '7',
      },
    });
    expect(result.providerIds).toEqual({
      [MetadataProviderKey.GOOGLE]: 'g-id',
    });
    expect(result.skippedFields).toEqual(['authors', 'hardcoverEditionId', 'openLibraryId', 'comicVolumeName', 'cover']);
  });
});
