import { describe, expect, it } from 'vitest';

import { AudiobookshelfNormalizer } from './audiobookshelf-normalizer';
import type {
  AudiobookshelfBookLibraryItemRecord,
  AudiobookshelfBookRecord,
  AudiobookshelfMediaProgressRecord,
  AudiobookshelfSourceRecords,
} from './audiobookshelf-source.types';

const normalizer = new AudiobookshelfNormalizer();

function book(overrides: Partial<AudiobookshelfBookRecord> = {}): AudiobookshelfBookRecord {
  return {
    id: 'book-1',
    title: 'The Glass Harbor',
    authors: [{ id: 'author-1', name: 'Mara Vale' }],
    audioFiles: [
      {
        ino: '100',
        index: 1,
        duration: 60,
        format: 'MP3',
        metadata: { path: '/source/glass/01.mp3', relPath: 'glass/01.mp3', filename: '01.mp3', ext: '.mp3' },
      },
      {
        ino: '101',
        index: 2,
        duration: 90,
        format: 'MP3',
        metadata: { path: '/source/glass/02.mp3', relPath: 'glass/02.mp3', filename: '02.mp3', ext: '.mp3' },
      },
    ],
    ...overrides,
  };
}

function bookItem(bookOverrides: Partial<AudiobookshelfBookRecord> = {}, itemOverrides: Partial<AudiobookshelfBookLibraryItemRecord> = {}) {
  return {
    id: 'item-1',
    mediaType: 'book' as const,
    path: '/source/glass',
    relPath: 'glass',
    book: book(bookOverrides),
    ...itemOverrides,
  };
}

