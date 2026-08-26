import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { FULFILLABLE_BOOK_REQUEST_STATUSES, NotificationType, Permission, withRequiredPermissions } from '@bookorbit/types';

import { BookRequestAttributionService } from './book-request-attribution.service';
import { BookRequestNotifier } from './book-request-notifier.service';
import { BookRequestService } from './book-request.service';
import type { RequestUser } from '../../common/types/request-user';

/**
 * A moderator as the assignment path actually builds one: `manage_book_requests` resolves through
 * `PERMISSION_REQUIRES`, so the route guard these branches sit behind lets them through.
 */
function moderator(overrides: Partial<RequestUser> = {}): RequestUser {
  return user({ permissions: withRequiredPermissions([Permission.ManageBookRequests]), ...overrides });
}

function user(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [Permission.BookRequestAccess],
    contentFilters: {},
    ...overrides,
  } as RequestUser;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    userId: 1,
    mediaKind: 'ebook',
    status: 'pending',
    title: 'Dune',
    subtitle: null,
    authors: ['Frank Herbert'],
    seriesName: null,
    seriesIndex: null,
    isbn10: null,
    isbn13: null,
    publishedYear: null,
    language: null,
    coverUrl: null,
    providerKey: null,
    providerId: null,
    metadataSources: [],
    preferredFormats: [],
    note: null,
    targetLibraryId: null,
    targetFolderId: null,
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    matchedBookId: null,
    bookDockFileId: null,
    selfServe: false,
    fulfillerUserId: null,
    statusReason: null,
    dedupeKey: 'work:dune:frankherbert:ebook',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

function joined(overrides: Record<string, unknown> = {}) {
  return {
    request: row(overrides),
    requesterUsername: 'reader',
    requesterName: 'Reader',
    decidedByUsername: null,
    targetLibraryName: null,
  };
}

function makeService(
  overrides: {
    repo?: Record<string, unknown>;
    dedupe?: Record<string, unknown>;
    removal?: Record<string, unknown>;
    downloads?: Record<string, unknown>;
    automationSettings?: Record<string, unknown>;
    libraryService?: Record<string, unknown>;
    /** The user a delegated submission names, as `AuthService` would resolve them. */
    actingUser?: RequestUser | null;
  } = {},
) {
  const repo = {
    findById: vi.fn().mockResolvedValue(joined()),
    findAll: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    findRequesterOptions: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(row()),
    createWithinSelfServeCap: vi.fn().mockResolvedValue(row()),
    claimForSelfServe: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(row()),
    updateIf: vi.fn().mockImplementation((id: number, _expected: unknown, patch: Record<string, unknown>) => Promise.resolve(row({ id, ...patch }))),
    addSubscriber: vi.fn().mockResolvedValue(undefined),
    isSubscriber: vi.fn().mockResolvedValue(false),
    findSubscribers: vi.fn().mockResolvedValue(new Map()),
    findDismissedRequestIds: vi.fn().mockResolvedValue(new Set()),
    dismiss: vi.fn().mockResolvedValue(undefined),
    dismissIf: vi.fn().mockResolvedValue(true),
    restore: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(true),
    findInterestedUserIds: vi.fn().mockResolvedValue([1]),
    countLiveSelfServeForUser: vi.fn().mockResolvedValue(0),
    countByStatuses: vi.fn().mockResolvedValue(0),
    countForUser: vi.fn().mockResolvedValue(0),
    bookExists: vi.fn().mockResolvedValue(true),
    findBookLibraryId: vi.fn().mockResolvedValue(3),
    findLibraryNames: vi.fn().mockResolvedValue(new Map([[7, 'Audiobooks']])),
    bookDockFileExists: vi.fn().mockResolvedValue(true),
    folderBelongsToLibrary: vi.fn().mockResolvedValue(true),
    ...overrides.repo,
  };
  const dedupe = {
    findActiveRequestFor: vi.fn().mockResolvedValue(undefined),
    checkAvailability: vi.fn().mockResolvedValue([]),
    ...overrides.dedupe,
  };
  const libraryService = {
    verifyUserAccess: vi.fn().mockResolvedValue(undefined),
    findAccessibleLibraryIds: vi.fn().mockResolvedValue([1]),
    findUserIdsWithAccess: vi.fn().mockResolvedValue(new Set([1])),
    ...overrides.libraryService,
  };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const contentFilterRepo = {
    hasAnyContentFilters: vi.fn().mockResolvedValue(new Set<number>()),
    findExemptUserIds: vi.fn().mockResolvedValue(new Set<number>()),
  };
  const notifier = new BookRequestNotifier(notifications as never, repo as never, libraryService as never, contentFilterRepo as never);
  const downloads = {
    findLatestForRequests: vi.fn().mockResolvedValue(new Map()),
    failInFlightForRequest: vi.fn().mockResolvedValue(0),
    ...overrides.downloads,
  };

  const automation = { considerRequest: vi.fn() };
  // Nothing pinned for the instance, so the destination stays whatever the request itself names.
  const automationSettings = {
    resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: null, folderId: null }),
    ...overrides.automationSettings,
  };
  const removal = {
    removeLatestForRequest: vi.fn().mockResolvedValue({ removed: false, error: null }),
    ...overrides.removal,
  };
  // The summary caches on the broadcast count, so the stub has to move it the way the real one does.
  const gateway: { changeVersion: number; emitChanged: ReturnType<typeof vi.fn> } = {
    changeVersion: 0,
    emitChanged: vi.fn(() => {
      gateway.changeVersion++;
    }),
  };
  // The real one: delegation is a security rule, so a stub here would assert nothing.
  const auth = { findActingUser: vi.fn().mockResolvedValue(overrides.actingUser ?? null) };
  const attribution = new BookRequestAttributionService(auth as never);

  const service = new BookRequestService(
    repo as never,
    dedupe as never,
    libraryService as never,
    notifier,
    downloads as never,
    automation as never,
    automationSettings as never,
    removal as never,
    gateway as never,
    attribution,
  );

  return { service, repo, dedupe, libraryService, notifications, downloads, automation, automationSettings, removal, gateway, auth };
}

const dto = { title: 'Dune', mediaKind: 'ebook' as const, authors: ['Frank Herbert'] };

