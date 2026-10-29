import { ConflictException } from '@nestjs/common';
import type { AudiobookChapter, AudiobookChapterSource } from '@bookorbit/types';
import { FileLockService, bookOperationLockKey } from '../../common/services/file-lock.service';
import { computeAudiobookPositionsKey } from '../../common/utils/audiobook-chapters.utils';
import { AudiobookChaptersService } from './audiobook-chapters.service';

const TRACKS = [
  {
    id: 1,
    publicId: '11111111-1111-4111-8111-111111111111',
    absolutePath: '/books/Part 1.mp3',
    format: 'mp3',
    sizeBytes: 1000,
    durationSeconds: 10,
    sortOrder: 1,
    mtime: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
];
function setup(state: { chapters: AudiobookChapter[] | null; source: AudiobookChapterSource | null } | null = null) {
  const repo = {
    findTrackRows: vi.fn().mockResolvedValue(TRACKS),
    findChapterState: vi.fn().mockResolvedValue(state),
    writeChaptersWithVersions: vi.fn(),
    recordManifestRevision: vi.fn(),
    findPositionsKey: vi.fn().mockResolvedValue(null),
  };
  const locks = new FileLockService();
  return { repo, locks, service: new AudiobookChaptersService(repo as never, locks) };
}

describe('Audiobook chapter mutation', () => {
  it.each<AudiobookChapterSource>(['provider', 'migration', 'manual'])('keeps a %s list when the file has none', async (source) => {
    const { service, repo } = setup({ chapters: [{ title: 'Curated', startMs: 0 }], source });
    expect(await service.applyFileChapters(1, null)).toBe(false);
    expect(repo.writeChaptersWithVersions).not.toHaveBeenCalled();
  });
  it('clears obsolete file chapters with an atomic unlocked requirement', async () => {
    const { service, repo } = setup({ chapters: [{ title: 'Old', startMs: 0 }], source: 'embedded' });
    expect(await service.applyFileChapters(1, [])).toBe(true);
    expect(repo.writeChaptersWithVersions).toHaveBeenCalledWith(1, expect.objectContaining({ chapters: null, chaptersSource: null }), [], {
      requireUnlocked: true,
    });
  });
  it('does not rewrite an identical normalized list', async () => {
    const { service, repo } = setup({ chapters: [{ title: 'Same', startMs: 0 }], source: 'embedded' });
    expect(await service.applyFileChapters(1, [{ title: ' Same ', startMs: 0 }])).toBe(false);
    expect(repo.writeChaptersWithVersions).not.toHaveBeenCalled();
  });
  it('passes revision and protection to the transaction with the cleaned edit and its version', async () => {
    const { service, repo } = setup();
    const options = { expectedRevision: 'revision', locked: true };
    await service.saveEditedChapters(
      1,
      [
        { title: ' Second ', startMs: 5000 },
        { title: '', startMs: 0 },
      ],
      7,
      options,
    );
    const chapters = [
      { title: 'Chapter 1', startMs: 0 },
      { title: 'Second', startMs: 5000 },
    ];
    expect(repo.writeChaptersWithVersions).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ chapters, chaptersSource: 'manual', chaptersUpdatedBy: 7 }),
      [{ chapters, source: 'manual', createdBy: 7 }],
      options,
    );
  });
  it('credits lookup versions without declaring provider chapters a manual edit', async () => {
    const { service, repo } = setup();
    await service.saveLookedUpChapters(1, [{ title: 'Provider', startMs: 0 }], 7, { requireUnlocked: true });
    expect(repo.writeChaptersWithVersions).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ chaptersSource: 'provider', chaptersUpdatedBy: null }),
      [{ chapters: [{ title: 'Provider', startMs: 0 }], source: 'provider', createdBy: 7 }],
      { requireUnlocked: true },
    );
  });
  it('revert with no embedded chapters delegates preservation of the outgoing list to the transaction', async () => {
    const { service, repo } = setup({ chapters: [{ title: 'Old', startMs: 0 }], source: 'manual' });
    await service.restoreFileChapters(1, [], 7, { locked: false });
    expect(repo.writeChaptersWithVersions).toHaveBeenCalledWith(1, expect.objectContaining({ chapters: null, chaptersSource: null }), [], {
      locked: false,
    });
  });
  it('waits for book file work before mutating chapters', async () => {
    const { service, repo, locks } = setup();
    let release!: () => void;
    const write = locks.withLock(
      bookOperationLockKey(1),
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const save = service.saveEditedChapters(1, [{ title: 'New', startMs: 0 }], 7);
    await Promise.resolve();
    expect(repo.writeChaptersWithVersions).not.toHaveBeenCalled();
    release();
    await Promise.all([write, save]);
    expect(repo.writeChaptersWithVersions).toHaveBeenCalledTimes(1);
  });
  it('propagates an atomic stale-state refusal', async () => {
    const { service, repo } = setup();
    repo.writeChaptersWithVersions.mockRejectedValue(new ConflictException());
    await expect(service.saveEditedChapters(1, [{ title: 'New', startMs: 0 }], 7)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Offline revision compatibility', () => {
  it('keeps a revision compatible after more than 100 chapter edits without a registry lookup', async () => {
    const { service, repo } = setup();
    const held = await service.currentRevision(1, TRACKS);
    for (let index = 0; index < 150; index += 1) {
      repo.findChapterState.mockResolvedValue({ chapters: [{ title: String(index), startMs: 0 }], source: 'manual' });
      await service.currentRevision(1, TRACKS);
    }
    expect(await service.isPositionCompatible(1, held!.revision, computeAudiobookPositionsKey(TRACKS))).toBe(true);
    expect(repo.findPositionsKey).not.toHaveBeenCalled();
    expect(await service.isPositionCompatible(1, held!.revision, computeAudiobookPositionsKey([{ ...TRACKS[0], durationSeconds: 20 }]))).toBe(false);
  });
  it('accepts recorded legacy revisions only for their original layout', async () => {
    const { service, repo } = setup();
    repo.findPositionsKey.mockResolvedValue('layout-a');
    expect(await service.isPositionCompatible(1, 'legacy', 'layout-a')).toBe(true);
    expect(await service.isPositionCompatible(1, 'legacy', 'layout-b')).toBe(false);
  });
  it('refuses required preservation if the database fails, so file work cannot destroy its legacy mapping', async () => {
    const { service, repo } = setup();
    repo.recordManifestRevision.mockRejectedValue(new Error('database unavailable'));
    await expect(service.recordCurrentRevision(1, true)).rejects.toThrow('database unavailable');
  });
  it('has no revision without audio', async () => {
    const { service } = setup();
    expect(await service.currentRevision(1, [{ ...TRACKS[0], format: 'epub' }])).toBeNull();
  });
});
