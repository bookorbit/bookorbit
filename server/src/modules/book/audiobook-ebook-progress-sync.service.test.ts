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

describe('AudiobookEbookProgressSyncService narration following the text', () => {
  const NARRATED_AT = new Date('2026-09-19T11:00:00.000Z');

  function makeNarrationFixture(progress: Record<string, unknown> | null) {
    const fixture = makeFixture(100, makeFilesWithoutAudio());
    Object.assign(fixture.bookRepo, {
      findProgress: vi.fn().mockResolvedValue(progress),
      advanceNarrationMarker: vi.fn().mockResolvedValue(true),
    });
    return fixture as typeof fixture & {
      bookRepo: typeof fixture.bookRepo & { findProgress: ReturnType<typeof vi.fn>; advanceNarrationMarker: ReturnType<typeof vi.fn> };
    };
  }

  const marker = (fragment: string) => ({
    positionSeconds: null,
    mediaOverlayFragment: `OPS/chapter.xhtml#${fragment}`,
    mediaOverlaySectionIndex: 0,
    narrationUpdatedAt: NARRATED_AT,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);
    mockBuildPlaylist.mockResolvedValue(makePlaylist());
  });

  const reading = { userId: 7, bookId: 5, bookFileId: 30, percentage: 60, cfi: 'epubcfi(/6/4!/4/90/1:0)', sourceUpdatedAt: SOURCE_TIME };

  // A page reached on a Kobo, a phone or the web is where listening should pick up.
  it('moves the marker to the sentence a newer page reached', async () => {
    const { service, bookRepo, positionConverter } = makeNarrationFixture(marker('first'));

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(true);

    expect(positionConverter.nearestFragmentForPosition).toHaveBeenCalledWith(
      expect.objectContaining({ bookFileId: 30, cfi: reading.cfi, sourceBookFileId: 30 }),
    );
    expect(bookRepo.advanceNarrationMarker).toHaveBeenCalledWith({
      userId: 7,
      fileId: 30,
      mediaOverlayFragment: 'OPS/chapter.xhtml#second',
      mediaOverlaySectionIndex: 0,
      percentage: 60,
      sourceUpdatedAt: SOURCE_TIME,
    });
  });

  // A page starts behind the sentence being narrated on it; turning to it must not replay audio.
  it('leaves a marker the page has not passed', async () => {
    const { service, bookRepo } = makeNarrationFixture(marker('second'));

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(false);
    expect(bookRepo.advanceNarrationMarker).not.toHaveBeenCalled();
  });

  it('leaves a marker less than a page ahead of a newer page', async () => {
    const { service, bookRepo, positionConverter } = makeNarrationFixture(marker('second'));
    positionConverter.nearestFragmentForPosition.mockResolvedValueOnce({ status: 'exact', fragment: 'first', chapterIndex: 0 });

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(false);
    expect(bookRepo.advanceNarrationMarker).not.toHaveBeenCalled();
  });

  // Going back pages to read them again takes the narration along.
  it('pulls the marker back to a newer page well behind it', async () => {
    const { service, bookRepo, positionConverter } = makeNarrationFixture(marker('second'));
    const playlist = makePlaylist();
    mockBuildPlaylist.mockResolvedValueOnce({
      ...playlist,
      durationSeconds: 300,
      items: [
        { ...playlist.items[0]!, clipEndSeconds: 150, durationSeconds: 150 },
        { ...playlist.items[1]!, clipBeginSeconds: 150, clipEndSeconds: 300, durationSeconds: 150 },
      ],
    });
    positionConverter.nearestFragmentForPosition.mockResolvedValueOnce({ status: 'exact', fragment: 'first', chapterIndex: 0 });

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(true);
    expect(bookRepo.advanceNarrationMarker).toHaveBeenCalledWith(expect.objectContaining({ mediaOverlayFragment: 'OPS/chapter.xhtml#first' }));
  });

  it('pulls the marker back to a newer page in an earlier chapter', async () => {
    const { service, bookRepo, positionConverter } = makeNarrationFixture({ ...marker('second'), mediaOverlaySectionIndex: 1 });
    const playlist = makePlaylist();
    mockBuildPlaylist.mockResolvedValueOnce({
      ...playlist,
      items: [playlist.items[0]!, { ...playlist.items[1]!, sectionIndex: 1, textHref: 'OPS/chapter.xhtml' }],
    });
    positionConverter.nearestFragmentForPosition.mockResolvedValueOnce({ status: 'exact', fragment: 'first', chapterIndex: 0 });

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(true);
    expect(bookRepo.advanceNarrationMarker).toHaveBeenCalledWith(expect.objectContaining({ mediaOverlaySectionIndex: 0 }));
  });

  it('leaves narration saved after the page', async () => {
    const { service, bookRepo } = makeNarrationFixture({ ...marker('first'), narrationUpdatedAt: new Date('2026-09-19T12:30:00.000Z') });

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(false);
    expect(bookRepo.advanceNarrationMarker).not.toHaveBeenCalled();
  });

  it('starts a file that was never narrated at the sentence the reader reached', async () => {
    const { service, bookRepo } = makeNarrationFixture({
      positionSeconds: null,
      mediaOverlayFragment: null,
      mediaOverlaySectionIndex: null,
      narrationUpdatedAt: null,
    });

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(true);
    expect(bookRepo.advanceNarrationMarker).toHaveBeenCalledWith(expect.objectContaining({ mediaOverlayFragment: 'OPS/chapter.xhtml#second' }));
  });

  it('places a marker saved only as seconds by its sentence', async () => {
    const { service, bookRepo } = makeNarrationFixture({ ...marker('first'), mediaOverlayFragment: null, positionSeconds: 75 });

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(false);
    expect(bookRepo.advanceNarrationMarker).not.toHaveBeenCalled();
  });

  it('does nothing for a file without narration', async () => {
    const { service, bookRepo } = makeNarrationFixture(marker('first'));

    await expect(service.advanceNarrationToText({ ...reading, bookFileId: 20 })).resolves.toBe(false);
    expect(bookRepo.findProgress).not.toHaveBeenCalled();
    expect(bookRepo.advanceNarrationMarker).not.toHaveBeenCalled();
  });

  it('reports a failure without throwing', async () => {
    const { service, bookRepo, positionConverter } = makeNarrationFixture(marker('first'));
    positionConverter.nearestFragmentForPosition.mockRejectedValueOnce(new Error('unreadable chapter'));

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(false);
    expect(bookRepo.advanceNarrationMarker).not.toHaveBeenCalled();
  });

  // The cover has no narration of its own; a reader back on it is before the first sentence.
  it('pulls the marker back to the first narrated sentence for a page on the cover', async () => {
    const { service, bookRepo, positionConverter } = makeNarrationFixture({ ...marker('second'), mediaOverlaySectionIndex: 2 });
    const playlist = makePlaylist();
    mockBuildPlaylist.mockResolvedValueOnce({
      ...playlist,
      items: [
        { ...playlist.items[0]!, sectionIndex: 1 },
        { ...playlist.items[1]!, sectionIndex: 2 },
      ],
    });
    positionConverter.nearestFragmentForPosition.mockResolvedValueOnce({ status: 'failed', reason: 'no_candidate_fragments', chapterIndex: 0 });

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(true);
    expect(bookRepo.advanceNarrationMarker).toHaveBeenCalledWith(
      expect.objectContaining({ mediaOverlayFragment: 'OPS/chapter.xhtml#first', mediaOverlaySectionIndex: 1 }),
    );
  });

  it('carries the marker to the last narrated sentence for a page past the narration', async () => {
    const { service, bookRepo, positionConverter } = makeNarrationFixture(marker('first'));
    positionConverter.nearestFragmentForPosition.mockResolvedValueOnce({ status: 'failed', reason: 'no_candidate_fragments', chapterIndex: 5 });

    await expect(service.advanceNarrationToText(reading)).resolves.toBe(true);
    expect(bookRepo.advanceNarrationMarker).toHaveBeenCalledWith(expect.objectContaining({ mediaOverlayFragment: 'OPS/chapter.xhtml#second' }));
  });
});

