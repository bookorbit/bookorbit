import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CalibreWebAutomatedSourceAdapter } from './calibre-web-automated-source.adapter';
import type { CalibreWebAutomatedNormalizationResult, CalibreWebAutomatedSourceRecords } from './calibre-web-automated-source.types';

const config = {
  mode: 'snapshot' as const,
  appDatabasePath: '/imports/cwa/app.db',
  metadataDatabasePath: '/imports/cwa/metadata.db',
};

function sourceRecords(): CalibreWebAutomatedSourceRecords {
  return {
    sourceVersion: null,
    compatibilityWarnings: ['Schema compatibility was verified against Calibre-Web Automated v4.0.6'],
    warnings: [],
    capabilities: {
      settings: true,
      authors: false,
      publishers: false,
      languages: false,
      series: false,
      ratings: false,
      comments: false,
      tags: false,
      identifiers: false,
      userBookStatuses: false,
      webProgress: false,
      koboProgress: false,
      koreaderProgress: false,
      shelves: false,
    },
    settings: [],
    users: [],
    books: [],
    files: [],
    authorLinks: [],
    publisherLinks: [],
    languageLinks: [],
    seriesLinks: [],
    ratingLinks: [],
    comments: [],
    tagLinks: [],
    identifiers: [],
    statuses: [],
    webProgress: [],
    koboReadingStates: [],
    koboBookmarks: [],
    koreaderProgress: [],
    checksums: [],
    shelves: [],
    shelfBooks: [],
  };
}

function normalized(): CalibreWebAutomatedNormalizationResult {
  return {
    sourceVersion: null,
    pathPrefixes: ['/logical/calibre-library'],
    warnings: [
      'Schema compatibility was verified against Calibre-Web Automated v4.0.6',
      'Compatible shelf data is unavailable because table shelf is missing',
    ],
    counters: {},
    data: {
      users: [{ sourceUserId: '1', username: 'reader', name: 'reader', email: null }],
      books: [
        {
          sourceBookId: '10',
          title: 'Book',
          author: null,
          subtitle: null,
          isbn10: null,
          isbn13: null,
          description: null,
          publisher: null,
          publishedYear: null,
          language: null,
          filePath: '/logical/calibre-library/Book/Book.epub',
          fileHash: null,
          files: [
            {
              sourceFileId: '10:100',
              sourceBookId: '10',
              filePath: '/logical/calibre-library/Book/Book.epub',
              fileHash: null,
              fileName: 'Book.epub',
              fileSubPath: 'Book/Book.epub',
              durationSeconds: null,
              format: 'epub',
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
      availableDomains: {
        metadata: true,
        authors: false,
        narrators: false,
        genres: false,
        tags: false,
        userBookStatuses: false,
        readingProgress: false,
        readingSessions: false,
        bookmarks: false,
        annotations: false,
        shelves: false,
        covers: false,
      },
    },
  };
}

function buildAdapter() {
  const records = sourceRecords();
  const normalizationResult = normalized();
  const connector = { fetchSourceRecords: vi.fn().mockResolvedValue(records) };
  const normalizer = { normalize: vi.fn().mockReturnValue(normalizationResult) };
  return {
    adapter: new CalibreWebAutomatedSourceAdapter(connector as never, normalizer as never),
    connector,
    normalizer,
    records,
    normalizationResult,
  };
}

describe('CalibreWebAutomatedSourceAdapter', () => {
  it('validates snapshots with a null source version and precise compatibility warnings', async () => {
    const { adapter, connector, normalizer, records } = buildAdapter();

    await expect(adapter.validate(config)).resolves.toEqual({
      ok: true,
      sourceType: 'calibre_web_automated',
      sourceVersion: null,
      missingTables: [],
      warnings: [
        'Schema compatibility was verified against Calibre-Web Automated v4.0.6',
        'Compatible shelf data is unavailable because table shelf is missing',
      ],
      counts: {
        users: 1,
        books: 1,
        files: 1,
        userBookStatuses: 0,
        userFileProgress: 0,
        shelves: 0,
        shelfBooks: 0,
      },
    });
    expect(connector.fetchSourceRecords).toHaveBeenCalledWith(config);
    expect(normalizer.normalize).toHaveBeenCalledWith(records);
  });

  it('builds stable snapshot counts and returns the normalized export contract', async () => {
    const { adapter, normalizationResult } = buildAdapter();

    const snapshot = await adapter.snapshot(config);

    expect(snapshot).toMatchObject({
      sourceType: 'calibre_web_automated',
      sourceVersion: null,
      counts: { users: 1, books: 1, files: 1, shelves: 0 },
    });
    expect(Date.parse(snapshot.generatedAt)).not.toBeNaN();
    await expect(adapter.exportData(config)).resolves.toBe(normalizationResult.data);
  });

  it('returns only the logical CWA media root and preserves inactive domains', async () => {
    const { adapter, normalizationResult } = buildAdapter();

    await expect(adapter.fetchPathPrefixes(config)).resolves.toEqual(['/logical/calibre-library']);
    expect((await adapter.exportData(config)).availableDomains).toEqual(normalizationResult.data.availableDomains);
    expect((await adapter.fetchPathPrefixes(config)).join()).not.toContain('/imports/cwa');
  });

  it('propagates sanitized connector failures without inventing validation results', async () => {
    const connector = {
      fetchSourceRecords: vi.fn().mockRejectedValue(new BadRequestException('Calibre-Web Automated snapshot database failed its integrity check')),
    };
    const adapter = new CalibreWebAutomatedSourceAdapter(connector as never, { normalize: vi.fn() } as never);

    await expect(adapter.validate(config)).rejects.toThrow('failed its integrity check');
  });
});
