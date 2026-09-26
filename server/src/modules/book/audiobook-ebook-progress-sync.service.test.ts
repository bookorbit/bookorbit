import { stat } from 'node:fs/promises';

import { buildEpubMediaOverlayPlaylistFromFile } from '../reader/epub/epub-media-overlay';
import { AudiobookEbookProgressSyncService } from './audiobook-ebook-progress-sync.service';

vi.mock('node:fs/promises', () => ({ stat: vi.fn() }));
vi.mock('../reader/epub/epub-media-overlay', () => ({ buildEpubMediaOverlayPlaylistFromFile: vi.fn() }));

const mockStat = vi.mocked(stat);
const mockBuildPlaylist = vi.mocked(buildEpubMediaOverlayPlaylistFromFile);

const SOURCE_TIME = new Date('2026-09-19T12:00:00.000Z');

function makeFiles(audioDuration: number | null = 100) {
  return {
    primaryFileId: 20,
    files: [
      {
        id: 10,
        absolutePath: '/library/audio.mp3',
        format: 'mp3',
        role: 'content',
        sortOrder: 0,
        durationSeconds: audioDuration,
        mediaOverlayAvailable: false,
        mediaOverlayDurationSeconds: null,
      },
      {
        id: 20,
        absolutePath: '/library/standard.epub',
        format: 'epub',
        role: 'content',
        sortOrder: 1,
        durationSeconds: null,
        mediaOverlayAvailable: false,
        mediaOverlayDurationSeconds: null,
      },
      {
        id: 30,
        absolutePath: '/library/read-along.epub',
        format: 'epub',
        role: 'content',
        sortOrder: 2,
        durationSeconds: null,
        mediaOverlayAvailable: true,
        mediaOverlayDurationSeconds: 100,
      },
    ],
  };
}

function makePlaylist() {
  return {
    bookId: 5,
    fileId: 30,
    durationSeconds: 100,
    sections: [],
    resources: [],
    items: [
      {
        index: 0,
        sectionIndex: 0,
        smilHref: 'OPS/chapter.smil',
        textHref: 'OPS/chapter.xhtml',
        textFragment: 'first',
        audioHref: 'OPS/audio.mp3',
        audioMimeType: 'audio/mpeg',
        clipBeginSeconds: 0,
        clipEndSeconds: 50,
        durationSeconds: 50,
        label: null,
      },
      {
        index: 1,
        sectionIndex: 0,
        smilHref: 'OPS/chapter.smil',
        textHref: 'OPS/chapter.xhtml',
        textFragment: 'second',
        audioHref: 'OPS/audio.mp3',
        audioMimeType: 'audio/mpeg',
        clipBeginSeconds: 50,
        clipEndSeconds: 100,
        durationSeconds: 50,
        label: null,
      },
    ],
  };
}

function makePlaylistWithZeroLengthClip() {
  const playlist = makePlaylist();
  return {
    ...playlist,
    items: [
      { ...playlist.items[0]!, textFragment: 'before', clipEndSeconds: 40, durationSeconds: 40 },
      {
        ...playlist.items[1]!,
        textFragment: 'zero',
        clipBeginSeconds: 40,
        clipEndSeconds: 40,
        durationSeconds: 0,
      },
      {
        ...playlist.items[1]!,
        index: 2,
        textFragment: 'after',
        clipBeginSeconds: 40,
        clipEndSeconds: 100,
        durationSeconds: 60,
      },
    ],
  };
}

/** A Storyteller read-along EPUB beside the original, with the audiobook never imported. */
function makeFilesWithoutAudio() {
  const files = makeFiles();
  return { ...files, primaryFileId: 30, files: files.files.filter((file) => file.format === 'epub') };
}

function makeFixture(audioDuration = 100, syncFiles: ReturnType<typeof makeFiles> = makeFiles(audioDuration)) {
  const bookRepo = {
    findReadAloudSyncMode: vi.fn().mockResolvedValue('auto'),
    findAudioEbookProgressSyncFiles: vi.fn().mockResolvedValue(syncFiles),
    upsertSyncedEpubProgressIfNewer: vi.fn().mockResolvedValue(true),
    syncKoboReadingStateFromProgress: vi.fn().mockResolvedValue(undefined),
    upsertAudioProgress: vi.fn().mockResolvedValue({ revision: 2 }),
  };
  const positionConverter = {
    fragmentToPositions: vi.fn(({ bookFileId, fragment }: { bookFileId: number; fragment: string }) =>
      Promise.resolve({ status: 'exact', cfi: `epubcfi(${bookFileId}-${fragment})`, koreaderProgress: `/body/${bookFileId}/${fragment}` }),
    ),
    nearestFragmentForPosition: vi.fn().mockResolvedValue({ status: 'exact', fragment: 'second', chapterIndex: 0 }),
  };
  return {
    bookRepo,
    positionConverter,
    service: new AudiobookEbookProgressSyncService(bookRepo as never, positionConverter as never),
  };
}