describe('BookRequestService.submit', () => {
  it('creates a pending request and notifies approvers', async () => {
    const { service, repo, notifications } = makeService();
    const result = await service.submit(dto, user());

    expect(result.subscribed).toBe(false);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', title: 'Dune', dedupeKey: 'work:dune:frankherbert:ebook' }),
      // Every key this work could have hashed to, so a later requester reaching it another way
      // collides with this row rather than opening a second one.
      expect.arrayContaining(['work:dune:frankherbert:ebook']),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.BookRequestSubmitted,
        actionUrl: '/requests?tab=all',
        scope: { kind: 'permission', permission: Permission.ManageBookRequests },
      }),
    );
  });

  it('rejects a blank title rather than storing one', async () => {
    const { service, repo } = makeService();
    await expect(service.submit({ ...dto, title: '   ' }, user())).rejects.toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('normalizes and persists every provider identifier behind a grouped result', async () => {
    const { service, repo, dedupe } = makeService();
    const metadataSources = [
      {
        providerKey: ' google ',
        providerId: ' volume-1 ',
        providerLabel: ' Google Books ',
        isbn10: ' 0441013597 ',
        isbn13: undefined,
      },
      {
        providerKey: 'amazon',
        providerId: 'edition-2',
        providerLabel: '   ',
        isbn10: undefined,
        isbn13: ' 9781250301697 ',
      },
      {
        providerKey: 'google',
        providerId: 'volume-1',
        providerLabel: 'Duplicate',
        isbn10: null,
        isbn13: null,
      },
    ];

    await service.submit({ ...dto, metadataSources } as never, user());

    const expected = [
      {
        providerKey: 'google',
        providerId: 'volume-1',
        providerLabel: 'Google Books',
        isbn10: '0441013597',
        isbn13: null,
      },
      {
        providerKey: 'amazon',
        providerId: 'edition-2',
        providerLabel: 'amazon',
        isbn10: null,
        isbn13: '9781250301697',
      },
    ];
    expect(dedupe.findActiveRequestFor).toHaveBeenCalledWith(expect.objectContaining({ metadataSources: expected }));
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ metadataSources: expected }), expect.any(Array));
  });

  it('attaches a second requester to the live request instead of creating a duplicate', async () => {
    const existing = row({ id: 7, userId: 2 });
    const { service, repo } = makeService({ dedupe: { findActiveRequestFor: vi.fn().mockResolvedValue(existing) } });
    repo.findById.mockResolvedValue(joined({ id: 7, userId: 2 }));

    const result = await service.submit(dto, user());

    expect(result.subscribed).toBe(true);
    expect(repo.addSubscriber).toHaveBeenCalledWith(7, 1);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('does not subscribe the owner to their own live request', async () => {
    const existing = row({ id: 7, userId: 1 });
    const { service, repo } = makeService({ dedupe: { findActiveRequestFor: vi.fn().mockResolvedValue(existing) } });
    repo.findById.mockResolvedValue(joined({ id: 7 }));

    await service.submit(dto, user());
    expect(repo.addSubscriber).not.toHaveBeenCalled();
  });

  it('folds a duplicate in rather than opening a second request', async () => {
    const { service, repo } = makeService({ dedupe: { findActiveRequestFor: vi.fn().mockResolvedValue(row({ id: 7, userId: 2 })) } });
    await service.submit(dto, user());
    expect(repo.create).not.toHaveBeenCalled();
  });

  /**
   * One live request per work, so a self-fulfiller's own row cannot be opened alongside somebody
   * else's. Subscribing them and stopping there is what the fold does for everybody else, and for
   * them it is a dead end: they asked to fetch the book and are handed a request every fulfilment
   * route then refuses them on.
   */
  describe('a self-fulfiller colliding with somebody else', () => {
    const fulfiller = () => user({ permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });

    function collidingWith(existing: Record<string, unknown>, repoOverrides: Record<string, unknown> = {}) {
      const harness = makeService({
        dedupe: { findActiveRequestFor: vi.fn().mockResolvedValue(row({ id: 7, userId: 2, targetLibraryId: 1, ...existing })) },
        repo: { claimForSelfServe: vi.fn().mockResolvedValue(row({ id: 7, userId: 2, selfServe: true, fulfillerUserId: 1 })), ...repoOverrides },
      });
      harness.repo.findById.mockResolvedValue(joined({ id: 7, userId: 2, selfServe: true, fulfillerUserId: 1 }));
      return harness;
    }

    it('takes on an undriven request so the caller can reach the picker', async () => {
      const { service, repo } = collidingWith({ status: 'pending' });

      const result = await service.submit({ ...dto, selfServe: true }, fulfiller());

      expect(repo.claimForSelfServe).toHaveBeenCalledWith(7, 1, ['pending', 'approved'], 10);
      expect(result.request.fulfillerUserId).toBe(1);
      expect(repo.createWithinSelfServeCap).not.toHaveBeenCalled();
    });

    /** They still asked for the book, so they still want telling when it lands. */
    it('subscribes them to the request they took on', async () => {
      const { service, repo } = collidingWith({ status: 'pending' });

      await service.submit({ ...dto, selfServe: true }, fulfiller());

      expect(repo.addSubscriber).toHaveBeenCalledWith(7, 1);
    });

    /** A request that was waiting on a decision has effectively had one, so its requester is told. */
    it('tells the person whose request it was that somebody is fetching it', async () => {
      const { service, notifications } = collidingWith({ status: 'pending' });

      await service.submit({ ...dto, selfServe: true }, fulfiller());

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.BookRequestApproved, message: expect.stringContaining('is fetching it') }),
      );
    });

    it('leaves a request somebody already grabbed a release for alone', async () => {
      const { service, repo, downloads } = collidingWith({ status: 'approved' });
      downloads.findLatestForRequests.mockResolvedValue(
        new Map([[7, { download: { id: 3, requestId: 7, createdAt: new Date('2026-08-01T00:00:00Z') } }]]),
      );

      await service.submit({ ...dto, selfServe: true }, fulfiller());

      expect(repo.claimForSelfServe).not.toHaveBeenCalled();
    });

    it('leaves a request another self-server is already driving alone', async () => {
      const { service, repo } = collidingWith({ status: 'approved', selfServe: true });

      await service.submit({ ...dto, selfServe: true }, fulfiller());

      expect(repo.claimForSelfServe).not.toHaveBeenCalled();
    });

    /**
     * The same rule a fresh self-serve submission is held to: nobody reviews where a self-server
     * files a book, so an unreachable destination would let them write into a library they cannot
     * even read.
     */
    it('leaves a request alone whose destination the caller cannot reach', async () => {
      const { service, repo, libraryService } = collidingWith({ status: 'pending', targetLibraryId: 9 });
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);

      await service.submit({ ...dto, selfServe: true }, fulfiller());

      expect(repo.claimForSelfServe).not.toHaveBeenCalled();
      expect(repo.addSubscriber).toHaveBeenCalledWith(7, 1);
    });

    /** Somebody deciding on it between the read and the write wins; they are subscribed instead. */
    it('subscribes them when the conditional claim finds it already moved on', async () => {
      const { service, repo } = collidingWith({ status: 'pending' }, { claimForSelfServe: vi.fn().mockResolvedValue(null) });

      const result = await service.submit({ ...dto, selfServe: true }, fulfiller());

      expect(result.subscribed).toBe(true);
      expect(repo.addSubscriber).toHaveBeenCalledWith(7, 1);
    });

    /** Pressing Download twice folds them into their own row, which was never a dead end. */
    it('does not take on a request that is already theirs', async () => {
      const { service, repo } = collidingWith({ status: 'pending', userId: 1 });

      await service.submit({ ...dto, selfServe: true }, fulfiller());

      expect(repo.claimForSelfServe).not.toHaveBeenCalled();
    });

    /** Nothing changes for two ordinary requesters: neither of them was going to drive it. */
    it('never takes one on for a requester who is not fulfilling it themselves', async () => {
      const { service, repo } = collidingWith({ status: 'pending' });

      const result = await service.submit(dto, user());

      expect(repo.claimForSelfServe).not.toHaveBeenCalled();
      expect(result.subscribed).toBe(true);
    });
  });

  it('auto-approves and skips the approver notification for an auto-approve user', async () => {
    const { service, repo, notifications, automation } = makeService();
    repo.create.mockResolvedValue(row({ status: 'approved' }));

    await service.submit({ ...dto, targetLibraryId: 5 }, user({ permissions: [Permission.BookRequestAccess, Permission.BookRequestAutoApprove] }));

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', decidedByUserId: 1 }), expect.any(Array));
    expect(notifications.notify).not.toHaveBeenCalled();
    // Skipping the notification here is only safe because automation knows nobody was told, and
    // announces the request itself if it ends up handing it back.
    expect(automation.considerRequest).toHaveBeenCalledWith(10, 'auto_approval');
  });

  it('refuses a self-serve request from somebody without the permission', async () => {
    const { service, repo } = makeService();

    await expect(service.submit({ ...dto, selfServe: true, targetLibraryId: 5 }, user())).rejects.toThrow(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates a self-serve request approved and does not let automation race the picker', async () => {
    const { service, repo, automation, notifications } = makeService();
    const fulfiller = user({ permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });

    await service.submit({ ...dto, selfServe: true, targetLibraryId: 5 }, fulfiller);

    expect(repo.createWithinSelfServeCap).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', selfServe: true, decidedByUserId: 1 }),
      expect.any(Array),
      10,
    );
    // The requester is on their way to the picker; an unattended grab would take a different release.
    expect(automation.considerRequest).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  /**
   * The instance default exists for requesters who cannot see where their book lands, because an
   * approver checks it for them. A self-server has no approver, so it has to be somewhere they can
   * actually reach or they would be writing into a library they cannot read.
   */
  it('refuses a self-serve request whose only destination is an instance default the caller cannot reach', async () => {
    const { service, repo, libraryService } = makeService({
      automationSettings: { resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: 9, folderId: null }) },
    });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([1, 2]);

    const fulfiller = user({ permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });
    await expect(service.submit({ ...dto, selfServe: true }, fulfiller)).rejects.toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('takes a self-serve request when the instance default is one the caller can reach', async () => {
    const { service, repo, libraryService } = makeService({
      automationSettings: { resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: 9, folderId: null }) },
    });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([9]);

    const fulfiller = user({ permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });
    await service.submit({ ...dto, selfServe: true }, fulfiller);

    expect(repo.createWithinSelfServeCap).toHaveBeenCalledWith(
      expect.objectContaining({ selfServe: true, targetLibraryId: 9 }),
      expect.any(Array),
      10,
    );
  });

  /**
   * A self-server joins no moderation queue, so what is bounded instead is tracker load. Counting
   * and then inserting is not a cap - two submissions each see nine and both proceed - so the
   * count lives inside the insert's own transaction and the refusal comes back from it.
   */
  it('refuses a self-serve request once too many are already in flight', async () => {
    const { service, repo } = makeService({ repo: { createWithinSelfServeCap: vi.fn().mockResolvedValue(null) } });
    const fulfiller = user({ permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });

    await expect(service.submit({ ...dto, selfServe: true, targetLibraryId: 5 }, fulfiller)).rejects.toThrow(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  /** An ordinary request is not self-serve work, so it never goes near the cap. */
  it('inserts an ordinary request without the self-serve cap', async () => {
    const { service, repo } = makeService();

    await service.submit(dto, user());

    expect(repo.create).toHaveBeenCalled();
    expect(repo.createWithinSelfServeCap).not.toHaveBeenCalled();
  });

  it('refuses an auto-approved request with no destination library', async () => {
    const { service, repo } = makeService();
    const autoApprover = user({ permissions: [Permission.BookRequestAccess, Permission.BookRequestAutoApprove] });

    await expect(service.submit(dto, autoApprover)).rejects.toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('still takes a request with no destination library from someone whose requests get approved', async () => {
    const { service, repo } = makeService();
    await service.submit(dto, user());
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', targetLibraryId: null }), expect.any(Array));
  });

  /**
   * The whole point of the instance default: a request that names nowhere still gets a
   * destination, which is what approval and unattended grabbing both refuse to proceed without.
   */
  it('falls back to the instance default for the requested medium', async () => {
    const { service, repo, automationSettings } = makeService({
      automationSettings: { resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: 7, folderId: 21 }) },
    });

    await service.submit(dto, user());

    expect(automationSettings.resolveDestinationFor).toHaveBeenCalledWith('ebook');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ targetLibraryId: 7, targetFolderId: 21 }), expect.any(Array));
  });

  it('keeps the requester own library over the instance default', async () => {
    const { service, repo, automationSettings } = makeService({
      automationSettings: { resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: 7, folderId: 21 }) },
    });

    await service.submit({ ...dto, targetLibraryId: 5 }, user());

    expect(automationSettings.resolveDestinationFor).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ targetLibraryId: 5 }), expect.any(Array));
  });

  /**
   * The operator picked the default for the whole instance, so it is not filtered by what this
   * requester happens to be able to browse. Checking it would put the request back to having no
   * destination for exactly the users the default is there to serve.
   */
  it('does not check the requester access against the instance default', async () => {
    const { service, repo, libraryService } = makeService({
      automationSettings: { resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: 7, folderId: 21 }) },
    });

    await service.submit(dto, user());

    expect(libraryService.verifyUserAccess).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ targetLibraryId: 7 }), expect.any(Array));
  });

  it('refuses a destination folder that is not in the destination library', async () => {
    const { service, repo } = makeService({ repo: { folderBelongsToLibrary: vi.fn().mockResolvedValue(false) } });

    await expect(service.submit({ ...dto, targetLibraryId: 5, targetFolderId: 8 }, user())).rejects.toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a target library the requester cannot reach', async () => {
    const { service, repo, libraryService } = makeService();
    libraryService.verifyUserAccess.mockRejectedValue(new ForbiddenException('No access to this library'));

    await expect(service.submit({ ...dto, targetLibraryId: 9 }, user())).rejects.toThrow(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('attaches the loser of an insert race to the winning request instead of failing', async () => {
    const winner = row({ id: 7, userId: 2 });
    const { service, repo, dedupe } = makeService({
      dedupe: { findActiveRequestFor: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(winner) },
    });
    repo.create.mockRejectedValue(
      new Error('Failed query', { cause: Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }) }),
    );
    repo.findById.mockResolvedValue(joined({ id: 7, userId: 2 }));

    const result = await service.submit(dto, user());

    expect(result.subscribed).toBe(true);
    expect(repo.addSubscriber).toHaveBeenCalledWith(7, 1);
    expect(dedupe.findActiveRequestFor).toHaveBeenCalledTimes(2);
  });

  /** The claim the winner held is free again the moment it settles, so the insert that lost works. */
  it('retries the insert once when the request that won the race has already gone', async () => {
    const { service, repo, dedupe } = makeService();
    repo.create
      .mockRejectedValueOnce(new Error('Failed query', { cause: Object.assign(new Error('duplicate key'), { code: '23505' }) }))
      .mockResolvedValue(row());

    const result = await service.submit(dto, user());

    expect(result.subscribed).toBe(false);
    expect(repo.create).toHaveBeenCalledTimes(2);
    expect(dedupe.findActiveRequestFor).toHaveBeenCalledTimes(2);
  });

  it('retries the insert when the winner is deleted between finding it and reading it back', async () => {
    const winner = row({ id: 7, userId: 2 });
    const { service, repo } = makeService({
      dedupe: { findActiveRequestFor: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(winner) },
    });
    repo.create
      .mockRejectedValueOnce(new Error('Failed query', { cause: Object.assign(new Error('duplicate key'), { code: '23505' }) }))
      .mockResolvedValue(row());
    repo.findById.mockResolvedValueOnce(undefined).mockResolvedValue(joined());

    const result = await service.submit(dto, user());

    expect(result.subscribed).toBe(false);
    expect(repo.create).toHaveBeenCalledTimes(2);
  });

  it('joins the winner when the retry loses to a second concurrent insert', async () => {
    const winner = row({ id: 7, userId: 2 });
    const violation = new Error('Failed query', { cause: Object.assign(new Error('duplicate key'), { code: '23505' }) });
    const { service, repo, dedupe } = makeService({
      dedupe: { findActiveRequestFor: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValue(winner) },
    });
    repo.create.mockRejectedValue(violation);
    repo.findById.mockResolvedValue(joined({ id: 7, userId: 2 }));

    const result = await service.submit(dto, user());

    expect(result.subscribed).toBe(true);
    expect(repo.create).toHaveBeenCalledTimes(2);
    expect(dedupe.findActiveRequestFor).toHaveBeenCalledTimes(3);
  });

  it('rethrows a unique violation that no live request explains', async () => {
    const { service, repo } = makeService();
    const violation = new Error('Failed query', { cause: Object.assign(new Error('duplicate key'), { code: '23505' }) });
    repo.create.mockRejectedValue(violation);

    await expect(service.submit(dto, user())).rejects.toBe(violation);
  });

  it('rethrows any other database failure untouched', async () => {
    const { service, repo } = makeService();
    repo.create.mockRejectedValue(Object.assign(new Error('connection terminated'), { code: '57P01' }));

    await expect(service.submit(dto, user())).rejects.toThrow('connection terminated');
  });
});

