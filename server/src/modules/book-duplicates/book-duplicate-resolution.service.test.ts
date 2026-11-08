import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import {
  EMPTY_CONTENT_FILTER_RULES,
  Permission,
  type BookDuplicateCandidate,
  type BookDuplicateGroupOutcome,
  type BookDuplicateKind,
  type BookDuplicateMatchReason,
} from '@bookorbit/types';

import { LibraryOperationGate } from '../../common/services/library-operation-gate.service';
import type { RequestUser } from '../../common/types/request-user';
import { BookDuplicateResolutionService, groupStatus } from './book-duplicate-resolution.service';

function userWith(permissions: Permission[]): RequestUser {
  return { id: 7, isSuperuser: false, permissions, contentFilters: EMPTY_CONTENT_FILTER_RULES } as unknown as RequestUser;
}

const both = userWith([Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks]);
const mergeOnly = userWith([Permission.LibraryMergeBooks]);
const deleteOnly = userWith([Permission.LibraryDeleteBooks]);

interface GroupFixture {
  kind: BookDuplicateKind;
  reasons: BookDuplicateMatchReason[];
  members: number[];
}

function candidate(id: number, overrides: Partial<BookDuplicateCandidate> = {}): BookDuplicateCandidate {
  return {
    id,
    title: `Book ${id}`,
    subtitle: null,
    authors: [],
    libraryId: 1,
    libraryName: 'Library',
    folderPath: `book-${id}`,
    status: 'present',
    files: [],
    isbn10: null,
    isbn13: null,
    metadataScore: null,
    readStatus: null,
    readingProgress: null,
    collections: [],
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    hasCover: false,
    bookPerFile: false,
    ...overrides,
  };
}

function setup(groups: Record<number, GroupFixture>, liveIds: number[] = Object.values(groups).flatMap((group) => group.members)) {
  const gate = new LibraryOperationGate();
  const live = new Map(liveIds.map((id) => [id, { id, libraryId: 1, status: 'present' }]));
  const repo = {
    create: vi.fn().mockResolvedValue({ id: 70 }),
    update: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue(null),
    findRunningForUser: vi.fn().mockResolvedValue(null),
    markInterruptedFailed: vi.fn().mockResolvedValue(0),
    findResolvableGroups: vi.fn().mockResolvedValue([]),
    findGroups: vi.fn((_scanId: number, ids: number[]) =>
      Promise.resolve(ids.filter((id) => groups[id]).map((id) => ({ id, kind: groups[id]!.kind, reasons: groups[id]!.reasons }))),
    ),
    findMemberIds: vi.fn((_scanId: number, ids: number[]) =>
      Promise.resolve(new Map(ids.filter((id) => groups[id]).map((id) => [id, groups[id]!.members]))),
    ),
    findLiveBooks: vi.fn((ids: number[]) => Promise.resolve(ids.filter((id) => live.has(id)).map((id) => live.get(id)!))),
  };
  const duplicates = {
    findResolvableScan: vi.fn().mockResolvedValue({ id: 2, libraryIds: [1] }),
    findCandidates: vi.fn().mockResolvedValue(new Map()),
  };
  const merges = {
    mergeWithinLease: vi.fn((request: { targetBookId: number; sourceBookIds: number[] }) => {
      for (const id of request.sourceBookIds) live.delete(id);
      return Promise.resolve({
        jobId: 1,
        status: 'completed',
        blockers: [],
        outcomes: request.sourceBookIds.map((sourceBookId) => ({ sourceBookId, status: 'merged', errorCode: null })),
        errorCode: null,
      });
    }),
  };
  const links = { link: vi.fn().mockResolvedValue({ groupId: 40 }) };
  const books = {
    deleteBooks: vi.fn((ids: number[]) => {
      for (const id of ids) live.delete(id);
      return Promise.resolve({ total: ids.length, books: [], omitted: 0 });
    }),
  };
  const gateway = { emitDuplicateResolution: vi.fn() };
  const auditEvents = { emit: vi.fn() };
  const libraries = { verifyAccessLevel: vi.fn().mockResolvedValue(undefined) };
  const service = new BookDuplicateResolutionService(
    repo as never,
    duplicates as never,
    merges as never,
    links as never,
    books as never,
    gate,
    gateway as never,
    auditEvents as never,
    libraries as never,
  );
  return { service, repo, duplicates, merges, links, books, gateway, gate, live, auditEvents, libraries };
}