describe('AudiobookEbookProgressSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);
    mockBuildPlaylist.mockResolvedValue(makePlaylist());
  });

  it('maps accepted audiobook progress to both the normal and read-along EPUB', async () => {
    const { service, bookRepo, positionConverter } = makeFixture();

    await expect(
      service.syncFromAudioProgress({
        userId: 7,
        bookId: 5,
        currentFileId: 10,
        positionSeconds: 75,
        percentage: 75,
        syncKobo: true,
        sourceUpdatedAt: SOURCE_TIME,
      }),
    ).resolves.toBe(true);

    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledTimes(2);
    // The plain EPUB has no narration to resume, so it gets the text position without a marker.
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 7,
        fileId: 20,
        percentage: 75,
        positionSeconds: null,
        mediaOverlayFragment: null,
        mediaOverlaySectionIndex: null,
        sourceUpdatedAt: SOURCE_TIME,
      }),
    );
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 7,
        fileId: 30,
        percentage: 75,
        positionSeconds: 75,
        mediaOverlayFragment: 'OPS/chapter.xhtml#second',
        mediaOverlaySectionIndex: 0,
        sourceUpdatedAt: SOURCE_TIME,
      }),
    );
    expect(bookRepo.syncKoboReadingStateFromProgress).toHaveBeenCalledWith(7, 20, 75, null, null, null, null);
    expect(positionConverter.fragmentToPositions).toHaveBeenCalledWith(
      expect.objectContaining({ bookFileId: 20, sourceBookFileId: 30, fragment: 'second' }),
    );
  });

  it.each([40, 75, 100])('skips a zero-length media-overlay clip when mapping %s seconds', async (positionSeconds) => {
    const { service, bookRepo, positionConverter } = makeFixture();
    mockBuildPlaylist.mockResolvedValueOnce(makePlaylistWithZeroLengthClip());

    await expect(
      service.syncFromAudioProgress({
        userId: 7,
        bookId: 5,
        currentFileId: 10,
        positionSeconds,
        percentage: positionSeconds,
        syncKobo: false,
        sourceUpdatedAt: SOURCE_TIME,
      }),
    ).resolves.toBe(true);

    expect(positionConverter.fragmentToPositions).toHaveBeenCalledTimes(2);
    expect(positionConverter.fragmentToPositions).toHaveBeenNthCalledWith(1, expect.objectContaining({ fragment: 'after' }));
    expect(positionConverter.fragmentToPositions).toHaveBeenNthCalledWith(2, expect.objectContaining({ fragment: 'after' }));
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledTimes(2);
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fileId: 20,
        cfi: 'epubcfi(20-after)',
        percentage: positionSeconds,
        positionSeconds: null,
        mediaOverlayFragment: null,
      }),
    );
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        fileId: 30,
        percentage: positionSeconds,
        positionSeconds,
        mediaOverlayFragment: 'OPS/chapter.xhtml#after',
      }),
    );
  });

  it('does not replace or forward a newer EPUB position', async () => {
    const { service, bookRepo } = makeFixture();
    bookRepo.upsertSyncedEpubProgressIfNewer.mockResolvedValue(false);

    await expect(
      service.syncFromAudioProgress({
        userId: 7,
        bookId: 5,
        currentFileId: 10,
        positionSeconds: 25,
        percentage: 25,
        syncKobo: true,
        sourceUpdatedAt: SOURCE_TIME,
      }),
    ).resolves.toBe(false);

    expect(bookRepo.syncKoboReadingStateFromProgress).not.toHaveBeenCalled();
  });

  it('maps an EPUB position to revision-safe audiobook progress and the sibling EPUB', async () => {
    const { service, bookRepo, positionConverter } = makeFixture();

    await expect(
      service.syncFromEbookProgress({
        userId: 7,
        bookId: 5,
        bookFileId: 20,
        percentage: 75,
        cfi: 'epubcfi(/6/4)',
        sourceUpdatedAt: SOURCE_TIME,
      }),
    ).resolves.toBe(true);

    expect(bookRepo.upsertAudioProgress).toHaveBeenCalledWith(7, 5, 10, 50, 50, SOURCE_TIME);
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 30, percentage: 50, positionSeconds: 50, sourceUpdatedAt: SOURCE_TIME }),
    );
    expect(positionConverter.nearestFragmentForPosition).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 20, sourceBookFileId: 30 }));
  });

  it('skips a zero-length clip when propagating an EPUB narration position to a sibling', async () => {
    const { service, bookRepo, positionConverter } = makeFixture();
    mockBuildPlaylist.mockResolvedValueOnce(makePlaylistWithZeroLengthClip());

    await expect(
      service.syncFromEbookProgress({
        userId: 7,
        bookId: 5,
        bookFileId: 30,
        percentage: 75,
        positionSeconds: 75,
        mediaOverlayFragment: 'OPS/chapter.xhtml#after',
        mediaOverlaySectionIndex: 0,
        sourceUpdatedAt: SOURCE_TIME,
      }),
    ).resolves.toBe(true);

    expect(bookRepo.upsertAudioProgress).toHaveBeenCalledWith(7, 5, 10, 75, 75, SOURCE_TIME);
    expect(positionConverter.fragmentToPositions).toHaveBeenCalledWith(
      expect.objectContaining({ bookFileId: 20, sourceBookFileId: 30, fragment: 'after' }),
    );
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 20, cfi: 'epubcfi(20-after)', positionSeconds: null, mediaOverlayFragment: null }),
    );
  });

  it('follows the text position of a plain EPUB that sends back a narration marker an older sync left on it', async () => {
    const { service, bookRepo, positionConverter } = makeFixture();

    await expect(
      service.syncFromEbookProgress({
        userId: 7,
        bookId: 5,
        bookFileId: 20,
        percentage: 75,
        cfi: 'epubcfi(/6/4)',
        positionSeconds: 10,
        mediaOverlayFragment: 'OPS/chapter.xhtml#first',
        mediaOverlaySectionIndex: 0,
        sourceUpdatedAt: SOURCE_TIME,
      }),
    ).resolves.toBe(true);

    // The stale marker names 'first' at 10 seconds; the page the reader is on resolves to 'second'.
    expect(positionConverter.nearestFragmentForPosition).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 20, cfi: 'epubcfi(/6/4)' }));
    expect(bookRepo.upsertAudioProgress).toHaveBeenCalledWith(7, 5, 10, 50, 50, SOURCE_TIME);
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 30, positionSeconds: 50, mediaOverlayFragment: 'OPS/chapter.xhtml#second' }),
    );
  });

  it('writes a read-along position to the plain sibling without a narration marker', async () => {
    const { service, bookRepo } = makeFixture();

    await expect(
      service.syncFromEbookProgress({ userId: 7, bookId: 5, bookFileId: 30, percentage: 75, cfi: 'epubcfi(/6/4)', sourceUpdatedAt: SOURCE_TIME }),
    ).resolves.toBe(true);

    expect(bookRepo.upsertAudioProgress).toHaveBeenCalledWith(7, 5, 10, 50, 50, SOURCE_TIME);
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledOnce();
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 20,
        percentage: 50,
        positionSeconds: null,
        mediaOverlayFragment: null,
        mediaOverlaySectionIndex: null,
      }),
    );
  });

  it('stops sibling propagation when a newer audiobook state rejects the source write', async () => {
    const { service, bookRepo } = makeFixture();
    bookRepo.upsertAudioProgress.mockResolvedValue(undefined);

    await expect(
      service.syncFromEbookProgress({
        userId: 7,
        bookId: 5,
        bookFileId: 20,
        percentage: 75,
        cfi: 'epubcfi(/6/4)',
        sourceUpdatedAt: SOURCE_TIME,
      }),
    ).resolves.toBe(false);

    expect(bookRepo.upsertSyncedEpubProgressIfNewer).not.toHaveBeenCalled();
  });

  it('syncs narration to the audiobook without moving a sibling text position', async () => {
    const { service, bookRepo } = makeFixture();

    await expect(
      service.syncFromEbookProgress({
        userId: 7,
        bookId: 5,
        bookFileId: 30,
        percentage: 32,
        positionSeconds: 10,
        mediaOverlayFragment: 'OPS/chapter.xhtml#first',
        mediaOverlaySectionIndex: 0,
        sourceUpdatedAt: SOURCE_TIME,
        syncSiblingEpubs: false,
      }),
    ).resolves.toBe(true);

    expect(bookRepo.upsertAudioProgress).toHaveBeenCalledWith(7, 5, 10, 10, 10, SOURCE_TIME);
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).not.toHaveBeenCalled();
  });

  it('rejects mapping when audiobook and overlay durations exceed tolerance', async () => {
    const { service, bookRepo } = makeFixture(120);

    await expect(
      service.syncFromAudioProgress({
        userId: 7,
        bookId: 5,
        currentFileId: 10,
        positionSeconds: 50,
        percentage: 50,
        syncKobo: false,
      }),
    ).resolves.toBe(false);

    expect(bookRepo.upsertSyncedEpubProgressIfNewer).not.toHaveBeenCalled();
  });

  it('does no mapping work when read-aloud sync is disabled', async () => {
    const { service, bookRepo } = makeFixture();
    bookRepo.findReadAloudSyncMode.mockResolvedValue('disabled');

    await expect(
      service.syncFromAudioProgress({
        userId: 7,
        bookId: 5,
        currentFileId: 10,
        positionSeconds: 50,
        percentage: 50,
        syncKobo: false,
      }),
    ).resolves.toBe(false);

    expect(bookRepo.findAudioEbookProgressSyncFiles).not.toHaveBeenCalled();
    expect(mockBuildPlaylist).not.toHaveBeenCalled();
  });
});