/**
 * Filing a request for somebody else, which is what a front end that its own users sign into needs
 * in order to say who actually asked.
 *
 * Every test here is the same question asked once per decision the submission makes: does this
 * branch ask about the requester, or about whoever holds the token? The answer must always be the
 * requester, or naming somebody quietly hands them the integration's privileges.
 */
describe('BookRequestService.submit on behalf of another user', () => {
  const bob = () => user({ id: 42, username: 'bob', name: 'Bob' });

  it('records the named user as the requester and the caller as who filed it', async () => {
    const { service, repo } = makeService({ actingUser: bob() });

    await service.submit({ ...dto, userId: 42 }, moderator());

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, createdByUserId: 1 }), expect.anything());
  });

  it('leaves an ordinary request recorded as nobody else having filed it', async () => {
    const { service, repo, auth } = makeService();

    await service.submit(dto, user());

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, createdByUserId: null }), expect.anything());
    expect(auth.findActingUser).not.toHaveBeenCalled();
  });

  it('treats a caller naming their own id as an ordinary request, with no permission needed', async () => {
    const { service, repo, auth } = makeService();

    await service.submit({ ...dto, userId: 1 }, user());

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, createdByUserId: null }), expect.anything());
    expect(auth.findActingUser).not.toHaveBeenCalled();
  });

  it('refuses a caller who cannot manage requests, before looking the requester up', async () => {
    const { service, repo, auth } = makeService({ actingUser: bob() });

    await expect(service.submit({ ...dto, userId: 42 }, user())).rejects.toThrow(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(auth.findActingUser).not.toHaveBeenCalled();
  });

  /**
   * The regression that matters most. A fall back to the caller here would read as defensive and
   * would silently reinstate the mis-attribution the whole feature exists to end.
   */
  it('refuses a requester who cannot be resolved rather than filing under the caller', async () => {
    const { service, repo } = makeService({ actingUser: null });

    await expect(service.submit({ ...dto, userId: 999 }, moderator())).rejects.toThrow(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('holds the request for a decision when the requester cannot auto-approve, though the caller can', async () => {
    const { service, repo, automation } = makeService({ actingUser: bob() });
    const caller = moderator({ permissions: withRequiredPermissions([Permission.ManageBookRequests, Permission.BookRequestAutoApprove]) });

    await service.submit({ ...dto, userId: 42 }, caller);

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', decidedByUserId: null }), expect.anything());
    expect(automation.considerRequest).not.toHaveBeenCalled();
  });

  it('auto-approves when the requester can, though the caller cannot', async () => {
    const autoApprover = user({ id: 42, name: 'Bob', permissions: [Permission.BookRequestAccess, Permission.BookRequestAutoApprove] });
    const { service, repo, automation } = makeService({ actingUser: autoApprover });

    await service.submit({ ...dto, userId: 42, targetLibraryId: 5 }, moderator());

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', decidedByUserId: 42 }), expect.anything());
    expect(automation.considerRequest).toHaveBeenCalled();
  });

  it('refuses self-fulfilment the requester does not hold, though the caller holds it', async () => {
    const { service, repo } = makeService({ actingUser: bob() });
    const caller = moderator({ permissions: withRequiredPermissions([Permission.ManageBookRequests, Permission.BookRequestSelfFulfill]) });

    await expect(service.submit({ ...dto, userId: 42, selfServe: true, targetLibraryId: 5 }, caller)).rejects.toThrow(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.createWithinSelfServeCap).not.toHaveBeenCalled();
  });

  it('resolves the destination against the requester libraries, not the caller libraries', async () => {
    const { service, libraryService } = makeService({ actingUser: bob() });

    await service.submit({ ...dto, userId: 42, targetLibraryId: 5 }, moderator());

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(42, 5, false);
  });

  /**
   * The cap is enforced inside the insert, keyed on the row it is inserting. Filing under the
   * caller instead would hand every proxied user a fresh allowance of downloads in flight.
   */
  it('counts the downloads-in-flight cap against the requester', async () => {
    const selfFulfiller = user({ id: 42, name: 'Bob', permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });
    const { service, repo } = makeService({ actingUser: selfFulfiller });

    await service.submit({ ...dto, userId: 42, selfServe: true, targetLibraryId: 5 }, moderator());

    expect(repo.createWithinSelfServeCap).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, selfServe: true }),
      expect.anything(),
      expect.any(Number),
    );
  });

  /**
   * The branch a happy-path test never reaches: a proxied request for a book somebody already
   * asked for folds into the existing row, and the person subscribed to it has to be the requester
   * or they never hear that their book arrived.
   */
  it('subscribes the requester when the work was already requested', async () => {
    const { service, repo } = makeService({
      actingUser: bob(),
      dedupe: { findActiveRequestFor: vi.fn().mockResolvedValue(row({ id: 7, userId: 2 })) },
    });
    repo.findById.mockResolvedValue(joined({ id: 7, userId: 2 }));

    const result = await service.submit({ ...dto, userId: 42 }, moderator());

    expect(result.subscribed).toBe(true);
    expect(repo.addSubscriber).toHaveBeenCalledWith(7, 42);
  });

  it('names the requester to the approvers, not the account that called', async () => {
    const { service, notifications } = makeService({ actingUser: bob() });

    await service.submit({ ...dto, userId: 42 }, moderator({ name: 'Bookbot' }));

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.BookRequestSubmitted, message: expect.stringContaining('Bob') }),
    );
    expect(notifications.notify).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Bookbot') }));
  });

  it('lets a superuser file for somebody else', async () => {
    const { service, repo } = makeService({ actingUser: bob() });

    await service.submit({ ...dto, userId: 42 }, user({ id: 3, isSuperuser: true }));

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, createdByUserId: 3 }), expect.anything());
  });
});

