import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RequestUser } from '../../common/types/request-user';
import { ReadingProgressService, toReadingProgressEntry } from './reading-progress.service';

const user = { id: 7 } as RequestUser;

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    percentage: 42.5,
    cfi: 'epubcfi(/6/22!/4/108/1:0)',
    pageNumber: null,
    positionSeconds: 812.4,
    mediaOverlayFragment: 'c9R.xhtml#s12',
    mediaOverlaySectionIndex: 9,
    narrationPercentage: 40,
    narrationUpdatedAt: new Date('2026-10-20T10:00:00.000Z'),
    textUpdatedAt: new Date('2026-10-21T10:00:00.000Z'),
    koboLocationSource: 'OEBPS/c9R.xhtml',
    koboLocationType: 'KoboSpan',
    koboLocationValue: 'kobo.12.3',
    koboContentSourceProgressPercent: 50,
    koreaderProgress: '/body/DocFragment[10]/body/p[3]',
    updatedAt: new Date('2026-10-21T10:00:00.000Z'),
    ...overrides,
  };
}

function makeService() {
  const books = {
    getProgress: vi.fn().mockResolvedValue(storedRow()),
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
    verifyFileAccess: vi.fn().mockResolvedValue({ id: 64 }),
    saveProgress: vi.fn().mockResolvedValue(undefined),
    clearFileProgress: vi.fn().mockResolvedValue(undefined),
  };
  const repo = {
    findProgress: vi.fn().mockResolvedValue(storedRow()),
    findProgressByBook: vi.fn().mockResolvedValue([]),
  };
  return { service: new ReadingProgressService(books as never, repo as never), books, repo };
}

describe('toReadingProgressEntry', () => {
  it('groups a stored row by the position each field belongs to', () => {
    expect(toReadingProgressEntry(64, storedRow())).toEqual({
      fileId: 64,
      percentage: 42.5,
      updatedAt: '2026-10-21T10:00:00.000Z',
      text: { cfi: 'epubcfi(/6/22!/4/108/1:0)', page: null, updatedAt: '2026-10-21T10:00:00.000Z' },
      narration: { seconds: 812.4, fragment: 'c9R.xhtml#s12', sectionIndex: 9, percentage: 40, updatedAt: '2026-10-20T10:00:00.000Z' },
      kobo: { source: 'OEBPS/c9R.xhtml', type: 'KoboSpan', value: 'kobo.12.3', contentPercent: 50 },
      koreader: '/body/DocFragment[10]/body/p[3]',
    });
  });

  it('answers an empty position for a file nothing was saved for', () => {
    const entry = toReadingProgressEntry(64, null);
    expect(entry.percentage).toBe(0);
    expect(entry.updatedAt).toBeNull();
    expect(entry.text).toEqual({ cfi: null, page: null, updatedAt: null });
    expect(entry.narration.fragment).toBeNull();
    expect(entry.kobo.value).toBeNull();
    expect(entry.koreader).toBeNull();
  });
});