describe('AudiobookEbookProgressSyncService sibling EPUBs without an audiobook', () => {
  const KOREADER_XPOINTER = '/body/DocFragment[1]/body/p[3]/text().0';

  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);
    mockBuildPlaylist.mockResolvedValue(makePlaylist());
  });

  it('carries a device position on the original EPUB to the read-along copy', async () => {
    const { service, bookRepo, positionConverter } = makeFixture(100, makeFilesWithoutAudio());

    await expect(
      service.syncFromEbookProgress({
        userId: 7,
        bookId: 5,
        bookFileId: 20,
        percentage: 69,
        cfi: 'epubcfi(/6/4)',
        koreaderProgress: KOREADER_XPOINTER,
        sourceUpdatedAt: SOURCE_TIME,
      }),
    ).resolves.toBe(true);

    expect(bookRepo.upsertAudioProgress).not.toHaveBeenCalled();
    expect(positionConverter.nearestFragmentForPosition).toHaveBeenCalledWith(
      expect.objectContaining({ bookFileId: 20, sourceBookFileId: 30, cfi: 'epubcfi(/6/4)', xpointer: KOREADER_XPOINTER }),
    );
    expect(positionConverter.fragmentToPositions).toHaveBeenCalledWith({ bookFileId: 30, sourceBookFileId: 30, chapterIndex: 0, fragment: 'second' });
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledOnce();
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledWith({
      userId: 7,
      fileId: 30,
      cfi: 'epubcfi(30-second)',
      koreaderProgress: '/body/30/second',
      percentage: 69,
      positionSeconds: 50,
      mediaOverlayFragment: 'OPS/chapter.xhtml#second',
      mediaOverlaySectionIndex: 0,
      sourceUpdatedAt: SOURCE_TIME,
    });
  });

  it('carries a web position on the read-along copy to the original without a narration marker', async () => {
    const { service, bookRepo, positionConverter } = makeFixture(100, makeFilesWithoutAudio());

    await expect(
      service.syncFromEbookProgress({
        userId: 7,
        bookId: 5,
        bookFileId: 30,
        percentage: 67,
        cfi: 'epubcfi(/6/4)',
        koreaderProgress: KOREADER_XPOINTER,
        sourceUpdatedAt: SOURCE_TIME,
      }),
    ).resolves.toBe(true);

    expect(positionConverter.nearestFragmentForPosition).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 30, sourceBookFileId: 30 }));
    expect(positionConverter.fragmentToPositions).toHaveBeenCalledWith({ bookFileId: 20, sourceBookFileId: 30, chapterIndex: 0, fragment: 'second' });
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledOnce();
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledWith({
      userId: 7,
      fileId: 20,
      cfi: 'epubcfi(20-second)',
      koreaderProgress: '/body/20/second',
      percentage: 67,
      positionSeconds: null,
      mediaOverlayFragment: null,
      mediaOverlaySectionIndex: null,
      sourceUpdatedAt: SOURCE_TIME,
    });
  });

  it('parses nothing for a read-along EPUB that has no sibling and no audiobook', async () => {
    const readAlongOnly = makeFilesWithoutAudio();
    readAlongOnly.files = readAlongOnly.files.filter((file) => file.id === 30);
    const { service, bookRepo, positionConverter } = makeFixture(100, readAlongOnly);

    await expect(
      service.syncFromEbookProgress({ userId: 7, bookId: 5, bookFileId: 30, percentage: 67, cfi: 'epubcfi(/6/4)', sourceUpdatedAt: SOURCE_TIME }),
    ).resolves.toBe(false);

    expect(mockStat).not.toHaveBeenCalled();
    expect(mockBuildPlaylist).not.toHaveBeenCalled();
    expect(positionConverter.nearestFragmentForPosition).not.toHaveBeenCalled();
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).not.toHaveBeenCalled();
  });

  it('parses nothing for a narration write that did not move the text position', async () => {
    const { service, bookRepo, positionConverter } = makeFixture(100, makeFilesWithoutAudio());

    await expect(
      service.syncFromEbookProgress({
        userId: 7,
        bookId: 5,
        bookFileId: 30,
        percentage: 32,
        positionSeconds: 10,
        mediaOverlayFragment: 'OPS/chapter.xhtml#first',
        mediaOverlaySectionIndex: 0,
        sourceUpdatedAt: SOURCE_TIME,
        syncSiblingEpubs: false,
      }),
    ).resolves.toBe(false);

    expect(mockBuildPlaylist).not.toHaveBeenCalled();
    expect(positionConverter.nearestFragmentForPosition).not.toHaveBeenCalled();
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).not.toHaveBeenCalled();
  });

  it('keeps every copy on its own position when read-aloud sync is disabled', async () => {
    const { service, bookRepo } = makeFixture(100, makeFilesWithoutAudio());
    bookRepo.findReadAloudSyncMode.mockResolvedValue('disabled');

    await expect(
      service.syncFromEbookProgress({ userId: 7, bookId: 5, bookFileId: 20, percentage: 69, koreaderProgress: KOREADER_XPOINTER }),
    ).resolves.toBe(false);

    expect(bookRepo.findAudioEbookProgressSyncFiles).not.toHaveBeenCalled();
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).not.toHaveBeenCalled();
  });

  it.each([
    ['its duration is too far from the narration', () => makeFixture(120)],
    ['a file has no duration', () => makeFixture(100, makeFiles(null))],
  ])('syncs the sibling EPUB by text when the audiobook cannot be mapped because %s', async (_reason, fixture) => {
    const { service, bookRepo } = fixture();

    await expect(
      service.syncFromEbookProgress({
        userId: 7,
        bookId: 5,
        bookFileId: 20,
        percentage: 69,
        koreaderProgress: KOREADER_XPOINTER,
        sourceUpdatedAt: SOURCE_TIME,
      }),
    ).resolves.toBe(true);

    expect(bookRepo.upsertAudioProgress).not.toHaveBeenCalled();
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledOnce();
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 30, percentage: 69, positionSeconds: 50, mediaOverlayFragment: 'OPS/chapter.xhtml#second' }),
    );
  });

  it('writes nothing when the copies do not share the chapter text', async () => {
    const { service, bookRepo, positionConverter } = makeFixture(100, makeFilesWithoutAudio());
    positionConverter.fragmentToPositions.mockResolvedValue({ status: 'failed', reason: 'chapter_text_mismatch' } as never);

    await expect(
      service.syncFromEbookProgress({ userId: 7, bookId: 5, bookFileId: 30, percentage: 67, cfi: 'epubcfi(/6/4)', sourceUpdatedAt: SOURCE_TIME }),
    ).resolves.toBe(false);

    expect(bookRepo.upsertSyncedEpubProgressIfNewer).not.toHaveBeenCalled();
  });

  it('writes nothing when the position cannot be placed on the narration', async () => {
    const { service, bookRepo, positionConverter } = makeFixture(100, makeFilesWithoutAudio());
    positionConverter.nearestFragmentForPosition.mockResolvedValue({ status: 'failed', reason: 'no_candidate_fragments' });

    await expect(
      service.syncFromEbookProgress({ userId: 7, bookId: 5, bookFileId: 20, percentage: 69, koreaderProgress: KOREADER_XPOINTER }),
    ).resolves.toBe(false);

    expect(positionConverter.fragmentToPositions).not.toHaveBeenCalled();
    expect(bookRepo.upsertSyncedEpubProgressIfNewer).not.toHaveBeenCalled();
  });

  it('reports no sync when the sibling already holds a newer position', async () => {
    const { service, bookRepo } = makeFixture(100, makeFilesWithoutAudio());
    bookRepo.upsertSyncedEpubProgressIfNewer.mockResolvedValue(false);

    await expect(
      service.syncFromEbookProgress({ userId: 7, bookId: 5, bookFileId: 20, percentage: 69, koreaderProgress: KOREADER_XPOINTER }),
    ).resolves.toBe(false);

    expect(bookRepo.upsertSyncedEpubProgressIfNewer).toHaveBeenCalledOnce();
  });
});
