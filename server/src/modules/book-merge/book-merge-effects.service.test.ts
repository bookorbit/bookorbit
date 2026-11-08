import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileLockService } from '../../common/services/file-lock.service';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, type AchievementEventsService } from '../achievement/achievement-events.service';
import type { BookConsolidationService } from '../book-consolidation/book-consolidation.service';
import type { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import type { BookEmbedderService } from '../embedding/book-embedder.service';
import type { MetadataScoreService } from '../metadata-score/metadata-score.service';
import type { ScannerService } from '../scanner/scanner.service';
import type { StoryEditsService } from '../story-edits/story-edits.service';
import type { UserBookStatusService } from '../user-book-status/user-book-status.service';
import type { ReadingAttemptEventsService } from '../user-book-status/reading-attempt-events.service';
import { BookMergeEffectsService, type MergeEffectsInput } from './book-merge-effects.service';
import type { MergeExecutionPlan } from './book-merge.planner';
import type { BookMergeRepository, MergeJobRow } from './book-merge.repository';
import type { UserStatisticsService } from '../user-statistics/user-statistics.service';

let workDir: string;
let libraryRoot: string;
let bookFolder: string;

function planOf(overrides: Partial<MergeExecutionPlan> = {}): MergeExecutionPlan {
  return {
    libraryId: 1,
    targetBookId: 1,
    destinationBookId: 1,
    destination: { libraryFolderId: 11, libraryFolderPath: libraryRoot, folderPath: bookFolder },
    steps: [{ sourceBookId: 2, moves: [], targetFileIds: [], droppedSidecarFileIds: [], vacatedFolders: [], roots: [libraryRoot] }],
    fieldSources: {},
    excludeTagIds: [],
    excludeGenreIds: [],
    hiddenRequestIds: [],
    identicalPairs: [],
    deleteIdenticalCopies: false,
    watched: false,
    ...overrides,
  };
}

function jobOf(plan: MergeExecutionPlan): MergeJobRow {
  return {
    id: 40,
    libraryId: 1,
    targetBookId: 1,
    destinationBookId: 1,
    sourceBookIds: [2],
    requestedByUserId: 7,
    status: 'committed',
    plan: plan as unknown as Record<string, unknown>,
    moves: [],
    outcomes: [],
    result: null,
    currentSourceBookId: null,
    processed: 1,
    total: 1,
    errorCode: null,
    error: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    finishedAt: null,
  };
}

function inputOf(plan: MergeExecutionPlan, overrides: Partial<MergeEffectsInput> = {}): MergeEffectsInput {
  return {
    job: jobOf(plan),
    plan,
    mergedSourceIds: [2],
    affectedUserIds: [],
    ratingChangedUserIds: [],
    koboEntitlementMovedUserIds: [],
    ...overrides,
  };
}

function createEffects() {
  const filePaths = new Map<number, string>();
  const repository = {
    findStatuses: vi.fn().mockResolvedValue(new Map<number, string>()),
    findRatings: vi.fn().mockResolvedValue(new Map<number, number | null>()),
    findFilePath: vi.fn((fileId: number) => Promise.resolve(filePaths.get(fileId) ?? null)),
    transaction: vi.fn((work: (tx: unknown) => Promise<unknown>) => work({ name: 'tx' })),
  };
  const consolidation = { retireFile: vi.fn().mockResolvedValue(undefined) };
  const coverStore = { adoptSlots: vi.fn().mockResolvedValue(undefined), removeCoverDirectory: vi.fn().mockResolvedValue(undefined) };
  const scanner = { scanBookDirectoryAsync: vi.fn() };
  const metadataScore = { calculateAndSaveMany: vi.fn().mockResolvedValue(undefined) };
  const embedder = { embedBook: vi.fn().mockResolvedValue(undefined) };
  const achievementEvents = { emit: vi.fn() };
  const readingAttemptEvents = { notifyChanged: vi.fn() };
  const userBookStatus = { projectKoboStatus: vi.fn().mockResolvedValue(undefined) };
  const storyEdits = { resyncBook: vi.fn().mockResolvedValue(0) };
  const userStatistics = {
    getUserTimeZone: vi.fn().mockResolvedValue('Europe/Berlin'),
    rebuildDailyStatsForUser: vi.fn().mockResolvedValue({ deleted: 0, inserted: 0, libraries: 0 }),
  };
  const effects = new BookMergeEffectsService(
    { appDataPath: join(workDir, 'data') } as never,
    repository as unknown as BookMergeRepository,
    consolidation as unknown as BookConsolidationService,
    coverStore as unknown as BookCoverStore,
    scanner as unknown as ScannerService,
    metadataScore as unknown as MetadataScoreService,
    embedder as unknown as BookEmbedderService,
    achievementEvents as unknown as AchievementEventsService,
    readingAttemptEvents as unknown as ReadingAttemptEventsService,
    userBookStatus as unknown as UserBookStatusService,
    storyEdits as unknown as StoryEditsService,
    new FileLockService(),
    new SelfWriteRegistry(),
    userStatistics as unknown as UserStatisticsService,
  );
  return {
    effects,
    repository,
    consolidation,
    coverStore,
    scanner,
    achievementEvents,
    readingAttemptEvents,
    userBookStatus,
    storyEdits,
    userStatistics,
    filePaths,
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'bookorbit-merge-effects-'));
  libraryRoot = join(workDir, 'library');
  bookFolder = join(libraryRoot, 'Dune');
  await mkdir(bookFolder, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workDir, { recursive: true, force: true });
});