describe('BookRequestService.submit language', () => {
  it.each([
    ['spa', 'es'],
    ['English', 'en'],
    ['pt-BR', 'pt'],
  ])('stores a provider language of %s as %s', async (given, stored) => {
    const { service, repo } = makeService();
    await service.submit({ title: 'Dune', mediaKind: 'ebook', language: given } as never, user());
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ language: stored }), expect.any(Array));
  });

  /**
   * The offered list is curated; what a provider already stated is not. Narrowing a request down to
   * only the offered codes would turn a language the matcher handled perfectly well into no filter
   * at all, so a code outside that list still has to survive being stored.
   */
  it('keeps a provider language the dropdown does not happen to offer', async () => {
    const { service, repo } = makeService();
    await service.submit({ title: 'Dune', mediaKind: 'ebook', language: 'ne' } as never, user());
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ language: 'ne' }), expect.any(Array));
  });

  it('stores nothing rather than a filter nothing satisfies', async () => {
    const { service, repo } = makeService();
    await service.submit({ title: 'Dune', mediaKind: 'ebook', language: '' } as never, user());
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ language: null }), expect.any(Array));
  });
});

/**
 * `cancel` and `setLanguage` live on the requester controller, whose class guard answers to
 * `BookRequestAccess`. Their moderator branches are only reachable if a `manage_book_requests`
 * grant carries that access with it, which is what makes them worth testing at all.
 */
describe('the moderator role a manage grant produces', () => {
  it('carries the access the guard in front of cancel and language asks for', () => {
    expect(moderator().permissions).toContain(Permission.BookRequestAccess);
  });
});

describe('BookRequestService.cancel', () => {
  it('lets the owner cancel a pending request', async () => {
    const { service, repo } = makeService();
    await service.cancel(10, user());
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ status: 'cancelled' }));
  });

  it('refuses a stranger', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ userId: 2 })) } });
    await expect(service.cancel(10, user())).rejects.toThrow(ForbiddenException);
  });

  it('lets an approver cancel someone else request', async () => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ userId: 2 })) } });
    await service.cancel(10, moderator());
    expect(repo.updateIf).toHaveBeenCalled();
  });

  it('refuses to cancel a request that already landed', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'available' })) } });
    await expect(service.cancel(10, user())).rejects.toThrow(BadRequestException);
  });

  it('reports a missing request as not found', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(undefined) } });
    await expect(service.cancel(10, user())).rejects.toThrow(NotFoundException);
  });

  /** The whole point of widening this: a request that stalled mid-pipeline had no exit at all. */
  it.each(['searching', 'grabbed', 'downloading', 'importing', 'needs_review', 'failed'])('stops a request that is %s', async (status) => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status })) } });
    await service.cancel(10, user());
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ status: 'cancelled' }));
  });

  it.each(['rejected', 'cancelled'])('refuses to cancel a request that already settled as %s', async (status) => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status })) } });
    await expect(service.cancel(10, user())).rejects.toThrow(BadRequestException);
  });

  it('stops the torrent too, keeping the files the library may already be hardlinked to', async () => {
    const { service, removal } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'downloading' })) } });

    await service.cancel(10, user());

    expect(removal.removeLatestForRequest).toHaveBeenCalledWith(10, false, 'reader');
  });

  /** A download client that is down must not be the reason a stuck request stays stuck. */
  it('cancels anyway when the download client will not let go, and says so on the row', async () => {
    const { service, repo } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'downloading' })) },
      removal: { removeLatestForRequest: vi.fn().mockResolvedValue({ removed: false, error: 'connection refused' }) },
    });

    await service.cancel(10, user());

    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ status: 'cancelled' }));
    expect(repo.updateIf).toHaveBeenCalledWith(10, ['cancelled'], { statusReason: expect.stringContaining('connection refused') });
  });

  /** The seed of a request that finished mid-click is not the cancellation's to take. */
  it('leaves the download alone when the request settled before the cancellation landed', async () => {
    const { service, removal } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(joined({ status: 'downloading' }))
          .mockResolvedValue(joined({ status: 'available' })),
        updateIf: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(service.cancel(10, user())).rejects.toThrow('A request that is available can no longer be cancelled');
    expect(removal.removeLatestForRequest).not.toHaveBeenCalled();
  });

  it('clears a stale failure reason when the stop went cleanly', async () => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'failed', statusReason: 'no seeds' })) } });

    await service.cancel(10, user());

    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ statusReason: null }));
  });
});

describe('BookRequestService.setLanguage', () => {
  it('lets the owner change what language the request asks for', async () => {
    const { service, repo } = makeService();
    await service.setLanguage(10, 'en', user());
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), { language: 'en' });
  });

  /**
   * The reason this exists. A provider states "spa" where a request compares "es", so storing it
   * as given would hard-filter out every Spanish release for a request asking for Spanish.
   */
  it.each([
    ['spa', 'es'],
    ['English', 'en'],
    ['EN', 'en'],
    ['fre', 'fr'],
    ['en-GB', 'en'],
  ])('normalises %s to %s', async (given, stored) => {
    const { service, repo } = makeService();
    await service.setLanguage(10, given, user());
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), { language: stored });
  });

  it('clears the language so any edition matches again', async () => {
    const { service, repo } = makeService();
    await service.setLanguage(10, null, user());
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), { language: null });
  });

  it('refuses a language nothing could ever be matched against', async () => {
    const { service } = makeService();
    await expect(service.setLanguage(10, 'klingon', user())).rejects.toThrow(BadRequestException);
  });

  it('refuses a stranger', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ userId: 2 })) } });
    await expect(service.setLanguage(10, 'en', user())).rejects.toThrow(ForbiddenException);
  });

  it('lets an approver correct someone else request', async () => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ userId: 2 })) } });
    await service.setLanguage(10, 'en', moderator());
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), { language: 'en' });
  });

  it('refuses once the book has been filed', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'available' })) } });
    await expect(service.setLanguage(10, 'en', user())).rejects.toThrow(BadRequestException);
  });

  /** A failed request re-searched in the right language is the case worth having this for. */
  it.each(['pending', 'approved', 'searching', 'failed', 'needs_review'])('can still be changed while %s', async (status) => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status })) } });
    await service.setLanguage(10, 'en', user());
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), { language: 'en' });
  });

  it('reports a missing request as not found', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(undefined) } });
    await expect(service.setLanguage(10, 'en', user())).rejects.toThrow(NotFoundException);
  });
});

describe('BookRequestService.dismiss', () => {
  it.each(['rejected', 'cancelled', 'available', 'failed'])('hides a %s request from the caller only', async (status) => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status })) } });

    await service.dismiss(10, user());

    expect(repo.dismissIf).toHaveBeenCalledWith(10, 1, expect.arrayContaining([status]));
    expect(repo.updateIf).not.toHaveBeenCalled();
  });

  it('refuses to sweep away work that is still running', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'downloading' })) } });
    await expect(service.dismiss(10, user())).rejects.toThrow(BadRequestException);
  });

  it('refuses someone with no business seeing the request', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ userId: 2, status: 'available' })) } });
    await expect(service.dismiss(10, user())).rejects.toThrow(ForbiddenException);
  });

  it('brings a hidden request back', async () => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'available' })) } });

    await service.restore(10, user());

    expect(repo.restore).toHaveBeenCalledWith(10, 1);
  });
});