async function finished(repo: { update: ReturnType<typeof vi.fn> }): Promise<BookDuplicateGroupOutcome[]> {
  await vi.waitFor(() => expect(repo.update).toHaveBeenCalledWith(70, expect.objectContaining({ finishedAt: expect.any(Date) })));
  const call = repo.update.mock.calls.find(([, values]) => (values as { finishedAt?: Date }).finishedAt);
  return (call![1] as { outcomes: BookDuplicateGroupOutcome[] }).outcomes;
}

const isbn = (members: number[]): GroupFixture => ({ kind: 'duplicate', reasons: ['isbn'], members });

describe('BookDuplicateResolutionService', () => {
  it('holds the library gate for the whole run and releases it after the last group (H12)', async () => {
    const { service, repo, merges, gate, gateway } = setup({ 5: isbn([10, 11]), 6: isbn([20, 21]) });
    const heldBetweenGroups: boolean[] = [];
    repo.update.mockImplementation((_id: number, values: { currentGroupId?: number | null }) => {
      if (values.currentGroupId) heldBetweenGroups.push(gate.isHeld(1) && gate.tryAcquire(1, 'scan') === null);
      return Promise.resolve();
    });
    merges.mergeWithinLease.mockImplementation((request, _user, lease) => {
      expect(lease.holds(1)).toBe(true);
      return Promise.resolve({
        jobId: 1,
        status: 'completed',
        blockers: [],
        outcomes: request.sourceBookIds.map((id: number) => ({ sourceBookId: id, status: 'merged', errorCode: null })),
        errorCode: null,
      });
    });

    const started = await service.start(
      {
        scanId: 2,
        groups: [
          { groupId: 5, keeperId: 10, action: 'merge' },
          { groupId: 6, keeperId: 20, action: 'merge' },
        ],
      },
      both,
    );
    const outcomes = await finished(repo);

    expect(started).toEqual({ jobId: 70, total: 2 });
    expect(heldBetweenGroups).toEqual([true, true]);
    expect(gate.isHeld(1)).toBe(false);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['done', 'done']);
    expect(repo.update).toHaveBeenCalledWith(70, expect.objectContaining({ processed: 1 }));
    expect(repo.update).toHaveBeenCalledWith(70, expect.objectContaining({ processed: 2 }));
    const progress = gateway.emitDuplicateResolution.mock.calls.filter(([, phase]) => phase === 'progress');
    expect(progress).toHaveLength(2);
    expect(progress[0]![2]).toEqual(expect.objectContaining({ jobId: 70, processed: 1, total: 2, currentGroupId: 5 }));
    expect(gateway.emitDuplicateResolution).toHaveBeenLastCalledWith(7, 'finished', expect.objectContaining({ status: 'completed', processed: 2 }));
  });

  it('refuses to start while another operation holds a library it would touch (H12)', async () => {
    const { service, repo, gate } = setup({ 5: isbn([10, 11]) });
    const release = gate.tryAcquire(1, 'scan');

    const error = await service
      .start({ scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'merge' }] }, both)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual(expect.objectContaining({ errorCode: 'LIBRARY_BUSY' }));
    expect(repo.create).not.toHaveBeenCalled();
    release?.();
  });

  it('refuses a second resolution while one is running for the user', async () => {
    const { service, repo } = setup({ 5: isbn([10, 11]) });
    repo.findRunningForUser.mockResolvedValue({ id: 66 });

    await expect(service.start({ scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'merge' }] }, both)).rejects.toThrow(ConflictException);
  });

  it('skips stale members and groups whose keeper is gone instead of acting blindly (H1)', async () => {
    const { service, repo, merges, live } = setup({ 5: isbn([10, 11, 12]), 6: isbn([20, 21]) });
    repo.create.mockImplementation(() => {
      live.delete(12);
      live.delete(20);
      return Promise.resolve({ id: 70 });
    });

    await service.start(
      {
        scanId: 2,
        groups: [
          { groupId: 5, keeperId: 10, action: 'merge' },
          { groupId: 6, keeperId: 20, action: 'merge' },
        ],
      },
      both,
    );
    const outcomes = await finished(repo);

    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        status: 'partial',
        books: [
          { bookId: 11, action: 'merge', status: 'merged', reason: null },
          { bookId: 12, action: 'merge', status: 'skipped', reason: 'STALE' },
        ],
      }),
    );
    expect(outcomes[1]).toEqual(expect.objectContaining({ status: 'skipped', reason: 'KEEPER_MISSING', books: [] }));
    expect(merges.mergeWithinLease).toHaveBeenCalledTimes(1);
    expect(merges.mergeWithinLease).toHaveBeenCalledWith(expect.objectContaining({ targetBookId: 10, sourceBookIds: [11] }), both, expect.anything());
  });

  it('resolves a book merged by an earlier group to its keeper (H7)', async () => {
    const { service, repo, merges } = setup({ 5: isbn([10, 11]), 6: isbn([11, 12]) });

    await service.start(
      {
        scanId: 2,
        groups: [
          { groupId: 5, keeperId: 10, action: 'merge' },
          { groupId: 6, keeperId: 11, action: 'merge' },
        ],
      },
      both,
    );
    const outcomes = await finished(repo);

    expect(merges.mergeWithinLease).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ targetBookId: 10, sourceBookIds: [12] }),
      both,
      expect.anything(),
    );
    expect(outcomes[1]).toEqual(expect.objectContaining({ keeperId: 10, status: 'done' }));
  });

  it('applies per-copy choices beside the group action', async () => {
    const { service, repo, merges, links, books, auditEvents } = setup({ 5: isbn([10, 11, 12, 13]) });

    await service.start(
      {
        scanId: 2,
        groups: [
          {
            groupId: 5,
            keeperId: 10,
            action: 'merge',
            perBook: [
              { bookId: 12, action: 'delete' },
              { bookId: 13, action: 'skip' },
            ],
          },
        ],
      },
      both,
    );
    const outcomes = await finished(repo);

    expect(merges.mergeWithinLease).toHaveBeenCalledWith(expect.objectContaining({ targetBookId: 10, sourceBookIds: [11] }), both, expect.anything());
    expect(books.deleteBooks).toHaveBeenCalledWith([12], both);
    expect(links.link).not.toHaveBeenCalled();
    expect(outcomes[0]!.books).toEqual([
      { bookId: 11, action: 'merge', status: 'merged', reason: null },
      { bookId: 12, action: 'delete', status: 'deleted', reason: null },
      { bookId: 13, action: 'skip', status: 'skipped', reason: 'NOT_SELECTED' },
    ]);
    expect(outcomes[0]!.status).toBe('partial');
    expect(auditEvents.emit).toHaveBeenCalledWith(
      'audit.log',
      expect.objectContaining({
        action: 'book.merge',
        meta: expect.objectContaining({ targetBookId: 10, sourceBookIds: [11], duplicateResolutionJobId: 70 }),
      }),
    );
    expect(auditEvents.emit).toHaveBeenCalledWith(
      'audit.log',
      expect.objectContaining({ action: 'book.bulk.delete', meta: expect.objectContaining({ total: 1 }) }),
    );
  });

  it('reports a merge the planner blocks as skipped with its blocker', async () => {
    const { service, repo, merges } = setup({ 5: isbn([10, 11]) });
    merges.mergeWithinLease.mockResolvedValue({
      jobId: null,
      status: 'blocked',
      blockers: [{ code: 'BOTH_HAVE_AUDIO' }],
      outcomes: [],
      errorCode: 'MERGE_BLOCKED',
    });

    await service.start({ scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'merge' }] }, both);
    const outcomes = await finished(repo);

    expect(outcomes[0]).toEqual(expect.objectContaining({ status: 'skipped', reason: 'BOTH_HAVE_AUDIO' }));
  });

  it('links a group through the link service and reports a full link group', async () => {
    const { service, repo, links } = setup({ 5: { kind: 'other_format', reasons: ['title_author'], members: [10, 11] }, 6: isbn([20, 21]) });
    links.link.mockResolvedValueOnce({ groupId: 40 }).mockRejectedValueOnce(new ConflictException({ message: 'full', errorCode: 'LINK_GROUP_FULL' }));

    await service.start(
      {
        scanId: 2,
        groups: [
          { groupId: 5, keeperId: 10, action: 'link' },
          { groupId: 6, keeperId: 20, action: 'link' },
        ],
      },
      mergeOnly,
    );
    const outcomes = await finished(repo);

    expect(links.link).toHaveBeenNthCalledWith(1, { bookIds: [10, 11] }, mergeOnly);
    expect(outcomes[0]).toEqual(expect.objectContaining({ status: 'done' }));
    expect(outcomes[1]).toEqual(expect.objectContaining({ status: 'failed', reason: 'LINK_GROUP_FULL' }));
  });

  describe('permissions (H11)', () => {
    it('lets a user with only the merge permission merge but not delete', async () => {
      const { service, repo } = setup({ 5: isbn([10, 11]) });

      await expect(service.start({ scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'delete' }] }, mergeOnly)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.start({ scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'merge', perBook: [{ bookId: 11, action: 'delete' }] }] }, mergeOnly),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.start({ scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'merge' }], removeIdenticalCopies: true }, mergeOnly),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();

      await expect(service.start({ scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'merge' }] }, mergeOnly)).resolves.toEqual({
        jobId: 70,
        total: 1,
      });
      await finished(repo);
    });

    it('lets a user with only the delete permission delete but not merge or link', async () => {
      const { service } = setup({ 5: isbn([10, 11]) });

      await expect(service.start({ scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'merge' }] }, deleteOnly)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.start({ scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'link' }] }, deleteOnly)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.start({ scanId: 2, allGroups: { keepRule: 'metadata', action: 'merge' } }, deleteOnly)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('never deletes a book of another format', async () => {
      const { service } = setup({ 5: { kind: 'other_format', reasons: ['same_work'], members: [10, 11] } });

      await expect(service.start({ scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'delete' }] }, both)).rejects.toThrow(BadRequestException);
      await expect(service.start({ scanId: 2, allGroups: { kind: 'other_format', keepRule: 'metadata', action: 'delete' } }, both)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  it('resolves every matching group across pages with the shared keeper rule (H8)', async () => {
    const { service, repo, duplicates, merges } = setup({
      5: isbn([10, 11]),
      6: { kind: 'duplicate', reasons: ['fuzzy_metadata'], members: [20, 21] },
      7: isbn([30, 31]),
    });
    repo.findResolvableGroups
      .mockResolvedValueOnce([
        { id: 6, kind: 'duplicate', reasons: ['fuzzy_metadata'] },
        { id: 7, kind: 'duplicate', reasons: ['isbn'] },
      ])
      .mockResolvedValueOnce([]);
    duplicates.findCandidates.mockResolvedValue(
      new Map([
        [6, [candidate(20), candidate(21, { metadataScore: 90 })]],
        [7, [candidate(30, { metadataScore: 10 }), candidate(31, { metadataScore: 80 })]],
      ]),
    );

    await service.start(
      { scanId: 2, groups: [{ groupId: 5, keeperId: 10, action: 'merge' }], allGroups: { keepRule: 'metadata', excludeGroupIds: [9] } },
      both,
    );
    const outcomes = await finished(repo);

    expect(repo.findResolvableGroups).toHaveBeenCalledWith(
      2,
      [1],
      both,
      expect.objectContaining({ kind: 'duplicate', excludeGroupIds: [5, 9], afterGroupId: 0 }),
      50,
    );
    expect(repo.findResolvableGroups).toHaveBeenCalledWith(2, [1], both, expect.objectContaining({ afterGroupId: 7 }), 50);
    // Group 6 has no default, so the run leaves it out instead of reporting it.
    expect(outcomes.map((outcome) => [outcome.groupId, outcome.keeperId, outcome.status, outcome.reason])).toEqual([
      [5, 10, 'done', null],
      [7, 31, 'done', null],
    ]);
    expect(merges.mergeWithinLease).toHaveBeenCalledWith(expect.objectContaining({ targetBookId: 31, sourceBookIds: [30] }), both, expect.anything());
  });

  it('keeps groups with nothing to do out of the room, so a full run still reaches later groups', async () => {
    const { service, repo, duplicates } = setup({});
    const fuzzy = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, kind: 'duplicate' as const, reasons: ['fuzzy_metadata' as const] }));
    repo.findResolvableGroups
      .mockResolvedValueOnce(fuzzy)
      .mockResolvedValueOnce([{ id: 60, kind: 'duplicate', reasons: ['isbn'] }])
      .mockResolvedValueOnce([]);
    duplicates.findCandidates.mockImplementation((ids: number[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, [candidate(id * 10), candidate(id * 10 + 1)]]))),
    );
    repo.findMemberIds.mockResolvedValue(new Map([[60, [600, 601]]]));

    await service.start({ scanId: 2, allGroups: { keepRule: 'metadata' } }, both);
    const outcomes = await finished(repo);

    expect(repo.findResolvableGroups).toHaveBeenCalledTimes(3);
    expect(outcomes.map((outcome) => outcome.groupId)).toEqual([60]);
  });

  it('leaves out a merge default for a group in a library the user cannot edit', async () => {
    const { service, repo, duplicates, libraries, merges } = setup({}, [20, 21]);
    repo.findResolvableGroups
      .mockResolvedValueOnce([
        { id: 5, kind: 'duplicate', reasons: ['isbn'] },
        { id: 6, kind: 'duplicate', reasons: ['isbn'] },
      ])
      .mockResolvedValueOnce([]);
    duplicates.findCandidates.mockResolvedValue(
      new Map([
        [5, [candidate(10, { libraryId: 2 }), candidate(11, { libraryId: 2 })]],
        [6, [candidate(20), candidate(21)]],
      ]),
    );
    repo.findMemberIds.mockResolvedValue(new Map([[6, [20, 21]]]));
    libraries.verifyAccessLevel.mockImplementation((_userId: number, libraryId: number) =>
      libraryId === 2 ? Promise.reject(new ForbiddenException('Insufficient library access level')) : Promise.resolve(),
    );

    await service.start({ scanId: 2, allGroups: { keepRule: 'metadata' } }, both);
    const outcomes = await finished(repo);

    expect(outcomes.map((outcome) => outcome.groupId)).toEqual([6]);
    expect(merges.mergeWithinLease).toHaveBeenCalledTimes(1);
    expect(libraries.verifyAccessLevel).toHaveBeenCalledTimes(2);
  });

  it('resolves fifty groups of mixed actions with one stale and one failing group', async () => {
    const groups: Record<number, GroupFixture> = {};
    const requests: { groupId: number; keeperId: number; action: 'merge' | 'delete' | 'link' }[] = [];
    const actions = ['merge', 'delete', 'link'] as const;
    for (let index = 0; index < 50; index++) {
      const groupId = 100 + index;
      const keeperId = 1000 + index * 2;
      groups[groupId] = isbn([keeperId, keeperId + 1]);
      requests.push({ groupId, keeperId, action: actions[index % 3]! });
    }
    const staleBook = 1000 + 10 * 2 + 1;
    const failingGroup = 100 + 4;
    const { service, repo, books, gateway, live } = setup(groups);
    repo.update.mockImplementation((_id: number, values: { currentGroupId?: number | null }) => {
      if (values.currentGroupId === 105) live.delete(staleBook);
      return Promise.resolve();
    });
    books.deleteBooks.mockImplementation((ids: number[]) => {
      if (ids.includes(1000 + 4 * 2 + 1)) return Promise.reject(new InternalServerErrorException('Could not delete all book files'));
      return Promise.resolve({ total: ids.length, books: [], omitted: 0 });
    });

    await service.start({ scanId: 2, groups: requests }, both);
    const outcomes = await finished(repo);

    expect(outcomes).toHaveLength(50);
    const byGroup = new Map(outcomes.map((outcome) => [outcome.groupId, outcome]));
    expect(byGroup.get(110)).toEqual(expect.objectContaining({ status: 'skipped', reason: 'STALE' }));
    expect(byGroup.get(failingGroup)).toEqual(expect.objectContaining({ status: 'failed', reason: 'DELETE_FAILED' }));
    const rest = outcomes.filter((outcome) => outcome.groupId !== 110 && outcome.groupId !== failingGroup);
    expect(rest.every((outcome) => outcome.status === 'done')).toBe(true);
    expect(rest.filter((outcome) => outcome.books[0]?.status === 'merged')).toHaveLength(17);
    expect(rest.filter((outcome) => outcome.books[0]?.status === 'deleted')).toHaveLength(15);
    expect(rest.filter((outcome) => outcome.books[0]?.status === 'linked')).toHaveLength(16);
    expect(repo.update).toHaveBeenCalledWith(70, expect.objectContaining({ processed: 25, outcomes: expect.any(Array) }));
    expect(repo.update).toHaveBeenCalledWith(70, expect.objectContaining({ status: 'completed', processed: 50 }));
    expect(gateway.emitDuplicateResolution.mock.calls.filter(([, phase]) => phase === 'progress')).toHaveLength(50);
  });

  it('skips a group the scan does not hold and one with nothing chosen', async () => {
    const { service, repo } = setup({ 5: isbn([10, 11]) });

    await service.start({ scanId: 2, groups: [{ groupId: 404, keeperId: 1, action: 'merge' }] }, both);
    const outcomes = await finished(repo);

    expect(outcomes).toEqual([{ groupId: 404, keeperId: 1, status: 'skipped', reason: 'STALE', books: [] }]);
  });

  it('requires at least one group', async () => {
    const { service } = setup({});

    await expect(service.start({ scanId: 2 }, both)).rejects.toThrow(BadRequestException);
  });

  it("hides another user's resolution", async () => {
    const { service, repo } = setup({});
    repo.find.mockResolvedValue({ id: 70, userId: 99 });

    await expect(service.getJob(70, both)).rejects.toThrow(NotFoundException);
  });

  it('marks resolutions cut short by a restart as failed', async () => {
    const { service, repo } = setup({});

    await service.onApplicationBootstrap();

    expect(repo.markInterruptedFailed).toHaveBeenCalled();
  });
});

describe('groupStatus', () => {
  it('summarizes copy outcomes', () => {
    expect(groupStatus([])).toEqual({ status: 'skipped', reason: 'ALREADY_RESOLVED' });
    expect(groupStatus([{ bookId: 1, action: 'merge', status: 'merged', reason: null }])).toEqual({ status: 'done', reason: null });
    expect(
      groupStatus([
        { bookId: 1, action: 'merge', status: 'merged', reason: null },
        { bookId: 2, action: 'merge', status: 'failed', reason: 'MERGE_FAILED' },
      ]),
    ).toEqual({ status: 'partial', reason: null });
    expect(
      groupStatus([
        { bookId: 1, action: 'merge', status: 'skipped', reason: 'STALE' },
        { bookId: 2, action: 'merge', status: 'failed', reason: 'MERGE_FAILED' },
      ]),
    ).toEqual({ status: 'failed', reason: null });
    expect(groupStatus([{ bookId: 1, action: 'delete', status: 'skipped', reason: 'STALE' }])).toEqual({ status: 'skipped', reason: 'STALE' });
  });
});