describe('AudiobookEbookProgressSyncService narration after a reset', () => {
  const RESET_AT = new Date('2026-10-17T16:00:00.000Z');

  function makeResetFixture() {
    const fixture = makeFixture(100, makeFiles());
    const startNarrationAfterReset = vi.fn().mockResolvedValue(true);
    Object.assign(fixture.bookRepo, { startNarrationAfterReset });
    return { ...fixture, startNarrationAfterReset };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);
    mockBuildPlaylist.mockResolvedValue(makePlaylist());
  });

  // A player paused before the reset compares its own marker with this one, so it asks first.
  it('leaves each read-along on its first narrated sentence, stamped with the reset', async () => {
    const { service, startNarrationAfterReset } = makeResetFixture();

    await service.startNarrationAfterReset({ userId: 7, bookId: 5, resetAt: RESET_AT });

    expect(startNarrationAfterReset).toHaveBeenCalledOnce();
    expect(startNarrationAfterReset).toHaveBeenCalledWith({
      userId: 7,
      fileId: 30,
      mediaOverlayFragment: 'OPS/chapter.xhtml#first',
      mediaOverlaySectionIndex: 0,
      resetAt: RESET_AT,
    });
  });

  it('leaves a read-along alone when only another file was reset', async () => {
    const { service, startNarrationAfterReset } = makeResetFixture();

    await service.startNarrationAfterReset({ userId: 7, bookId: 5, fileIds: [20], resetAt: RESET_AT });

    expect(startNarrationAfterReset).not.toHaveBeenCalled();
  });

  it('reports a failure without throwing', async () => {
    const { service, startNarrationAfterReset } = makeResetFixture();
    mockBuildPlaylist.mockRejectedValueOnce(new Error('unreadable package'));

    await expect(service.startNarrationAfterReset({ userId: 7, bookId: 5, resetAt: RESET_AT })).resolves.toBeUndefined();
    expect(startNarrationAfterReset).not.toHaveBeenCalled();
  });
});