describe('BookRequestService.remove', () => {
  const approver = user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] });

  it.each(['rejected', 'cancelled', 'available', 'failed'])('deletes a %s request', async (status) => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status })) } });

    await service.remove(10, approver);

    expect(repo.remove).toHaveBeenCalledWith(10, expect.arrayContaining([status]));
  });

  it('refuses a requester who is not a moderator', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'available' })) } });
    await expect(service.remove(10, user())).rejects.toThrow(ForbiddenException);
  });

  it('refuses a request that is still being worked on', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'downloading' })) } });
    await expect(service.remove(10, approver)).rejects.toThrow(BadRequestException);
  });

  /** The download row cascades away with the request, so the torrent must go first or not at all. */
  it('takes the seeding torrent out of the client before deleting the row', async () => {
    const { service, repo, removal } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'available' })) } });

    await service.remove(10, approver);

    expect(removal.removeLatestForRequest).toHaveBeenCalledWith(10, false, 'reader');
    expect(repo.remove).toHaveBeenCalled();
  });

  it('keeps the row when the torrent could not be removed, rather than orphaning it', async () => {
    const { service, repo } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'available' })) },
      removal: { removeLatestForRequest: vi.fn().mockResolvedValue({ removed: false, error: 'connection refused' }) },
    });

    await expect(service.remove(10, approver)).rejects.toThrow(BadRequestException);
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('reserves a failed request before detaching so a concurrent retry cannot be stopped', async () => {
    const order: string[] = [];
    const { service, repo, removal } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(joined({ status: 'failed' })),
        updateIf: vi.fn().mockImplementation(() => {
          order.push('reserve');
          return Promise.resolve(row({ status: 'cancelled' }));
        }),
      },
      removal: {
        removeLatestForRequest: vi.fn().mockImplementation(() => {
          order.push('detach');
          return Promise.resolve({ removed: true, error: null });
        }),
      },
    });

    await service.remove(10, approver);

    expect(order).toEqual(['reserve', 'detach']);
    expect(repo.updateIf).toHaveBeenCalledWith(10, ['failed'], { status: 'cancelled' });
    expect(removal.removeLatestForRequest).toHaveBeenCalled();
  });

  it('releases the failed-request reservation when the client refuses removal', async () => {
    const { service, repo } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'failed' })) },
      removal: { removeLatestForRequest: vi.fn().mockResolvedValue({ removed: false, error: 'connection refused' }) },
    });

    await expect(service.remove(10, approver)).rejects.toThrow(BadRequestException);

    expect(repo.updateIf).toHaveBeenNthCalledWith(1, 10, ['failed'], { status: 'cancelled' });
    expect(repo.updateIf).toHaveBeenNthCalledWith(2, 10, ['cancelled'], { status: 'failed' });
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('reports a missing request as not found', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(undefined) } });
    await expect(service.remove(10, approver)).rejects.toThrow(NotFoundException);
  });
});

describe('BookRequestService.approve', () => {
  const approver = user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] });

  it('approves a pending request and notifies everyone attached', async () => {
    const { service, repo, notifications } = makeService({ repo: { findInterestedUserIds: vi.fn().mockResolvedValue([1, 2]) } });
    await service.approve(10, { targetLibraryId: 5 }, approver);

    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ status: 'approved', decidedByUserId: 1 }));
    const approvals = notifications.notify.mock.calls.filter(([p]) => p.type === NotificationType.BookRequestApproved);
    expect(approvals.map(([p]) => p.scope)).toEqual([
      { kind: 'user', userId: 1 },
      { kind: 'user', userId: 2 },
    ]);
  });

  it('refuses to approve anything that is not pending', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'approved' })) } });
    await expect(service.approve(10, {}, approver)).rejects.toThrow(BadRequestException);
  });

  it('lets the approver reroute to a library they can reach', async () => {
    const { service, repo } = makeService();
    await service.approve(10, { targetLibraryId: 5 }, approver);
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ targetLibraryId: 5 }));
  });

  it('refuses a reroute to a library the approver cannot reach', async () => {
    const { service, repo, libraryService } = makeService();
    libraryService.verifyUserAccess.mockRejectedValue(new ForbiddenException('No access to this library'));
    await expect(service.approve(10, { targetLibraryId: 5 }, approver)).rejects.toThrow(ForbiddenException);
    expect(repo.updateIf).not.toHaveBeenCalled();
  });

  it('keeps the requester chosen library when the approver does not reroute', async () => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ targetLibraryId: 3 })) } });
    await service.approve(10, {}, approver);
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ targetLibraryId: 3 }));
  });

  it('refuses a folder that belongs to a different library', async () => {
    const { service, repo } = makeService({ repo: { folderBelongsToLibrary: vi.fn().mockResolvedValue(false) } });
    await expect(service.approve(10, { targetLibraryId: 5, targetFolderId: 8 }, approver)).rejects.toThrow(BadRequestException);
    expect(repo.updateIf).not.toHaveBeenCalled();
  });

  it('refuses to approve a request with nowhere to file the book', async () => {
    const { service, repo } = makeService();
    await expect(service.approve(10, {}, approver)).rejects.toThrow(BadRequestException);
    await expect(service.approve(10, { targetFolderId: 8 }, approver)).rejects.toThrow(BadRequestException);
    expect(repo.updateIf).not.toHaveBeenCalled();
  });

  /** Requests made before a default was set carry none, and the approver should not retype one. */
  it('falls back to the instance default for a request that names nowhere', async () => {
    const { service, repo, automationSettings } = makeService({
      automationSettings: { resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: 7, folderId: 21 }) },
    });

    await service.approve(10, {}, approver);

    expect(automationSettings.resolveDestinationFor).toHaveBeenCalledWith('ebook');
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ targetLibraryId: 7, targetFolderId: 21 }));
  });

  it('keeps what the approver picked over the instance default', async () => {
    const { service, repo, automationSettings } = makeService({
      automationSettings: { resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: 7, folderId: 21 }) },
    });

    await service.approve(10, { targetLibraryId: 5 }, approver);

    expect(automationSettings.resolveDestinationFor).not.toHaveBeenCalled();
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ targetLibraryId: 5 }));
  });

  it('refuses a folder that does not belong to the library the approver rerouted to', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi.fn().mockResolvedValue(joined({ targetLibraryId: 3, targetFolderId: 8 })),
        folderBelongsToLibrary: vi.fn().mockResolvedValue(false),
      },
    });
    await expect(service.approve(10, { targetLibraryId: 5 }, approver)).rejects.toThrow(BadRequestException);
    expect(repo.updateIf).not.toHaveBeenCalled();
  });

  it('keeps a folder that does belong to the destination library', async () => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ targetLibraryId: 3, targetFolderId: 8 })) } });
    await service.approve(10, {}, approver);
    expect(repo.folderBelongsToLibrary).toHaveBeenCalledWith(8, 3);
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ targetFolderId: 8 }));
  });
});

describe('BookRequestService.reject', () => {
  const approver = user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] });

  it('rejects a pending request and carries the reason into the notification', async () => {
    const { service, repo, notifications } = makeService();
    await service.reject(10, { decisionNote: 'Already on order' }, approver);

    expect(repo.updateIf).toHaveBeenCalledWith(
      10,
      expect.anything(),
      expect.objectContaining({ status: 'rejected', decisionNote: 'Already on order' }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.BookRequestRejected, message: expect.stringContaining('Already on order') }),
    );
  });

  it('refuses to reject anything that is not pending', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'cancelled' })) } });
    await expect(service.reject(10, {}, approver)).rejects.toThrow(BadRequestException);
  });
});

/**
 * Every refusal `submit` raises is a sentence this application wrote about a rule this instance
 * applies, which makes it copy a translator has to be able to reach. Without a code the form can
 * only repeat the English, and repeating the English in a toast is what these assert against.
 */
