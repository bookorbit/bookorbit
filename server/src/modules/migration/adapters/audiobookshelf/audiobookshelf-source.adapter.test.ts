import { describe, expect, it, vi } from 'vitest';

import { AudiobookshelfSourceAdapter } from './audiobookshelf-source.adapter';
import type { AudiobookshelfNormalizationResult, AudiobookshelfSourceRecords } from './audiobookshelf-source.types';

const apiConfig = {
  mode: 'api' as const,
  baseUrl: 'https://abs.example.com',
  apiToken: 'secret',
  allowPrivateNetwork: false,
};

function records(): AudiobookshelfSourceRecords {
  return {
    sourceVersion: '2.36.0',
    users: [],
    libraryItems: [],
    mediaProgress: [],
    bookmarks: [],
    playbackSessions: [],
    libraryFolders: [],
  };
}

function normalized(): AudiobookshelfNormalizationResult {
  return {
    sourceVersion: '2.36.0',
    pathPrefixes: ['/audiobooks'],
    warnings: ['one warning'],
    counters: {
      invalidUsersSkipped: 0,
      disabledUsersIncluded: 0,
      podcastItemsSkipped: 0,
      invalidBooksSkipped: 0,
      podcastProgressSkipped: 0,
      orphanedProgressSkipped: 0,
      unresolvedAudioProgressSkipped: 0,
      unsupportedEbookProgressSkipped: 0,
      podcastBookmarksSkipped: 0,
      orphanedBookmarksSkipped: 0,
      invalidBookmarksSkipped: 0,
      podcastSessionsSkipped: 0,
      orphanedSessionsSkipped: 0,
      invalidSessionsSkipped: 0,
    },
    data: {
      users: [{ sourceUserId: 'u1', username: 'reader', name: null, email: null }],
      books: [
        {
          sourceBookId: 'b1',
          title: 'Book',
          author: null,
          subtitle: null,
          isbn10: null,
          isbn13: null,
          description: null,
          publisher: null,
          publishedYear: null,
          language: null,
          filePath: '/audiobooks/book',
          fileHash: null,
          files: [
            {
              sourceFileId: 'f1',
              sourceBookId: 'b1',
              filePath: '/audiobooks/book/track.mp3',
              fileHash: null,
              fileName: 'track.mp3',
              fileSubPath: 'track.mp3',
              durationSeconds: 60,
              format: 'mp3',
              sortOrder: 0,
            },
          ],
          genres: [],
          tags: [],
        },
      ],
      userBookStatuses: [],
      userFileProgress: [],
      readingSessions: [],
      bookmarks: [],
      annotations: [],
      shelves: [],
      shelfBooks: [],
    },
  };
}

function buildAdapter() {
  const sourceRecords = records();
  const normalizationResult = normalized();
  const connector = {
    fetchSourceRecords: vi.fn().mockResolvedValue(sourceRecords),
    fetchSnapshotSummary: vi.fn().mockResolvedValue({
      sourceVersion: '2.36.0',
      counts: { users: 1, libraryItems: 1, mediaProgress: 0, bookmarks: 0, readingSessions: 0 },
    }),
    fetchLibraryFolders: vi.fn().mockResolvedValue([{ path: '/audiobooks/' }, { path: '/audiobooks' }, { path: '/other\\' }]),
  };
  const backupConnector = { fetchSourceRecords: vi.fn().mockResolvedValue(sourceRecords) };
  const normalizer = { normalize: vi.fn().mockReturnValue(normalizationResult) };
  return {
    adapter: new AudiobookshelfSourceAdapter(connector as never, backupConnector as never, normalizer as never),
    connector,
    backupConnector,
    normalizer,
    sourceRecords,
    normalizationResult,
  };
}

describe('AudiobookshelfSourceAdapter', () => {
  it('validates a live source from the summary without exporting the whole library', async () => {
    const { adapter, connector, normalizer } = buildAdapter();

    await expect(adapter.validate(apiConfig)).resolves.toEqual({
      ok: true,
      sourceType: 'audiobookshelf',
      sourceVersion: '2.36.0',
      missingTables: [],
      warnings: [],
      counts: { users: 1, libraryItems: 1, mediaProgress: 0, bookmarks: 0, readingSessions: 0 },
    });
    expect(connector.fetchSnapshotSummary).toHaveBeenCalledWith(apiConfig);
    expect(connector.fetchSourceRecords).not.toHaveBeenCalled();
    expect(normalizer.normalize).not.toHaveBeenCalled();
  });

  it('validates a backup source through the normalizer and reports its warnings', async () => {
    const { adapter, backupConnector, connector, normalizer, sourceRecords } = buildAdapter();
    const backupConfig = { mode: 'backup' as const, backupPath: '/imports/backup.audiobookshelf' };

    await expect(adapter.validate(backupConfig)).resolves.toEqual({
      ok: true,
      sourceType: 'audiobookshelf',
      sourceVersion: '2.36.0',
      missingTables: [],
      warnings: ['one warning'],
      counts: {
        users: 1,
        books: 1,
        files: 1,
        userBookStatuses: 0,
        userFileProgress: 0,
        readingSessions: 0,
        bookmarks: 0,
      },
    });
    expect(backupConnector.fetchSourceRecords).toHaveBeenCalledWith(backupConfig);
    expect(connector.fetchSnapshotSummary).not.toHaveBeenCalled();
    expect(normalizer.normalize).toHaveBeenCalledWith(sourceRecords);
  });

  it('builds a stable snapshot and returns the normalized export contract', async () => {
    const { adapter, connector, normalizationResult } = buildAdapter();
    const snapshot = await adapter.snapshot(apiConfig);

    expect(snapshot).toMatchObject({
      sourceType: 'audiobookshelf',
      sourceVersion: '2.36.0',
      counts: { users: 1, libraryItems: 1, mediaProgress: 0, bookmarks: 0, readingSessions: 0 },
    });
    expect(Date.parse(snapshot.generatedAt)).not.toBeNaN();
    expect(connector.fetchSnapshotSummary).toHaveBeenCalledWith(apiConfig);
    await expect(adapter.exportData(apiConfig)).resolves.toBe(normalizationResult.data);
  });

  it('normalizes unique path prefixes from live library folders', async () => {
    const { adapter } = buildAdapter();
    await expect(adapter.fetchPathPrefixes(apiConfig)).resolves.toEqual(['/audiobooks', '/other']);
  });

  it('normalizes backup records through the same source-record contract', async () => {
    const { adapter, backupConnector, connector, normalizer, sourceRecords, normalizationResult } = buildAdapter();
    const backupConfig = { mode: 'backup' as const, backupPath: '/imports/backup.audiobookshelf' };

    await expect(adapter.exportData(backupConfig)).resolves.toBe(normalizationResult.data);
    expect(backupConnector.fetchSourceRecords).toHaveBeenCalledWith(backupConfig);
    expect(connector.fetchSourceRecords).not.toHaveBeenCalled();
    expect(normalizer.normalize).toHaveBeenCalledWith(sourceRecords);

    await expect(adapter.fetchPathPrefixes(backupConfig)).resolves.toEqual(['/audiobooks']);
    await expect(adapter.snapshot(backupConfig)).resolves.toMatchObject({
      sourceType: 'audiobookshelf',
      sourceVersion: '2.36.0',
      counts: { users: 1, books: 1, files: 1 },
    });
  });
});