describe('BookMergeEffectsService.apply', () => {
  it('does nothing when no source was merged', async () => {
    const { effects, coverStore, scanner } = createEffects();

    await expect(effects.apply(inputOf(planOf(), { mergedSourceIds: [] }))).resolves.toBe(0);

    expect(coverStore.adoptSlots).not.toHaveBeenCalled();
    expect(scanner.scanBookDirectoryAsync).not.toHaveBeenCalled();
  });

  it('hands the covers over and rescans the kept book folder', async () => {
    const { effects, coverStore, scanner, storyEdits } = createEffects();

    await effects.apply(inputOf(planOf()));

    expect(storyEdits.resyncBook).toHaveBeenCalledWith(1);

    expect(coverStore.adoptSlots).toHaveBeenCalledWith(2, [], 1);
    expect(coverStore.removeCoverDirectory).toHaveBeenCalledWith(2);
    expect(scanner.scanBookDirectoryAsync).toHaveBeenCalledWith(bookFolder, 1);
  });

  it('emits status events and projects the merged status to Kobo for every reader', async () => {
    const { effects, repository, achievementEvents, readingAttemptEvents, userBookStatus } = createEffects();
    repository.findStatuses.mockResolvedValue(
      new Map([
        [7, 'read'],
        [8, 'reading'],
        [9, 'rereading'],
      ]),
    );

    await effects.apply(inputOf(planOf(), { affectedUserIds: [7, 8], koboEntitlementMovedUserIds: [9] }));

    expect(repository.findStatuses).toHaveBeenCalledWith([7, 8, 9], 1);
    expect(achievementEvents.emit.mock.calls.map(([event, payload]) => [event, (payload as { userId: number }).userId])).toEqual([
      [ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, 7],
      [ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, 8],
    ]);
    expect(readingAttemptEvents.notifyChanged.mock.calls).toEqual([[7], [8]]);
    expect(userBookStatus.projectKoboStatus.mock.calls).toEqual([
      [7, [1], 'read'],
      [8, [1], 'reading'],
      [9, [1], 'rereading'],
    ]);
  });

  it('keeps projecting to Kobo for the other readers when one projection fails', async () => {
    const { effects, repository, userBookStatus } = createEffects();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    repository.findStatuses.mockResolvedValue(
      new Map([
        [7, 'read'],
        [8, 'read'],
      ]),
    );
    userBookStatus.projectKoboStatus.mockRejectedValueOnce(new Error('deadlock'));

    await effects.apply(inputOf(planOf(), { affectedUserIds: [7, 8] }));

    expect(userBookStatus.projectKoboStatus.mock.calls.map(([userId]) => userId)).toEqual([7, 8]);
  });

  it("rebuilds the daily reading stats of readers whose book changed library, in each reader's timezone", async () => {
    const { effects, userStatistics } = createEffects();
    userStatistics.rebuildDailyStatsForUser.mockRejectedValueOnce(new Error('locked'));

    await effects.apply(inputOf(planOf({ dailyStatsUserIds: [4, 5] })));

    expect(userStatistics.rebuildDailyStatsForUser.mock.calls).toEqual([
      [4, 'Europe/Berlin'],
      [5, 'Europe/Berlin'],
    ]);
  });

  it('leaves daily reading stats alone for a merge within one library', async () => {
    const { effects, userStatistics } = createEffects();

    await effects.apply(inputOf(planOf()));

    expect(userStatistics.rebuildDailyStatsForUser).not.toHaveBeenCalled();
  });

  it('skips the per-user steps when the readers are unknown', async () => {
    const { effects, repository, userBookStatus } = createEffects();

    await effects.apply(inputOf(planOf(), { affectedUserIds: null, ratingChangedUserIds: null, koboEntitlementMovedUserIds: null }));

    expect(repository.findStatuses).not.toHaveBeenCalled();
    expect(userBookStatus.projectKoboStatus).not.toHaveBeenCalled();
  });

  describe('identical copies', () => {
    async function pairOnDisk(filePaths: Map<number, string>, copyBytes: string, survivorBytes: string) {
      const copy = join(bookFolder, 'Dune (2).epub');
      const survivor = join(bookFolder, 'Dune.epub');
      await writeFile(copy, copyBytes);
      await writeFile(survivor, survivorBytes);
      filePaths.set(20, copy);
      filePaths.set(10, survivor);
      return { copy, survivor, plan: planOf({ deleteIdenticalCopies: true, identicalPairs: [{ loserFileId: 20, survivorFileId: 10 }] }) };
    }

    it('retires the copy and deletes it when it is still byte-identical', async () => {
      const { effects, consolidation, filePaths } = createEffects();
      const { copy, survivor, plan } = await pairOnDisk(filePaths, 'same bytes', 'same bytes');

      await expect(effects.apply(inputOf(plan))).resolves.toBe(1);

      expect(consolidation.retireFile).toHaveBeenCalledWith({ name: 'tx' }, { bookId: 1, loserFileId: 20, survivorFileId: 10 });
      expect(existsSync(copy)).toBe(false);
      expect(existsSync(survivor)).toBe(true);
    });

    it.each([
      ['its bytes changed since the preview', 'new  bytes', 'same bytes', 'content_changed'],
      ['its size changed since the preview', 'same bytes, longer', 'same bytes', 'size_changed'],
    ])('keeps the copy with a warning when %s', async (_name, copyBytes, survivorBytes, reason) => {
      const { effects, consolidation, filePaths } = createEffects();
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { copy, plan } = await pairOnDisk(filePaths, copyBytes, survivorBytes);

      await expect(effects.apply(inputOf(plan))).resolves.toBe(0);

      expect(consolidation.retireFile).not.toHaveBeenCalled();
      expect(existsSync(copy)).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`outcome=skipped reason=${reason}`));
    });

    it('keeps the copy when the file that stays is gone', async () => {
      const { effects, consolidation, filePaths } = createEffects();
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { copy, survivor, plan } = await pairOnDisk(filePaths, 'same bytes', 'same bytes');
      await rm(survivor);

      await expect(effects.apply(inputOf(plan))).resolves.toBe(0);

      expect(consolidation.retireFile).not.toHaveBeenCalled();
      expect(existsSync(copy)).toBe(true);
    });
  });
});