describe('BookRequestService.submit refusal codes', () => {
  async function refusal(run: Promise<unknown>): Promise<{ errorCode?: string; errorMeta?: Record<string, unknown> }> {
    await expect(run).rejects.toThrow(HttpException);
    return run.then(
      () => ({}),
      (error: HttpException) => error.getResponse() as { errorCode?: string; errorMeta?: Record<string, unknown> },
    );
  }

  const selfFulfiller = user({ permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });

  it('codes a blank title', async () => {
    const { service } = makeService();
    const body = await refusal(service.submit({ ...dto, title: '   ' }, user()));
    expect(body.errorCode).toBe('SUBMIT_TITLE_REQUIRED');
  });

  it('codes self-fulfilment asked for without the permission', async () => {
    const { service } = makeService();
    const body = await refusal(service.submit({ ...dto, selfServe: true }, user()));
    expect(body.errorCode).toBe('SUBMIT_SELF_FULFIL_FORBIDDEN');
  });

  it('codes a requester named by a caller who may not name one', async () => {
    const { service } = makeService({ actingUser: user({ id: 42 }) });
    const body = await refusal(service.submit({ ...dto, userId: 42 }, user()));
    expect(body.errorCode).toBe('SUBMIT_ON_BEHALF_FORBIDDEN');
  });

  it('codes a requester that cannot be resolved', async () => {
    const { service } = makeService({ actingUser: null });
    const body = await refusal(service.submit({ ...dto, userId: 999 }, moderator()));
    expect(body.errorCode).toBe('SUBMIT_ON_BEHALF_UNKNOWN_USER');
  });

  it('codes a destination library the caller cannot reach', async () => {
    const { service, libraryService } = makeService();
    libraryService.verifyUserAccess.mockRejectedValue(new ForbiddenException('No access to this library'));

    const body = await refusal(service.submit({ ...dto, targetLibraryId: 9 }, user()));
    expect(body.errorCode).toBe('SUBMIT_LIBRARY_FORBIDDEN');
  });

  it('codes a folder named with no library to sit in', async () => {
    const { service } = makeService();
    const body = await refusal(service.submit({ ...dto, targetFolderId: 4 }, user()));
    expect(body.errorCode).toBe('SUBMIT_FOLDER_NEEDS_LIBRARY');
  });

  it('codes a folder belonging to some other library', async () => {
    const { service } = makeService({ repo: { folderBelongsToLibrary: vi.fn().mockResolvedValue(false) } });
    const body = await refusal(service.submit({ ...dto, targetLibraryId: 5, targetFolderId: 4 }, user()));
    expect(body.errorCode).toBe('SUBMIT_FOLDER_NOT_IN_LIBRARY');
  });

  it('codes an instance default a self-server cannot reach', async () => {
    const { service, libraryService } = makeService({
      automationSettings: { resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: 9, folderId: null }) },
    });
    libraryService.findAccessibleLibraryIds.mockResolvedValue([1, 2]);

    const body = await refusal(service.submit({ ...dto, selfServe: true }, selfFulfiller));
    expect(body.errorCode).toBe('SUBMIT_DEFAULT_LIBRARY_UNREACHABLE');
  });

  it('codes a settled-on-create request with nowhere to file', async () => {
    const { service } = makeService();
    const autoApprover = user({ permissions: [Permission.BookRequestAccess, Permission.BookRequestAutoApprove] });

    const body = await refusal(service.submit(dto, autoApprover));
    expect(body.errorCode).toBe('SUBMIT_DESTINATION_REQUIRED');
  });

  /** The number is a message parameter rather than part of the code, so a translator can place it. */
  it('codes a full self-serve cap and carries the limit', async () => {
    const { service } = makeService({ repo: { createWithinSelfServeCap: vi.fn().mockResolvedValue(null) } });

    const body = await refusal(service.submit({ ...dto, selfServe: true, targetLibraryId: 5 }, selfFulfiller));
    expect(body.errorCode).toBe('SUBMIT_SELF_SERVE_LIMIT');
    expect(body.errorMeta).toEqual({ limit: 10 });
  });
});

describe('BookRequestService.markFulfilled', () => {
  const approver = user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] });

  it.each(FULFILLABLE_BOOK_REQUEST_STATUSES)('allows an approver to close a %s request', async (status) => {
    const { service, repo } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status })) } });

    await service.markFulfilled(10, { matchedBookId: 42 }, approver);

    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ status: 'available', matchedBookId: 42 }));
  });

  it('closes the request against a book and tells everyone attached', async () => {
    const { service, repo, notifications } = makeService();
    await service.markFulfilled(10, { matchedBookId: 42 }, approver);

    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ status: 'available', matchedBookId: 42 }));
    expect(notifications.notify).toHaveBeenCalledWith(
      // `/book/:bookId`, singular: the plural spelling is not a route and 404s from the notification.
      expect.objectContaining({ type: NotificationType.BookRequestAvailable, actionUrl: '/book/42' }),
    );
  });

  /**
   * The approver has the book already, so a transfer still running is work nothing will use. It
   * used to be left in the client with nothing in BookOrbit pointing at it: `failInFlightForRequest`
   * settles the row, but nothing ever told the client to stop.
   */
  it('detaches a live transfer from its client, as cancelling and deleting do', async () => {
    const { service, removal, downloads } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'downloading' })) } });

    await service.markFulfilled(10, { matchedBookId: 42 }, approver);

    expect(removal.removeLatestForRequest).toHaveBeenCalledWith(10, false, 'reader');
    // Only the newest attempt is detached, so an older one still in flight is settled here.
    expect(downloads.failInFlightForRequest).toHaveBeenCalledWith(10, expect.stringContaining('reader'));
  });

  it('records that a download client refused the detach rather than failing the fulfilment', async () => {
    const { service, repo } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'downloading' })) },
      removal: { removeLatestForRequest: vi.fn().mockResolvedValue({ removed: false, error: 'connection refused' }) },
    });

    await service.markFulfilled(10, { matchedBookId: 42 }, approver);

    expect(repo.updateIf).toHaveBeenCalledWith(
      10,
      expect.anything(),
      expect.objectContaining({ status: 'available', statusReason: expect.stringContaining('connection refused') }),
    );
  });

  /** Every sibling transition stamps it, and without it who closed a hand-fulfilled request is lost. */
  it('records who closed the request', async () => {
    const { service, repo } = makeService();

    await service.markFulfilled(10, { matchedBookId: 42 }, approver);

    expect(repo.updateIf).toHaveBeenCalledWith(
      10,
      expect.anything(),
      expect.objectContaining({ decidedByUserId: approver.id, decidedAt: expect.any(Date) }),
    );
  });

  it('accepts a Book Dock file as the fulfilment instead', async () => {
    const { service, repo } = makeService();
    await service.markFulfilled(10, { bookDockFileId: 5 }, approver);
    expect(repo.updateIf).toHaveBeenCalledWith(10, expect.anything(), expect.objectContaining({ status: 'available', bookDockFileId: 5 }));
  });

  it('requires something to point at', async () => {
    const { service, repo } = makeService();
    await expect(service.markFulfilled(10, {}, approver)).rejects.toThrow(BadRequestException);
    expect(repo.updateIf).not.toHaveBeenCalled();
  });

  it('refuses a book id that no longer exists', async () => {
    const { service, repo } = makeService({ repo: { bookExists: vi.fn().mockResolvedValue(false) } });
    await expect(service.markFulfilled(10, { matchedBookId: 42 }, approver)).rejects.toThrow(BadRequestException);
    expect(repo.updateIf).not.toHaveBeenCalled();
  });

  it('refuses a Book Dock file id that no longer exists', async () => {
    const { service, repo } = makeService({ repo: { bookDockFileExists: vi.fn().mockResolvedValue(false) } });
    await expect(service.markFulfilled(10, { bookDockFileId: 5 }, approver)).rejects.toThrow(BadRequestException);
    expect(repo.updateIf).not.toHaveBeenCalled();
  });

  it('refuses to fulfil a rejected or cancelled request', async () => {
    for (const status of ['rejected', 'cancelled']) {
      const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status })) } });
      await expect(service.markFulfilled(10, { matchedBookId: 42 }, approver)).rejects.toThrow(BadRequestException);
    }
  });

  it('refuses to fulfil twice', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'available' })) } });
    await expect(service.markFulfilled(10, { matchedBookId: 42 }, approver)).rejects.toThrow(BadRequestException);
  });

  /**
   * `ManageBookRequests` says an approver may close a request. It says nothing about which
   * libraries they can read or whose dock items are theirs, and an unscoped id here writes a
   * permanent reference to a resource they could never have opened.
   */
  it('looks the book up only within the libraries the approver can reach', async () => {
    const { service, repo, libraryService } = makeService({ libraryService: { findAccessibleLibraryIds: vi.fn().mockResolvedValue([3, 4]) } });

    await service.markFulfilled(10, { matchedBookId: 42 }, approver);

    expect(repo.bookExists).toHaveBeenCalledExactlyOnceWith(42, [3, 4]);
    expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalled();
  });

  it('refuses a book in a library the approver cannot reach', async () => {
    const { service, repo } = makeService({ repo: { bookExists: vi.fn().mockResolvedValue(false) } });

    await expect(service.markFulfilled(10, { matchedBookId: 42 }, approver)).rejects.toThrow(BadRequestException);
    expect(repo.updateIf).not.toHaveBeenCalled();
  });

  it('looks a superuser up across every library', async () => {
    const { service, repo, libraryService } = makeService();

    await service.markFulfilled(10, { matchedBookId: 42 }, user({ isSuperuser: true }));

    expect(repo.bookExists).toHaveBeenCalledExactlyOnceWith(42, null);
    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
  });

  it('looks a dock file up only among the approver uploads without the dock permission', async () => {
    const { service, repo } = makeService();

    await service.markFulfilled(10, { bookDockFileId: 5 }, approver);

    expect(repo.bookDockFileExists).toHaveBeenCalledExactlyOnceWith(5, approver.id);
  });

  it('looks a dock file up across the whole dock for somebody who manages it', async () => {
    const { service, repo } = makeService();
    const dockManager = user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests, Permission.ManageBookDock] });

    await service.markFulfilled(10, { bookDockFileId: 5 }, dockManager);

    expect(repo.bookDockFileExists).toHaveBeenCalledExactlyOnceWith(5, null);
  });
});