describe('ReadingProgressService', () => {
  it('reads one file through the access-checked lookup', async () => {
    const { service, books } = makeService();
    const result = await service.forFile(64, user);
    expect(books.getProgress).toHaveBeenCalledWith(7, 64, user);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.fileId).toBe(64);
  });

  it('checks book access before listing every file of the book', async () => {
    const { service, books, repo } = makeService();
    repo.findProgressByBook.mockResolvedValue([
      { fileId: 64, ...storedRow() },
      { fileId: 65, ...storedRow({ percentage: null, cfi: null, updatedAt: null, textUpdatedAt: null }) },
    ]);
    const result = await service.forBook(60, user);
    expect(books.verifyBookAccess).toHaveBeenCalledWith(60, user);
    expect(repo.findProgressByBook).toHaveBeenCalledWith(7, 60);
    expect(result.items.map((item) => [item.fileId, item.percentage])).toEqual([
      [64, 42.5],
      [65, 0],
    ]);
  });

  it('saves a write through the existing progress pipeline with its fields mapped back', async () => {
    const { service, books } = makeService();
    const result = await service.save(
      [
        {
          fileId: 64,
          kind: 'narration',
          percentage: 8,
          text: { cfi: 'epubcfi(/6/2)', page: null },
          narration: { seconds: 12, fragment: 'a.xhtml#s1', sectionIndex: 2 },
          kobo: { source: 'a.xhtml', type: 'KoboSpan', value: 'kobo.1.1', contentPercent: 10 },
          koreader: '/body/p[1]',
        },
      ],
      user,
    );
    expect(books.saveProgress).toHaveBeenCalledWith(
      7,
      64,
      {
        source: 'narration',
        percentage: 8,
        cfi: 'epubcfi(/6/2)',
        pageNumber: null,
        positionSeconds: 12,
        mediaOverlayFragment: 'a.xhtml#s1',
        mediaOverlaySectionIndex: 2,
        koboLocationSource: 'a.xhtml',
        koboLocationType: 'KoboSpan',
        koboLocationValue: 'kobo.1.1',
        koboContentSourceProgressPercent: 10,
        koreaderProgress: '/body/p[1]',
      },
      user,
    );
    expect(result.results).toEqual([expect.objectContaining({ fileId: 64, status: 'saved' })]);
  });

  // The old route kept the stored narration marker when the fields were left out and cleared it
  // only on an explicit null. The grouped write has to keep both meanings apart.
  it('keeps the narration marker when the write leaves it out, and clears it on an explicit null', async () => {
    const { service, books } = makeService();
    await service.save([{ fileId: 64, percentage: 8, text: { cfi: 'epubcfi(/6/2)' } }], user);
    const omitted = books.saveProgress.mock.calls[0]![2];
    expect(omitted.positionSeconds).toBeUndefined();
    expect(omitted.mediaOverlayFragment).toBeUndefined();
    expect(omitted.mediaOverlaySectionIndex).toBeUndefined();

    await service.save([{ fileId: 64, percentage: 8, narration: { seconds: null, fragment: null, sectionIndex: null } }], user);
    const cleared = books.saveProgress.mock.calls[1]![2];
    expect(cleared.positionSeconds).toBeNull();
    expect(cleared.mediaOverlayFragment).toBeNull();
    expect(cleared.mediaOverlaySectionIndex).toBeNull();
  });

  it('returns the stored position instead of saving a write made before it', async () => {
    const { service, books } = makeService();
    const result = await service.save([{ fileId: 64, percentage: 8, editedAt: '2026-10-21T09:59:59.000Z' }], user);
    expect(books.saveProgress).not.toHaveBeenCalled();
    expect(result.results[0]).toEqual({ fileId: 64, status: 'superseded', progress: toReadingProgressEntry(64, storedRow()) });
  });

  it('saves a write made at or after the stored position', async () => {
    const { service, books } = makeService();
    await service.save([{ fileId: 64, percentage: 8, editedAt: '2026-10-21T10:00:00.000Z' }], user);
    await service.save([{ fileId: 64, percentage: 9, editedAt: '2026-10-21T10:00:01.000Z' }], user);
    expect(books.saveProgress).toHaveBeenCalledTimes(2);
  });

  it('saves a write with an edit time when nothing was stored yet', async () => {
    const { service, books, repo } = makeService();
    repo.findProgress.mockResolvedValueOnce(null);
    await service.save([{ fileId: 64, percentage: 8, editedAt: '2026-10-21T09:00:00.000Z' }], user);
    expect(books.saveProgress).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when any file in the batch is out of reach', async () => {
    const { service, books } = makeService();
    books.verifyFileAccess.mockResolvedValueOnce({ id: 64 }).mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.save(
        [
          { fileId: 64, percentage: 8 },
          { fileId: 65, percentage: 9 },
        ],
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(books.saveProgress).not.toHaveBeenCalled();
  });

  it('answers results in the order the writes were sent', async () => {
    const { service } = makeService();
    const result = await service.save(
      [
        { fileId: 65, percentage: 8 },
        { fileId: 64, percentage: 9 },
      ],
      user,
    );
    expect(result.results.map((entry) => entry.fileId)).toEqual([65, 64]);
  });

  it('clears one file through the existing reset', async () => {
    const { service, books } = makeService();
    await service.clear(64, user);
    expect(books.clearFileProgress).toHaveBeenCalledWith(7, 64, user);
  });
});