function progress(overrides: Partial<AudiobookshelfMediaProgressRecord> = {}): AudiobookshelfMediaProgressRecord {
  return {
    id: 'progress-1',
    userId: 'user-1',
    mediaItemId: 'book-1',
    mediaItemType: 'book',
    duration: 150,
    currentTime: 0,
    ebookProgress: 0,
    isFinished: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function source(overrides: Partial<AudiobookshelfSourceRecords> = {}): AudiobookshelfSourceRecords {
  return {
    sourceVersion: '2.36.0',
    users: [{ id: 'user-1', username: 'maya', email: null }],
    libraryItems: [bookItem()],
    mediaProgress: [],
    bookmarks: [],
    playbackSessions: [],
    libraryFolders: [{ path: '/source' }],
    ...overrides,
  };
}

describe('AudiobookshelfNormalizer books and users', () => {
  it('normalizes users, metadata, contributors, identifiers, files, and path prefixes', () => {
    const result = normalizer.normalize(
      source({
        users: [
          { id: 'user-1', username: 'maya', email: undefined },
          { id: 'user-2', username: 'disabled', email: ' disabled@example.com ', isActive: false },
          { id: '', username: 'invalid' },
        ],
        libraryItems: [
          bookItem({
            subtitle: 'A Chronicle',
            isbn: '978-1-4028-9462-6',
            asin: ' b012345678 ',
            description: ' Synthetic description ',
            publisher: 'North Light Press',
            publishedYear: '2024',
            language: 'en',
            duration: 150.5,
            abridged: true,
            authors: [
              { id: 'author-1', name: 'Mara Vale', sortName: 'Vale, Mara', description: 'Author bio' },
              { id: 'author-duplicate', name: 'mara vale' },
            ],
            narrators: ['Ira Stone', 'Ira Stone', ''],
            genres: ['Fantasy', ' Fantasy ', 'Adventure'],
            tags: ['Synthetic', '', 'Synthetic'],
            series: [{ id: 'series-1', name: 'Harbor Cycle', sequence: '2.5' }],
            audioFiles: [
              {
                ino: 'excluded',
                index: 0,
                duration: 5,
                format: 'mp3',
                exclude: true,
                metadata: { path: '/source/glass/excluded.mp3', relPath: 'glass/excluded.mp3' },
              },
              {
                ino: '101',
                index: 2,
                duration: 90,
                format: 'MP3',
                metadata: { path: '/source/glass/02.mp3', relPath: 'glass/02.mp3', filename: '02.mp3' },
              },
              {
                ino: '100',
                index: 1,
                duration: 60,
                format: 'MP2/3 (MPEG audio layer 2/3)',
                metadata: { path: '/source/glass/01.mp3', relPath: 'glass/01.mp3', filename: '01.mp3', ext: '.mp3' },
              },
            ],
            ebookFile: {
              ino: '200',
              ebookFormat: 'EPUB',
              metadata: { path: '/source/glass/book.epub', relPath: 'glass/book.epub', filename: 'book.epub' },
            },
          }),
          { id: 'podcast-1', mediaType: 'podcast', path: '/podcasts', mediaId: 'podcast-media-1' },
        ],
        libraryFolders: [{ path: '/source/' }, { path: '/source' }, { path: '/other' }],
      }),
    );

    expect(result.data.users).toEqual([
      { sourceUserId: 'user-1', username: 'maya', name: null, email: null },
      { sourceUserId: 'user-2', username: 'disabled', name: null, email: 'disabled@example.com' },
    ]);
    expect(result.counters.invalidUsersSkipped).toBe(1);
    expect(result.counters.disabledUsersIncluded).toBe(1);
    expect(result.counters.podcastItemsSkipped).toBe(1);
    expect(result.pathPrefixes).toEqual(['/other', '/source']);

    expect(result.data.books).toHaveLength(1);
    expect(result.data.books[0]).toMatchObject({
      sourceBookId: 'book-1',
      title: 'The Glass Harbor',
      author: 'Mara Vale',
      subtitle: 'A Chronicle',
      isbn10: null,
      isbn13: '9781402894626',
      asin: 'B012345678',
      description: 'Synthetic description',
      publisher: 'North Light Press',
      publishedYear: 2024,
      language: 'en',
      durationSeconds: 150.5,
      abridged: true,
      seriesName: 'Harbor Cycle',
      seriesIndex: 2.5,
      genres: ['Fantasy', 'Adventure'],
      tags: ['Synthetic'],
    });
    expect(result.data.books[0]?.amazonId).toBeUndefined();
    expect(result.data.books[0]?.audibleId).toBe('B012345678');
    expect(result.data.books[0]?.presentFields).toContain('audibleId');
    expect(result.data.books[0]?.authors).toEqual([
      {
        sourceContributorId: 'author-1',
        name: 'Mara Vale',
        sortName: 'Vale, Mara',
        description: 'Author bio',
        displayOrder: 0,
      },
    ]);
    expect(result.data.books[0]?.narrators).toEqual([
      { sourceContributorId: null, name: 'Ira Stone', sortName: null, description: null, displayOrder: 0 },
    ]);
    expect(result.data.books[0]?.files).toEqual([
      expect.objectContaining({ sourceFileId: 'book-1:audio:100', format: 'mp3', sortOrder: 0, durationSeconds: 60 }),
      expect.objectContaining({ sourceFileId: 'book-1:audio:101', format: 'mp3', sortOrder: 1, durationSeconds: 90 }),
      expect.objectContaining({ sourceFileId: 'book-1:ebook:200', format: 'epub', sortOrder: 0, durationSeconds: null }),
    ]);
  });

  it('maps an ebook ASIN to Amazon metadata without clearing an unrelated Audible ID', () => {
    const result = normalizer.normalize(
      source({
        libraryItems: [
          bookItem({
            asin: 'B098765432',
            audioFiles: [],
            ebookFile: {
              ino: '200',
              ebookFormat: 'EPUB',
              metadata: { path: '/source/glass/book.epub', relPath: 'glass/book.epub', filename: 'book.epub' },
            },
          }),
        ],
      }),
    );

    expect(result.data.books[0]?.amazonId).toBe('B098765432');
    expect(result.data.books[0]?.audibleId).toBeUndefined();
    expect(result.data.books[0]?.presentFields).toContain('amazonId');
    expect(result.data.books[0]?.presentFields).not.toContain('audibleId');
  });

  it('does not expose a provider metadata field for an invalid ASIN', () => {
    const result = normalizer.normalize(source({ libraryItems: [bookItem({ asin: 'invalid' })] }));

    expect(result.data.books[0]?.asin).toBeNull();
    expect(result.data.books[0]?.amazonId).toBeUndefined();
    expect(result.data.books[0]?.audibleId).toBeUndefined();
    expect(result.data.books[0]?.presentFields).not.toContain('amazonId');
    expect(result.data.books[0]?.presentFields).not.toContain('audibleId');
  });

  it('declares a metadata field present only when the source carries a value', () => {
    const result = normalizer.normalize(
      source({
        libraryItems: [
          bookItem({
            title: 'The Glass Harbor',
            duration: 150,
            subtitle: null,
            publisher: null,
            description: null,
            language: null,
            publishedYear: null,
            series: [],
            abridged: null,
          }),
        ],
      }),
    );

    const presentFields = result.data.books[0]?.presentFields ?? [];
    expect(presentFields).toContain('title');
    expect(presentFields).toContain('durationSeconds');
    for (const absent of ['subtitle', 'publisher', 'description', 'language', 'publishedYear', 'seriesName', 'seriesIndex', 'abridged']) {
      expect(presentFields).not.toContain(absent);
    }
  });

  it('keeps a falsy but explicit metadata value present', () => {
    const result = normalizer.normalize(source({ libraryItems: [bookItem({ abridged: false, duration: 0 })] }));

    expect(result.data.books[0]?.presentFields).toEqual(expect.arrayContaining(['abridged', 'durationSeconds']));
  });

  it('normalizes ISBN-10 and keeps file IDs unique across books with the same inode', () => {
    const result = normalizer.normalize(
      source({
        libraryItems: [
          bookItem({ id: 'book-a', isbn: '0-306-40615-2', authors: [], authorName: 'Legacy Author' }, { id: 'item-a' }),
          bookItem({ id: 'book-b', isbn: 'invalid', title: 'Second Book' }, { id: 'item-b' }),
        ],
      }),
    );

    expect(result.data.books[0]).toMatchObject({ isbn10: '0306406152', isbn13: null, author: 'Legacy Author' });
    expect(result.data.books[1]).toMatchObject({ isbn10: null, isbn13: null });
    expect(result.data.books[0]?.files?.[0]?.sourceFileId).toBe('book-a:audio:100');
    expect(result.data.books[1]?.files?.[0]?.sourceFileId).toBe('book-b:audio:100');
  });

  it('uses deterministic book-scoped path IDs when file inodes are unavailable', () => {
    const item = bookItem({
      audioFiles: [
        {
          index: null,
          duration: 10,
          metadata: { path: '/source/chapter.mp3', relPath: '\\folder\\chapter.mp3', filename: 'chapter.mp3', ext: 'mp3' },
        },
      ],
    });
    const first = normalizer.normalize(source({ libraryItems: [item] }));
    const second = normalizer.normalize(source({ libraryItems: [item] }));

    expect(first.data.books[0]?.files?.[0]?.sourceFileId).toBe('book-1:audio:path:folder/chapter.mp3');
    expect(second.data.books[0]?.files?.[0]?.sourceFileId).toBe(first.data.books[0]?.files?.[0]?.sourceFileId);
  });

  it('disambiguates duplicate inodes within the same book deterministically', () => {
    const result = normalizer.normalize(
      source({
        libraryItems: [
          bookItem({
            audioFiles: [
              { ...book().audioFiles![0]!, ino: 'same' },
              { ...book().audioFiles![1]!, ino: 'same' },
            ],
          }),
        ],
      }),
    );

    expect(result.data.books[0]?.files?.map((file) => file.sourceFileId)).toEqual(['book-1:audio:same', 'book-1:audio:same:path:glass/02.mp3']);
  });
});

describe('AudiobookshelfNormalizer progress', () => {
  it.each([
    [30, 'book-1:audio:100', 30, 20],
    [60, 'book-1:audio:101', 0, 40],
    [75, 'book-1:audio:101', 15, 50],
    [150, 'book-1:audio:101', 90, 100],
    [200, 'book-1:audio:101', 90, 100],
  ])('maps absolute second %s to the ordered track', (currentTime, sourceFileId, localSeconds, percentage) => {
    const result = normalizer.normalize(source({ mediaProgress: [progress({ currentTime })] }));

    expect(result.data.userFileProgress).toEqual([expect.objectContaining({ sourceFileId, positionSeconds: localSeconds, percentage })]);
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])('does not emit audio progress for invalid position %s', (currentTime) => {
    const result = normalizer.normalize(source({ mediaProgress: [progress({ currentTime })] }));

    expect(result.data.userFileProgress).toEqual([]);
    expect(result.data.userBookStatuses[0]).toMatchObject({ status: 'unread', percentage: 0 });
  });

  it('resolves single-file positions without a track duration and rejects unsafe multi-file positions', () => {
    const single = normalizer.normalize(
      source({
        libraryItems: [bookItem({ duration: null, audioFiles: [{ ...book().audioFiles![0]!, duration: null }] })],
        mediaProgress: [progress({ duration: null, progress: 0.5, currentTime: 75 })],
      }),
    );
    const multiple = normalizer.normalize(
      source({
        libraryItems: [
          bookItem({
            audioFiles: [book().audioFiles![0]!, { ...book().audioFiles![1]!, duration: null }],
          }),
        ],
        mediaProgress: [progress({ currentTime: 75 })],
      }),
    );

    expect(single.data.userFileProgress[0]).toMatchObject({ sourceFileId: 'book-1:audio:100', positionSeconds: 75, percentage: 50 });
    expect(multiple.data.userFileProgress).toEqual([]);
    expect(multiple.counters.unresolvedAudioProgressSkipped).toBe(1);
    expect(multiple.warnings).toContain('1 audiobook positions could not be resolved safely');
  });

  it('preserves independent EPUB and audio progress for a mixed-format book', () => {
    const result = normalizer.normalize(
      source({
        libraryItems: [
          bookItem({
            ebookFile: {
              ino: '200',
              ebookFormat: 'epub',
              metadata: { path: '/source/glass/book.epub', relPath: 'glass/book.epub', filename: 'book.epub' },
            },
          }),
        ],
        mediaProgress: [
          progress({
            currentTime: 75,
            ebookProgress: 0.375,
            ebookLocation: 'epubcfi(/6/2[chapter]!/4/1:0)',
            lastUpdate: 1_704_153_600_000,
          }),
        ],
      }),
    );

    expect(result.data.userFileProgress).toEqual([
      expect.objectContaining({ sourceFileId: 'book-1:audio:101', positionSeconds: 15, percentage: 50, cfi: null }),
      expect.objectContaining({
        sourceFileId: 'book-1:ebook:200',
        positionSeconds: null,
        percentage: 37.5,
        cfi: 'epubcfi(/6/2[chapter]!/4/1:0)',
        updatedAt: '2024-01-02T00:00:00.000Z',
      }),
    ]);
    expect(result.data.userBookStatuses[0]).toMatchObject({ status: 'reading', percentage: 50 });
  });

  it('does not synthesize audio progress from an EPUB-only completion on a mixed book', () => {
    const result = normalizer.normalize(
      source({
        libraryItems: [
          bookItem({
            ebookFile: { ino: '200', ebookFormat: 'epub', metadata: { path: '/source/book.epub', filename: 'book.epub' } },
          }),
        ],
        mediaProgress: [
          progress({
            currentTime: 0,
            progress: 1,
            ebookProgress: 1,
            ebookLocation: 'epubcfi(/6/2)',
            isFinished: true,
            finishedAt: '2024-02-03T04:05:06.000Z',
            lastUpdate: '2024-02-04T04:05:06.000Z',
          }),
        ],
      }),
    );

    expect(result.data.userFileProgress).toHaveLength(1);
    expect(result.data.userFileProgress[0]).toMatchObject({ sourceFileId: 'book-1:ebook:200', percentage: 100 });
    expect(result.data.userBookStatuses[0]).toEqual({
      sourceUserId: 'user-1',
      sourceBookId: 'book-1',
      status: 'read',
      percentage: 100,
      startedAt: '2024-01-01T00:00:00.000Z',
      finishedAt: '2024-02-03T04:05:06.000Z',
      updatedAt: '2024-02-04T04:05:06.000Z',
    });
  });

  it('reports reading status for a resume position the server gives no percentage for', () => {
    const result = normalizer.normalize(
      source({
        libraryItems: [
          bookItem({
            audioFiles: [],
            ebookFile: { ino: '200', ebookFormat: 'epub', metadata: { path: '/source/book.epub', filename: 'book.epub' } },
          }),
        ],
        mediaProgress: [progress({ duration: null, currentTime: 0, progress: null, ebookProgress: null, ebookLocation: 'epubcfi(/6/2)' })],
      }),
    );

    expect(result.data.userFileProgress[0]).toMatchObject({ cfi: 'epubcfi(/6/2)', percentage: 0 });
    expect(result.data.userBookStatuses[0]).toMatchObject({ status: 'reading', percentage: 0 });
  });

  it('keeps valid EPUB percentages when the CFI is invalid and skips empty locator rows', () => {
    const item = bookItem({
      audioFiles: [],
      ebookFile: { ino: '200', ebookFormat: 'epub', metadata: { path: '/source/book.epub', filename: 'book.epub' } },
    });
    const withPercentage = normalizer.normalize(
      source({ libraryItems: [item], mediaProgress: [progress({ ebookProgress: 0.2, ebookLocation: 'chapter-3' })] }),
    );
    const empty = normalizer.normalize(source({ libraryItems: [item], mediaProgress: [progress({ ebookProgress: 0, ebookLocation: 'bad' })] }));

    expect(withPercentage.data.userFileProgress[0]).toMatchObject({ percentage: 20, cfi: null });
    expect(withPercentage.counters.unsupportedEbookProgressSkipped).toBe(1);
    expect(empty.data.userFileProgress).toEqual([]);
  });

  it('skips podcast and orphaned progress without affecting valid users', () => {
    const result = normalizer.normalize(
      source({
        mediaProgress: [
          progress({ mediaItemType: 'podcastEpisode' }),
          progress({ id: 'orphan-book', mediaItemId: 'missing' }),
          progress({ id: 'orphan-user', userId: 'missing' }),
        ],
      }),
    );

    expect(result.data.userBookStatuses).toEqual([]);
    expect(result.counters.podcastProgressSkipped).toBe(1);
    expect(result.counters.orphanedProgressSkipped).toBe(2);
  });
});

describe('AudiobookshelfNormalizer bookmarks, sessions, and domains', () => {
  it('preserves absolute bookmark seconds and skips malformed, orphaned, and podcast bookmarks', () => {
    const result = normalizer.normalize(
      source({
        libraryItems: [bookItem(), { id: 'podcast-1', mediaType: 'podcast', mediaId: 'podcast-media-1' }],
        bookmarks: [
          { userId: 'user-1', libraryItemId: 'item-1', time: 42, title: 'Harbor entrance', createdAt: 1_704_067_200_000 },
          { userId: 'user-1', libraryItemId: 'item-1', time: -1 },
          { userId: 'user-1', libraryItemId: 'missing', time: 10 },
          { userId: 'user-1', libraryItemId: 'podcast-1', time: 10 },
        ],
      }),
    );

    expect(result.data.bookmarks).toEqual([
      {
        sourceUserId: 'user-1',
        sourceBookId: 'book-1',
        title: 'Harbor entrance',
        cfi: null,
        positionSeconds: 42,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
    expect(result.counters.invalidBookmarksSkipped).toBe(1);
    expect(result.counters.orphanedBookmarksSkipped).toBe(1);
    expect(result.counters.podcastBookmarksSkipped).toBe(1);
  });

  it('builds valid listening sessions and rejects contradictory, orphaned, and podcast rows', () => {
    const result = normalizer.normalize(
      source({
        playbackSessions: [
          {
            id: 'session-1',
            userId: 'user-1',
            mediaItemId: 'book-1',
            mediaItemType: 'book',
            duration: 150,
            startTime: 30,
            currentTime: 75,
            timeListening: 300,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:10:00.000Z',
          },
          {
            id: 'too-long-for-wall-clock',
            userId: 'user-1',
            mediaItemId: 'book-1',
            mediaItemType: 'book',
            duration: 150,
            startTime: 30,
            currentTime: 75,
            timeListening: 700,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:10:00.000Z',
          },
          {
            id: 'orphan',
            userId: 'missing',
            mediaItemId: 'book-1',
            mediaItemType: 'book',
            duration: 150,
            startTime: 0,
            currentTime: 10,
            timeListening: 10,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:10.000Z',
          },
          {
            id: 'podcast',
            userId: 'user-1',
            mediaItemId: 'episode-1',
            mediaItemType: 'podcastEpisode',
            duration: 150,
            startTime: 0,
            currentTime: 10,
            timeListening: 10,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:10.000Z',
          },
        ],
      }),
    );

    expect(result.data.readingSessions).toEqual([
      {
        sourceSessionId: 'session-1',
        sourceUserId: 'user-1',
        sourceBookId: 'book-1',
        bookType: 'AUDIOBOOK',
        startedAt: '2024-01-01T00:00:00.000Z',
        endedAt: '2024-01-01T00:10:00.000Z',
        durationSeconds: 300,
        progressDelta: 30,
        endProgress: 50,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
    expect(result.counters.invalidSessionsSkipped).toBe(1);
    expect(result.counters.orphanedSessionsSkipped).toBe(1);
    expect(result.counters.podcastSessionsSkipped).toBe(1);
  });

  it('declares accurate domain availability when optional source relationships are absent', () => {
    const result = normalizer.normalize(
      source({
        playbackSessions: null,
        authorsAvailable: false,
        warnings: ['Series relationships are unavailable'],
      }),
    );

    expect(result.data.availableDomains).toEqual({
      metadata: true,
      authors: false,
      narrators: true,
      genres: true,
      tags: true,
      userBookStatuses: true,
      readingProgress: true,
      readingSessions: false,
      bookmarks: true,
      annotations: false,
      shelves: false,
      covers: false,
    });
    expect(result.warnings).toContain('Series relationships are unavailable');
    expect(result.warnings).toContain('Listening sessions are unavailable from this source snapshot');
  });
});