/**
 * The whole client model is "every page answers a broadcast with a fetch", so a transition that
 * commits without one is invisible until something else happens to emit: a queue does not show a
 * new submission, a requester never sees pending become approved, and a second moderator goes on
 * looking at a row somebody already decided. With auto-grab off, approval has no downstream
 * emitter either, so nothing else was ever going to cover for it.
 */
describe('BookRequestService change broadcasts', () => {
  const approver = user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] });

  it('announces a new submission', async () => {
    const { service, gateway } = makeService({ dedupe: { findActiveRequestFor: vi.fn().mockResolvedValue(null) } });

    await service.submit(dto, user());

    expect(gateway.emitChanged).toHaveBeenCalled();
  });

  it('announces an approval', async () => {
    const { service, gateway } = makeService();

    await service.approve(10, { targetLibraryId: 5 }, approver);

    expect(gateway.emitChanged).toHaveBeenCalled();
  });

  it('announces a rejection', async () => {
    const { service, gateway } = makeService();

    await service.reject(10, { decisionNote: 'Already on order' }, approver);

    expect(gateway.emitChanged).toHaveBeenCalled();
  });

  it('announces a request closed by hand', async () => {
    const { service, gateway } = makeService({ repo: { bookExists: vi.fn().mockResolvedValue(true) } });

    await service.markFulfilled(10, { matchedBookId: 4 }, approver);

    expect(gateway.emitChanged).toHaveBeenCalled();
  });

  /** A transition that never committed is not one to announce; the loser of a race announces nothing. */
  it('says nothing when the transition did not commit', async () => {
    const { service, gateway } = makeService({ repo: { updateIf: vi.fn().mockResolvedValue(undefined) } });

    await expect(service.approve(10, { targetLibraryId: 5 }, approver)).rejects.toThrow();

    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });

  it('announces a committed transition even when notification audience lookup fails afterwards', async () => {
    const { service, gateway } = makeService({ repo: { findInterestedUserIds: vi.fn().mockRejectedValue(new Error('database unavailable')) } });

    await expect(service.reject(10, {}, approver)).rejects.toThrow('database unavailable');

    expect(gateway.emitChanged).toHaveBeenCalledTimes(1);
  });

  it('announces a hand fulfilment even when abandoning its live attempts fails afterwards', async () => {
    const { service, gateway } = makeService({
      repo: { bookExists: vi.fn().mockResolvedValue(true) },
      downloads: { failInFlightForRequest: vi.fn().mockRejectedValue(new Error('database unavailable')) },
    });

    await expect(service.markFulfilled(10, { matchedBookId: 4 }, approver)).rejects.toThrow('database unavailable');

    expect(gateway.emitChanged).toHaveBeenCalledTimes(1);
  });
});

describe('BookRequestService.listAll', () => {
  it('refuses a caller without the manage permission', async () => {
    const { service } = makeService();
    await expect(service.listAll({}, user())).rejects.toThrow(ForbiddenException);
  });

  it('does not scope to the caller for an approver', async () => {
    const { service, repo } = makeService();
    await service.listAll({}, user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] }));
    expect(repo.findAll).toHaveBeenCalledWith(expect.not.objectContaining({ userId: expect.anything() }));
  });

  it('passes the exact requester filter to the repository', async () => {
    const { service, repo } = makeService();
    await service.listAll({ requesterUserId: 42 }, user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] }));
    expect(repo.findAll).toHaveBeenCalledWith(expect.objectContaining({ requesterUserId: 42 }));
  });

  it('returns the bounded requester options from the repository', async () => {
    const options = [{ userId: 42, username: 'reader', name: 'Reader' }];
    const { service, repo } = makeService({ repo: { findRequesterOptions: vi.fn().mockResolvedValue(options) } });

    await expect(service.listRequesterOptions({})).resolves.toEqual(options);
    expect(repo.findRequesterOptions).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('passes a requester search through to the repository', async () => {
    const { service, repo } = makeService();

    await service.listRequesterOptions({ search: 'ada' });

    expect(repo.findRequesterOptions).toHaveBeenCalledExactlyOnceWith('ada');
  });
});

describe('BookRequestService.listMine', () => {
  it('always scopes to the caller', async () => {
    const { service, repo } = makeService();
    await service.listMine({}, user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] }));
    expect(repo.findAll).toHaveBeenCalledWith(expect.objectContaining({ userId: 1 }));
  });
});

describe('BookRequestService.getOne', () => {
  it('lets the owner read their request', async () => {
    const { service } = makeService();
    await expect(service.getOne(10, user())).resolves.toMatchObject({ id: 10 });
  });

  it('lets a subscriber read it', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(joined({ userId: 2 })), isSubscriber: vi.fn().mockResolvedValue(true) },
    });
    await expect(service.getOne(10, user())).resolves.toMatchObject({ id: 10 });
  });

  /** Whoever is driving the work can read it, without depending on the subscription that came with it. */
  it('lets the fulfiller read a request somebody else asked for, unsubscribed', async () => {
    const { service } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(joined({ userId: 2, fulfillerUserId: 1 })), isSubscriber: vi.fn().mockResolvedValue(false) },
    });
    const fulfiller = user({ permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });

    await expect(service.getOne(10, fulfiller)).resolves.toMatchObject({ id: 10 });
  });

  it('refuses a stranger', async () => {
    const { service } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ userId: 2 })) } });
    await expect(service.getOne(10, user())).rejects.toThrow(ForbiddenException);
  });
});

/**
 * Two moderators clicking at once, or one clicking while a background sweep is mid-flight. Every
 * transition commits conditionally on the status it read, so exactly one of them lands; the loser
 * is refused with the status the request is actually in rather than being told it succeeded.
 */
describe('BookRequestService lifecycle races', () => {
  const approver = user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] });

  /** A reject that committed first: the approve must not announce, and must not start automation. */
  it('refuses an approve that lost to a concurrent reject, and starts no automation', async () => {
    const { service, repo, notifications, automation } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(joined({ status: 'pending', targetLibraryId: 1 }))
          .mockResolvedValue(joined({ status: 'rejected', targetLibraryId: 1 })),
        updateIf: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(service.approve(10, {}, approver)).rejects.toThrow('Only a pending request can be approved; this one is rejected');

    expect(repo.updateIf).toHaveBeenCalledTimes(1);
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(automation.considerRequest).not.toHaveBeenCalled();
  });

  it('refuses a reject that lost to a concurrent approve, and tells nobody', async () => {
    const { service, notifications } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(joined({ status: 'pending' }))
          .mockResolvedValue(joined({ status: 'approved' })),
        updateIf: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(service.reject(10, {}, approver)).rejects.toThrow('Only a pending request can be rejected; this one is approved');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  /** The refusal names the status the request is in now, not the one the pre-read guard saw. */
  it('refuses a cancel that lost to a concurrent approve and names the current status', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(joined({ status: 'pending' }))
          .mockResolvedValue(joined({ status: 'available' })),
        updateIf: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(service.cancel(10, user())).rejects.toThrow('A request that is available can no longer be cancelled');
  });

  it('refuses a fulfil that lost to a concurrent one rather than filing the book twice', async () => {
    const { service, notifications } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(joined({ status: 'downloading' }))
          .mockResolvedValue(joined({ status: 'available' })),
        updateIf: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(service.markFulfilled(10, { matchedBookId: 42 }, approver)).rejects.toThrow('This request is already fulfilled');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  /**
   * A manual fulfilment under a live transfer. The attempt is taken out of the in-flight set with
   * the transition, or the poll loop would go on reporting progress for a request that is filed
   * and would eventually import a second copy of the book.
   */
  it('abandons a live transfer when the request is fulfilled by hand', async () => {
    const { service, downloads } = makeService({ repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'downloading' })) } });

    await service.markFulfilled(10, { matchedBookId: 42 }, approver);

    expect(downloads.failInFlightForRequest).toHaveBeenCalledWith(10, expect.stringContaining('reader'));
  });

  it('does not touch the transfer when the fulfil lost its race', async () => {
    const { service, downloads } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(joined({ status: 'downloading' }))
          .mockResolvedValue(joined({ status: 'cancelled' })),
        updateIf: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(service.markFulfilled(10, { matchedBookId: 42 }, approver)).rejects.toThrow(BadRequestException);
    expect(downloads.failInFlightForRequest).not.toHaveBeenCalled();
  });

  it('refuses to hide a request a retry re-grabbed between the check and the write', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(joined({ status: 'failed' }))
          .mockResolvedValue(joined({ status: 'grabbed' })),
        dismissIf: vi.fn().mockResolvedValue(false),
      },
    });

    await expect(service.dismiss(10, user())).rejects.toThrow('A request that is grabbed is still being worked on; cancel it instead');
  });

  it('refuses to delete a request a retry re-grabbed between the check and the write', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockResolvedValueOnce(joined({ status: 'failed' }))
          .mockResolvedValue(joined({ status: 'grabbed' })),
        remove: vi.fn().mockResolvedValue(false),
      },
    });

    await expect(service.remove(10, approver)).rejects.toThrow('A request that is grabbed is still being worked on; cancel it before deleting it');
  });
});

describe('BookRequestService.checkAvailability', () => {
  it('passes null library scope for a superuser so nothing is hidden', async () => {
    const { service, dedupe } = makeService();
    await service.checkAvailability([], user({ isSuperuser: true }));
    expect(dedupe.checkAvailability).toHaveBeenCalledWith([], 1, null);
  });

  it('scopes an ordinary user to their accessible libraries', async () => {
    const { service, dedupe } = makeService();
    await service.checkAvailability([], user());
    expect(dedupe.checkAvailability).toHaveBeenCalledWith([], 1, [1]);
  });
});

describe('BookRequestService.getSummary', () => {
  it('leaves the approver counts at zero for a plain requester', async () => {
    const countForUser = vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(9);
    const { service, repo } = makeService({ repo: { countForUser } });
    await expect(service.getSummary(user())).resolves.toEqual({ pending: 0, active: 0, mine: 4, mineTotal: 9, allTotal: 0 });
    expect(countForUser).toHaveBeenNthCalledWith(2, 1, [], true);
    expect(repo.countByStatuses).not.toHaveBeenCalled();
  });

  it('counts the queue for an approver', async () => {
    const countByStatuses = vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(5).mockResolvedValueOnce(12);
    const countForUser = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(4);
    const { service } = makeService({ repo: { countByStatuses, countForUser } });
    await expect(service.getSummary(user({ permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] }))).resolves.toEqual({
      pending: 3,
      active: 5,
      mine: 1,
      mineTotal: 4,
      allTotal: 12,
    });
    expect(countByStatuses).toHaveBeenNthCalledWith(3, [], 1);
  });

  /**
   * Five counts, two of them over a subquery, asked again by every connected page every time the
   * pipeline broadcasts a change. Keyed on the broadcast rather than a clock, so what comes back is
   * never older than the change that prompted the ask.
   */
  describe('the read behind it', () => {
    it('answers repeat asks between two changes from a single read', async () => {
      const countForUser = vi.fn().mockResolvedValue(4);
      const { service } = makeService({ repo: { countForUser } });

      await service.getSummary(user());
      await service.getSummary(user());

      // `mine` and `mineTotal`, from one load rather than two.
      expect(countForUser).toHaveBeenCalledTimes(2);
    });

    it('reads again once something has changed', async () => {
      const countForUser = vi.fn().mockResolvedValue(4);
      const { service, gateway } = makeService({ repo: { countForUser } });

      await service.getSummary(user());
      gateway.emitChanged();
      await service.getSummary(user());

      expect(countForUser).toHaveBeenCalledTimes(4);
    });

    it("never hands one person another person's counts", async () => {
      const countForUser = vi.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(9).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
      const { service } = makeService({ repo: { countForUser } });

      await expect(service.getSummary(user({ id: 1 }))).resolves.toMatchObject({ mine: 4, mineTotal: 9 });
      await expect(service.getSummary(user({ id: 2 }))).resolves.toMatchObject({ mine: 1, mineTotal: 2 });
    });
  });
});

describe('BookRequestService.approveMany', () => {
  const approver = () => user({ id: 2, permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] });

  it('approves every id and hands each one to automation', async () => {
    const { service, repo, automation } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'pending', targetLibraryId: 1 })) },
    });

    const result = await service.approveMany({ ids: [10, 11] }, approver());

    expect(result.updated).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(automation.considerRequest).toHaveBeenCalledTimes(2);
    expect(repo.updateIf).toHaveBeenCalledTimes(2);
  });

  it('reports the rows it could not approve by name instead of failing the whole batch', async () => {
    const { service } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockImplementation((id: number) =>
            Promise.resolve(
              id === 11 ? joined({ id: 11, status: 'available', title: 'Watchers' }) : joined({ status: 'pending', targetLibraryId: 1 }),
            ),
          ),
      },
    });

    const result = await service.approveMany({ ids: [10, 11, 12] }, approver());

    expect(result.updated).toHaveLength(2);
    expect(result.failed).toEqual([{ id: 11, title: 'Watchers', reason: 'Only a pending request can be approved; this one is available' }]);
  });

  it('collapses a repeated id so one row cannot be approved twice in a batch', async () => {
    const { service, repo } = makeService({
      repo: { findById: vi.fn().mockResolvedValue(joined({ status: 'pending', targetLibraryId: 1 })) },
    });

    const result = await service.approveMany({ ids: [10, 10, 10] }, approver());

    expect(result.updated).toHaveLength(1);
    expect(repo.updateIf).toHaveBeenCalledTimes(1);
  });
});

describe('BookRequestService.dismissMany', () => {
  it('hides every settled row and names the ones still being worked on', async () => {
    const { service, repo } = makeService({
      repo: {
        findById: vi
          .fn()
          .mockImplementation((id: number) =>
            Promise.resolve(id === 11 ? joined({ id: 11, status: 'downloading', title: 'Whistler' }) : joined({ status: 'available' })),
          ),
      },
    });

    const result = await service.dismissMany({ ids: [10, 11] }, user());

    expect(result.updated).toHaveLength(1);
    expect(repo.dismissIf).toHaveBeenCalledTimes(1);
    expect(result.failed).toEqual([
      { id: 11, title: 'Whistler', reason: 'A request that is downloading is still being worked on; cancel it instead' },
    ]);
  });
});

/**
 * The request form has to say where an unpicked request lands, or the requester submits into an
 * empty select with no idea what happens next.
 */
describe('BookRequestService.getDefaultDestinations', () => {
  it('names the library each medium would land in', async () => {
    const { service } = makeService({
      automationSettings: {
        resolveDestinationFor: vi.fn((mediaKind: string) =>
          Promise.resolve(mediaKind === 'audiobook' ? { libraryId: 7, folderId: 21 } : { libraryId: null, folderId: null }),
        ),
      },
    });

    await expect(service.getDefaultDestinations()).resolves.toEqual({
      ebook: { libraryId: null, libraryName: null, folderId: null },
      audiobook: { libraryId: 7, libraryName: 'Audiobooks', folderId: 21 },
      comic: { libraryId: null, libraryName: null, folderId: null },
    });
  });

  it('reports nothing for a medium with no default', async () => {
    const { service, repo } = makeService();

    await expect(service.getDefaultDestinations()).resolves.toMatchObject({
      ebook: { libraryId: null, libraryName: null, folderId: null },
    });
    expect(repo.findLibraryNames).toHaveBeenCalledWith([]);
  });

  /** One query for all three, not one per medium. */
  it('looks the names up in a single round trip', async () => {
    const { service, repo } = makeService({
      automationSettings: { resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: 7, folderId: 21 }) },
    });

    await service.getDefaultDestinations();

    expect(repo.findLibraryNames).toHaveBeenCalledTimes(1);
    expect(repo.findLibraryNames).toHaveBeenCalledWith([7, 7, 7]);
  });

  /**
   * The setting is not rewritten when a library is deleted, so a name can come back missing. The
   * destination is still reported: the id is what the server will actually use.
   */
  it('reports a destination whose library name could not be read', async () => {
    const { service } = makeService({
      repo: { findLibraryNames: vi.fn().mockResolvedValue(new Map()) },
      automationSettings: { resolveDestinationFor: vi.fn().mockResolvedValue({ libraryId: 7, folderId: 21 }) },
    });

    await expect(service.getDefaultDestinations()).resolves.toMatchObject({
      ebook: { libraryId: 7, libraryName: null, folderId: 21 },
    });
  });
});

describe('BookRequestService.assertCanFulfil', () => {
  const owner = () => user({ id: 1, permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });

  it('lets a moderator fulfil a request that is not theirs', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(joined({ userId: 99 }));

    await expect(
      service.assertCanFulfil(10, user({ id: 2, permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] })),
    ).resolves.toBeDefined();
  });

  it('lets a self-server fulfil their own', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(joined({ userId: 1 }));

    await expect(service.assertCanFulfil(10, owner())).resolves.toBeDefined();
  });

  /** The permission is about fulfilling your own work, not about reaching into somebody else's. */
  it('refuses a self-server on a request somebody else owns', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(joined({ userId: 99 }));

    await expect(service.assertCanFulfil(10, owner())).rejects.toThrow(ForbiddenException);
  });

  it('refuses an ordinary requester on their own request', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(joined({ userId: 1 }));

    await expect(service.assertCanFulfil(10, user())).rejects.toThrow(ForbiddenException);
  });

  /** A collision hands the row to somebody who is not its requester; the column is what records it. */
  it('lets the self-server who took a request on fulfil it, though it names another requester', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(joined({ userId: 99, selfServe: true, fulfillerUserId: 1 }));

    await expect(service.assertCanFulfil(10, owner())).resolves.toBeDefined();
  });

  /** And the requester it was taken off is no longer the one driving it. */
  it('refuses the original requester once somebody else has taken their request on', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(joined({ userId: 1, selfServe: true, fulfillerUserId: 99 }));

    await expect(service.assertCanFulfil(10, owner())).rejects.toThrow(ForbiddenException);
  });

  it('404s a request that is not there rather than reporting it as forbidden', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(undefined);

    await expect(service.assertCanFulfil(10, owner())).rejects.toThrow(NotFoundException);
  });
});
