import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ACTIVE_BOOK_REQUEST_STATUSES,
  BOOK_REQUEST_MEDIA_KINDS,
  BOOK_REQUEST_STATUSES,
  CANCELLABLE_BOOK_REQUEST_STATUSES,
  emptyResolvedRequestDestinations,
  FULFILLABLE_BOOK_REQUEST_STATUSES,
  isBookRequestFulfiller,
  isCancellableBookRequestStatus,
  isFulfillableBookRequestStatus,
  isSettledBookRequestStatus,
  NotificationType,
  Permission,
  REQUEST_LANGUAGE_CODES,
  SETTLED_BOOK_REQUEST_STATUSES,
  toRequestLanguage,
} from '@bookorbit/types';
import type {
  BookRequestAvailability,
  BookRequestAvailabilityQuery,
  BookRequestFailureMeta,
  BookRequestSubmitErrorCode,
  BookRequestItem,
  BookRequestMetadataSource,
  BookRequestPage,
  BookRequestRequesterOption,
  BookRequestStatus,
  BookRequestSubmitResult,
  BookRequestBulkFailure,
  BookRequestBulkResult,
  BookRequestSourceStatus,
  BookRequestSummary,
  ResolvedRequestDestinations,
} from '@bookorbit/types';

import { StatsCache } from '../../common/cache/stats-cache';
import { isUniqueViolation } from '../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import type { BookRequestRow } from '../../db/schema';
import { LibraryService } from '../library/library.service';
import { BookRequestAttributionService } from './book-request-attribution.service';
import { BookRequestDedupeService, dedupeKeyCandidates, primaryDedupeKey } from './book-request-dedupe.service';
import { BookRequestGateway } from './book-request.gateway';
import { BookRequestNotifier } from './book-request-notifier.service';
import { mapBookRequestRow } from './book-request.mapper';
import { BookRequestDownloadRepository } from './fulfillment/book-request-download.repository';
import { DownloadRemovalService } from './fulfillment/download-removal.service';
import { BookRequestRepository, type BookRequestJoinedRow } from './book-request.repository';
import { RequestAutomationService } from './fulfillment/request-automation.service';
import { RequestAutomationSettingsService } from './fulfillment/request-automation-settings.service';
import { IndexerConfigService } from './indexers/indexer-config.service';
import type { CreateBookRequestDto } from './dto/create-book-request.dto';
import type { DecideBookRequestDto } from './dto/decide-book-request.dto';
import type { FulfillBookRequestDto } from './dto/fulfill-book-request.dto';
import type { BulkBookRequestsDto, BulkRejectBookRequestsDto } from './dto/bulk-book-requests.dto';
import type { ListAllBookRequestsDto, ListBookRequestsDto } from './dto/list-book-requests.dto';
import type { ListRequesterOptionsDto } from './dto/list-requester-options.dto';

/**
 * Statuses that still count as open work in the approver queue, which is exactly the set that
 * holds a claim on the work. Aliased rather than restated so the two cannot drift apart.
 */
const OPEN_STATUSES = ACTIVE_BOOK_REQUEST_STATUSES;

/**
 * The summary is five counts, two of them over a subquery, and every connected page asks for it
 * again on every change broadcast. Keyed on the gateway's change version, so a busy pipeline costs
 * one read per change rather than one per connected page, and the answer is never older than the
 * last change. The window is only what bounds a count that moved without a broadcast.
 */
const SUMMARY_CACHE_TTL_MS = 5_000;
const SUMMARY_CACHE_MAX_ENTRIES = 200;

/**
 * Everything but `available`: once the book is filed, the language already decided what was
 * imported, and changing it now would describe the request as having asked for something it did
 * not get.
 */
const LANGUAGE_EDITABLE_STATUSES: readonly BookRequestStatus[] = BOOK_REQUEST_STATUSES.filter((status) => status !== 'available');

/**
 * How many times a submission will re-attempt its insert. Two, because the only reason a retry
 * helps is a dedupe winner that disappeared in the same instant it was found, and a second
 * disappearance is a caller looping against a queue that is being emptied faster than it fills.
 */
const SUBMIT_INSERT_ATTEMPTS = 2;

/** The one status approve and reject may be reached from. */
const PENDING_ONLY: readonly BookRequestStatus[] = ['pending'];

/**
 * How many self-serve requests one person may have in flight at once.
 *
 * Every live row is a release search that hits every enabled tracker, and an unbounded number of
 * them is how one account gets an instance banned. Generous enough that queueing an evening's
 * reading never touches it.
 */
const MAX_LIVE_SELF_SERVE_REQUESTS = 10;

/**
 * The statuses an existing request can be taken over from: nobody has decided on it, and nobody
 * has grabbed anything for it. Anything further along is work somebody is already driving, and a
 * self-fulfiller who collides with it is genuinely a subscriber.
 */
const CLAIMABLE_STATUSES: readonly BookRequestStatus[] = ['pending', 'approved'];

/**
 * A refusal the request form can say back in the reader's own language.
 *
 * Every sentence below is copy this application wrote about a rule this instance applies, so
 * handing the client the English and nothing else is handing it something it cannot translate.
 * The message stays as the fallback for a client that does not know the code yet, exactly as it
 * does for a grab; the code is what the form renders.
 */
function submitRefusal(errorCode: BookRequestSubmitErrorCode, message: string, errorMeta?: BookRequestFailureMeta): BadRequestException {
  return new BadRequestException({ message, errorCode, ...(errorMeta ? { errorMeta } : {}), statusCode: HttpStatus.BAD_REQUEST });
}

/** The same, for the refusals that are about what this person may do rather than what they sent. */
function submitForbidden(errorCode: BookRequestSubmitErrorCode, message: string, errorMeta?: BookRequestFailureMeta): ForbiddenException {
  return new ForbiddenException({ message, errorCode, ...(errorMeta ? { errorMeta } : {}), statusCode: HttpStatus.FORBIDDEN });
}

function normalizeMetadataSources(sources: CreateBookRequestDto['metadataSources']): BookRequestMetadataSource[] {
  const seen = new Set<string>();
  const normalized: BookRequestMetadataSource[] = [];
  for (const source of sources ?? []) {
    const providerKey = source.providerKey.trim();
    const providerId = source.providerId.trim();
    if (!providerKey || !providerId) continue;
    const key = `${providerKey}\u0000${providerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      providerKey,
      providerId,
      providerLabel: source.providerLabel.trim() || providerKey,
      isbn10: source.isbn10?.trim() || null,
      isbn13: source.isbn13?.trim() || null,
    });
  }
  return normalized;
}

@Injectable()
export class BookRequestService {
  private readonly logger = new Logger(BookRequestService.name);
  private readonly summaryCache = new StatsCache({ ttlMs: SUMMARY_CACHE_TTL_MS, maxEntries: SUMMARY_CACHE_MAX_ENTRIES });

  constructor(
    private readonly repo: BookRequestRepository,
    private readonly dedupe: BookRequestDedupeService,
    private readonly libraryService: LibraryService,
    private readonly notifier: BookRequestNotifier,
    private readonly downloads: BookRequestDownloadRepository,
    private readonly automation: RequestAutomationService,
    private readonly automationSettings: RequestAutomationSettingsService,
    private readonly removal: DownloadRemovalService,
    private readonly gateway: BookRequestGateway,
    private readonly attribution: BookRequestAttributionService,
    private readonly indexers: IndexerConfigService,
  ) {}

  canManageAll(user: RequestUser): boolean {
    return user.isSuperuser || user.permissions.includes(Permission.ManageBookRequests);
  }

  private canAutoApprove(user: RequestUser): boolean {
    return user.isSuperuser || user.permissions.includes(Permission.BookRequestAutoApprove);
  }

  canSelfFulfil(user: RequestUser): boolean {
    return user.isSuperuser || user.permissions.includes(Permission.BookRequestSelfFulfill);
  }

  /**
   * The libraries a reference may point into, or null for somebody who reaches all of them.
   *
   * Null rather than the full list of ids so the query stays a plain lookup for a superuser on an
   * instance with hundreds of libraries.
   */
  private async reachableLibraryIds(user: RequestUser): Promise<number[] | null> {
    return user.isSuperuser ? null : this.libraryService.findAccessibleLibraryIds(user);
  }

  /**
   * Whose dock items a reference may point at: null for somebody who manages the whole dock, and
   * the caller's own id for everybody else. The same rule the Book Dock applies to itself, read
   * from the same permission, so an approver cannot reach a file through a request that the dock
   * would not have shown them.
   */
  private dockUploaderScope(user: RequestUser): number | null {
    return user.isSuperuser || user.permissions.includes(Permission.ManageBookDock) ? null : user.id;
  }

  /**
   * Who may drive fulfilment on one request: a moderator on any of them, or the self-server whose
   * request it is to drive.
   *
   * Usually that is the requester, because a self-serve row is created by the person about to
   * fulfil it. It is not always: one live request per work, so a self-fulfiller whose submission
   * collides with somebody else's undriven request takes that row on instead of opening a second,
   * and `fulfillerUserId` is what records that it is now theirs to drive.
   */
  async assertCanFulfil(requestId: number, user: RequestUser): Promise<BookRequestJoinedRow> {
    const joined = await this.repo.findById(requestId);
    if (!joined) throw new NotFoundException('Book request not found');
    if (this.canManageAll(user)) return joined;
    if (this.canSelfFulfil(user) && isBookRequestFulfiller(joined.request, user.id)) return joined;
    throw new ForbiddenException('You cannot fulfil this book request');
  }

  async submit(dto: CreateBookRequestDto, actor: RequestUser): Promise<BookRequestSubmitResult> {
    // Who this request is *for*, which is the caller unless an integration named somebody else.
    // Everything below asks about the subject and never about the actor: their permissions, their
    // libraries, their cap, their notifications. The actor stays the actor in the audit log.
    const subject = await this.attribution.resolveSubject(actor, dto.userId);

    const metadataSources = normalizeMetadataSources(dto.metadataSources);
    const work = {
      title: dto.title.trim(),
      authors: dto.authors ?? [],
      isbn13: dto.isbn13 ?? null,
      providerKey: dto.providerKey ?? null,
      providerId: dto.providerId ?? null,
      metadataSources,
      mediaKind: dto.mediaKind,
    };

    if (!work.title) throw submitRefusal('SUBMIT_TITLE_REQUIRED', 'A title is required');

    // Explicit rather than inferred from the permission. Inferring it would silently turn
    // `BookRequestSelfFulfill` into auto-approval for every ordinary request its holder makes.
    const selfServe = dto.selfServe === true;
    if (selfServe && !this.canSelfFulfil(subject)) {
      throw submitForbidden('SUBMIT_SELF_FULFIL_FORBIDDEN', 'You cannot fulfil your own book requests');
    }

    // Fold into an existing live request rather than opening a second one. A second grab of the
    // same torrent is exactly what the dedupe claim exists to prevent, so even a self-server is
    // folded - but folded as the person who is going to fulfil it, not as a bystander.
    const existing = await this.dedupe.findActiveRequestFor(work);
    if (existing) return selfServe ? this.takeOnOrAttach(existing, subject) : this.attachTo(existing.id, subject);

    let targetLibraryId = await this.resolveRequestedLibrary(dto.targetLibraryId ?? null, subject);
    let targetFolderId = await this.resolveDestinationFolder(dto.targetFolderId ?? null, targetLibraryId);

    // The instance default for this medium, which is the last rung: the requester named nowhere,
    // and the medium is the only thing about the eventual file that is known this early.
    //
    // Not checked against what this user can reach, unlike a library they named themselves. The
    // operator chose it for the whole instance, and a requester who cannot see that library is
    // exactly who the default exists for.
    if (targetLibraryId === null) {
      const fallback = await this.automationSettings.resolveDestinationFor(dto.mediaKind);

      // The one exception to "the operator chose it for the instance". A self-server is the person
      // filing the book, with nobody reviewing where it lands, so an unreachable default would let
      // them write into a library they cannot even read. They are asked to name one instead.
      if (selfServe && fallback.libraryId !== null) {
        const reachable = await this.libraryService.findAccessibleLibraryIds(subject);
        if (!reachable.includes(fallback.libraryId)) {
          throw submitRefusal(
            'SUBMIT_DEFAULT_LIBRARY_UNREACHABLE',
            'Pick a destination library you can reach: the instance default for this medium is not one of yours',
          );
        }
      }

      targetLibraryId = fallback.libraryId;
      targetFolderId = fallback.folderId;
    }

    const autoApproved = this.canAutoApprove(subject);
    // A self-serve request is approved by construction: its requester is the person about to fulfil
    // it, so there is no decision left to make and nothing for an approver to see.
    const settledOnCreate = autoApproved || selfServe;

    // Nobody decides on this request after it is made, so there is no later point where a
    // destination could be picked, and fulfilment refuses a request that has none.
    if (settledOnCreate && targetLibraryId === null) {
      throw submitRefusal('SUBMIT_DESTINATION_REQUIRED', 'Pick a destination library: your own requests are approved without a second pair of eyes');
    }

    const insert = {
      userId: subject.id,
      createdByUserId: this.attribution.createdByUserIdFor(actor, subject),
      mediaKind: dto.mediaKind,
      status: settledOnCreate ? ('approved' as const) : ('pending' as const),
      selfServe,
      title: work.title,
      subtitle: dto.subtitle ?? null,
      authors: work.authors,
      seriesName: dto.seriesName ?? null,
      seriesIndex: dto.seriesIndex ?? null,
      isbn10: dto.isbn10 ?? null,
      isbn13: dto.isbn13 ?? null,
      publishedYear: dto.publishedYear ?? null,
      // Normalised on the way in, because providers state it every which way: "spa", "English",
      // or nothing at all. The matcher compares codes, so anything else is a filter that either
      // rejects everything or agrees by accident.
      language: toRequestLanguage(dto.language),
      coverUrl: dto.coverUrl ?? null,
      providerKey: dto.providerKey ?? null,
      providerId: dto.providerId ?? null,
      metadataSources,
      preferredFormats: dto.preferredFormats ?? [],
      note: dto.note ?? null,
      targetLibraryId,
      targetFolderId,
      dedupeKey: primaryDedupeKey(work),
      decidedByUserId: settledOnCreate ? subject.id : null,
      decidedAt: settledOnCreate ? new Date() : null,
    };
    // Every other key this work could have hashed to, so a later requester who reaches it a
    // different way still collides with this row rather than opening a second one.
    const aliasKeys = dedupeKeyCandidates(work);

    let row: BookRequestRow | undefined;
    // Two people hitting Request on the same book at once: the loser of the insert race is folded
    // into the winner rather than shown a 500. The winner can be gone by the time we look for it -
    // cancelled, rejected or deleted in that same instant - and then the claim it held is free
    // again, so the insert that just lost would now succeed. One retry is the whole difference
    // between that submission going through and a requester being told a book they can have does
    // not exist.
    for (let attempt = 0; row === undefined; attempt++) {
      const lastAttempt = attempt >= SUBMIT_INSERT_ATTEMPTS - 1;
      try {
        row = await this.createRequest(selfServe, insert, aliasKeys);
      } catch (error: unknown) {
        if (!isUniqueViolation(error)) throw error;
        const winner = await this.dedupe.findActiveRequestFor(work);
        if (!winner) {
          if (lastAttempt) throw error;
          continue;
        }
        try {
          return selfServe ? await this.takeOnOrAttach(winner, subject) : await this.attachTo(winner.id, subject);
        } catch (joinError: unknown) {
          // The winner was deleted between finding it and reading it back. Same recovery.
          if (!(joinError instanceof NotFoundException)) throw joinError;
          if (lastAttempt) throw error;
        }
      }
    }

    this.logger.log(
      `[book_request.create] [end] requestId=${row.id} userId=${row.userId} createdByUserId=${row.createdByUserId ?? '-'} mediaKind=${row.mediaKind} autoApproved=${autoApproved} selfServe=${selfServe} title="${sanitizeLogValue(row.title)}" - book request created`,
    );

    // An auto-approving user never waits for a decision, so there is nobody to open the picker:
    // if automation is on, this is the point their request goes looking for a release. The trigger
    // says so, because a request nobody decided on is also a request nobody is watching, and
    // automation has to announce it if it gives up.
    //
    // Never for a self-server, who is on their way to the picker right now. Automation would race
    // them onto a release they did not choose, which is the opposite of what they asked for.
    if (autoApproved && !selfServe) this.automation.considerRequest(row.id, 'auto_approval');

    // Every page answers this with a fetch, so it is what puts a new submission in front of the
    // approvers without them reloading. After the create rather than after the notification: an
    // approver whose queue is already open sees the row arrive whether or not they are notified.
    this.gateway.emitChanged();

    if (!settledOnCreate) {
      await this.notifier.notifyApprovers(NotificationType.BookRequestSubmitted, {
        title: 'New book request',
        message: `${subject.name} requested "${row.title}"`,
        actionUrl: '/requests?tab=all',
        meta: { requestId: row.id },
      });
    }

    const joined = await this.repo.findById(row.id);
    if (!joined) throw new NotFoundException('Book request not found');
    return { request: await this.toItem(joined, subject.id), subscribed: false };
  }

  /**
   * The insert, with the self-serve cap enforced across it.
   *
   * A self-server holds no place in the moderation queue, so what is bounded instead is work in
   * flight: a cap on how many downloads one person can have open at once, which is what stops a
   * holder from queueing a hundred searches against every tracker. Counted inside the insert's own
   * transaction, because counting first and inserting after is not a cap - two submissions for
   * different works each see nine and both proceed.
   */
  private async createRequest(selfServe: boolean, data: Parameters<BookRequestRepository['create']>[0], aliasKeys: string[]) {
    if (!selfServe) return this.repo.create(data, aliasKeys);

    const row = await this.repo.createWithinSelfServeCap(data, aliasKeys, MAX_LIVE_SELF_SERVE_REQUESTS);
    if (!row) {
      throw submitForbidden(
        'SUBMIT_SELF_SERVE_LIMIT',
        `Finish or cancel some downloads first: ${MAX_LIVE_SELF_SERVE_REQUESTS} can be in flight at once`,
        { limit: MAX_LIVE_SELF_SERVE_REQUESTS },
      );
    }
    return row;
  }

  /**
   * What a self-fulfiller's submission does when somebody has already asked for the same work.
   *
   * One live request per work, so their own row cannot be opened alongside it. Subscribing them
   * and stopping there is what the dedupe fold does for everybody else, and for a self-fulfiller
   * it is a dead end: they asked to fetch this book and are handed a request every fulfilment
   * route then refuses them on. So an undriven request is taken on instead - approved, marked
   * self-serve, and recorded as theirs to drive - which is the same outcome their own row would
   * have had, minus the second grab of the same torrent.
   *
   * Taking one on is deliberately narrow. A request somebody has already grabbed a release for is
   * work in progress, and a destination this caller cannot reach would let them file a book into
   * a library they cannot even read - the same rule a fresh self-serve submission is held to.
   * Either way they are subscribed, which is honest: somebody else is driving it.
   */
  private async takeOnOrAttach(existing: BookRequestRow, user: RequestUser): Promise<BookRequestSubmitResult> {
    if (existing.userId === user.id) return this.attachTo(existing.id, user);
    if (!(await this.canTakeOn(existing, user))) return this.attachTo(existing.id, user);

    const claimed = await this.repo.claimForSelfServe(existing.id, user.id, CLAIMABLE_STATUSES, MAX_LIVE_SELF_SERVE_REQUESTS);
    if (!claimed) return this.attachTo(existing.id, user);

    this.logger.log(
      `[book_request.take_on] [end] requestId=${existing.id} userId=${user.id} requesterId=${existing.userId} from=${existing.status} - a self-fulfiller took on a request somebody else had asked for`,
    );

    // Before the caller is subscribed, so the announcement reaches the person whose request this
    // was rather than also telling the caller about their own action. A request that was waiting
    // on a decision has effectively had one, and approval is announced everywhere else it happens.
    await this.notifier.notifyInterested(existing.id, NotificationType.BookRequestApproved, {
      title: 'Book request approved',
      message: `"${existing.title}" was approved: ${user.name} is fetching it`,
      actionUrl: '/requests',
      meta: { requestId: existing.id },
    });

    this.gateway.emitChanged();
    return this.attachTo(existing.id, user);
  }

  private async canTakeOn(existing: BookRequestRow, user: RequestUser): Promise<boolean> {
    if (existing.selfServe || existing.fulfillerUserId !== null) return false;
    if (!CLAIMABLE_STATUSES.includes(existing.status as BookRequestStatus)) return false;
    // A grab that already happened is somebody driving it, whatever the status says.
    if ((await this.downloads.findLatestForRequests([existing.id])).size > 0) return false;
    if (existing.targetLibraryId === null) return false;

    const reachable = await this.libraryService.findAccessibleLibraryIds(user);
    return reachable.includes(existing.targetLibraryId);
  }

  /** Puts the caller's name against a request that already exists rather than making a second one. */
  private async attachTo(requestId: number, user: RequestUser): Promise<BookRequestSubmitResult> {
    const joined = await this.repo.findById(requestId);
    if (!joined) throw new NotFoundException('Book request not found');

    // Before toItem, which reads the subscriber list, so the caller sees themselves on it.
    if (joined.request.userId !== user.id) await this.repo.addSubscriber(requestId, user.id);
    return { request: await this.toItem(joined, user.id), subscribed: true };
  }

  /**
   * Leaving a request somebody else made.
   *
   * Joining is how a second person asking for the same book is folded into one request, and until
   * now it was one-way: the only way out was to wait for the thing to settle. Only the
   * subscription is removed; the request itself is untouched, and the people still waiting on it
   * are unaffected.
   *
   * The requester cannot leave, because there would be nothing left of the request to belong to
   * them, and neither can a fulfiller who took the row on: their subscription is what makes their
   * own work visible to them.
   */
  async unsubscribe(id: number, user: RequestUser): Promise<void> {
    const joined = await this.requireVisible(id, user);
    if (joined.request.userId === user.id) {
      throw new BadRequestException('This is your own request, so cancel or hide it rather than leaving it');
    }
    if (isBookRequestFulfiller(joined.request, user.id)) {
      throw new BadRequestException('You are fulfilling this request, so hand it back before leaving it');
    }

    if (!(await this.repo.removeSubscriber(id, user.id))) {
      throw new NotFoundException('You are not following this book request');
    }

    this.gateway.emitChanged();
  }

  /**
   * The requester picks from libraries they can actually reach. An unreachable id is rejected
   * rather than quietly dropped, so a request never lands somewhere the requester cannot see.
   */
  private async resolveRequestedLibrary(targetLibraryId: number | null, user: RequestUser): Promise<number | null> {
    if (targetLibraryId === null) return null;
    try {
      await this.libraryService.verifyUserAccess(user.id, targetLibraryId, user.isSuperuser);
    } catch (error) {
      // The rule belongs to the library service; only the sentence is ours, and the form has to be
      // able to translate this the way it translates every other reason a submission is refused.
      if (error instanceof ForbiddenException) throw submitForbidden('SUBMIT_LIBRARY_FORBIDDEN', error.message);
      throw error;
    }
    return targetLibraryId;
  }

  /**
   * Whether this instance can search for anything at all. Counts only, never names or addresses:
   * this is read by everybody who may file a request, and the list it comes from is admin-only.
   */
  getSourceStatus(): Promise<BookRequestSourceStatus> {
    return this.indexers.countSources();
  }

  /**
   * Where an unpicked request of each medium would land, named so the form can say so.
   *
   * The request form has to state this: without it the destination select sits empty and the
   * requester submits with no idea where the book goes. Not filtered by what this user can browse,
   * for the same reason the default itself is not: the operator chose it for the instance, and a
   * requester who cannot see that library is exactly who is looking at an empty select.
   */
  async getDefaultDestinations(): Promise<ResolvedRequestDestinations> {
    const resolved = await Promise.all(
      BOOK_REQUEST_MEDIA_KINDS.map(async (mediaKind) => [mediaKind, await this.automationSettings.resolveDestinationFor(mediaKind)] as const),
    );
    const names = await this.repo.findLibraryNames(resolved.map(([, destination]) => destination.libraryId).filter((id) => id !== null));

    const destinations = emptyResolvedRequestDestinations();
    for (const [mediaKind, destination] of resolved) {
      if (destination.libraryId === null) continue;
      destinations[mediaKind] = {
        libraryId: destination.libraryId,
        libraryName: names.get(destination.libraryId) ?? null,
        folderId: destination.folderId,
      };
    }
    return destinations;
  }

  async listMine(dto: ListBookRequestsDto, user: RequestUser): Promise<BookRequestPage> {
    const { items, total } = await this.repo.findAll({
      page: dto.page ?? 1,
      limit: dto.limit ?? 20,
      status: dto.status,
      mediaKind: dto.mediaKind,
      userId: user.id,
      selfServe: dto.selfServe,
      excludeDismissedFor: dto.includeDismissed ? undefined : user.id,
      sortBy: dto.sortBy,
      sortDir: dto.sortDir,
    });
    return { items: await this.toItems(items, user.id), total };
  }

  async listAll(dto: ListAllBookRequestsDto, user: RequestUser): Promise<BookRequestPage> {
    if (!this.canManageAll(user)) throw new ForbiddenException('You cannot view all book requests');
    const { items, total } = await this.repo.findAll({
      page: dto.page ?? 1,
      limit: dto.limit ?? 20,
      status: dto.status,
      mediaKind: dto.mediaKind,
      requesterUserId: dto.requesterUserId,
      selfServe: dto.selfServe,
      excludeDismissedFor: dto.includeDismissed ? undefined : user.id,
      sortBy: dto.sortBy,
      sortDir: dto.sortDir,
    });
    return { items: await this.toItems(items, user.id), total };
  }

  listRequesterOptions(dto: ListRequesterOptionsDto): Promise<BookRequestRequesterOption[]> {
    return this.repo.findRequesterOptions(dto.search ?? null);
  }

  async getOne(id: number, user: RequestUser): Promise<BookRequestItem> {
    const joined = await this.requireVisible(id, user);
    return this.toItem(joined, user.id);
  }

  /**
   * The refusal a transition that lost its race should have raised.
   *
   * Every lifecycle method reads the request, checks the status it found, and commits
   * conditionally on that status still holding. When the conditional write finds nothing, another
   * decision landed in between; re-reading here means the message names the status the request is
   * actually in now, which is exactly what the pre-read guard would have said had the winner
   * committed a moment earlier.
   */
  private async staleTransition(id: number, describe: (status: BookRequestStatus) => string): Promise<HttpException> {
    const joined = await this.repo.findById(id);
    if (!joined) return new NotFoundException('Book request not found');
    return new BadRequestException(describe(joined.request.status as BookRequestStatus));
  }

  /**
   * Who may steer or stop one request: its requester, a moderator, or the self-fulfiller who took
   * it on. The last of those matters because a fulfiller who cannot cancel the transfer they
   * started, or correct the language the picker is matching against, has taken on work they can
   * only run forwards.
   */
  private canDrive(request: BookRequestRow, user: RequestUser): boolean {
    if (request.userId === user.id || this.canManageAll(user)) return true;
    return this.canSelfFulfil(user) && isBookRequestFulfiller(request, user.id);
  }

  /**
   * Who may read one request. The fulfiller is named alongside the requester rather than left to
   * the subscription that taking a request on also creates: whoever is driving the work can see
   * it, and that must not depend on a side effect somebody could later undo.
   */
  private async requireVisible(id: number, user: RequestUser): Promise<BookRequestJoinedRow> {
    const joined = await this.repo.findById(id);
    if (!joined) throw new NotFoundException('Book request not found');
    if (this.canManageAll(user)) return joined;
    if (joined.request.userId === user.id) return joined;
    if (this.canSelfFulfil(user) && isBookRequestFulfiller(joined.request, user.id)) return joined;
    if (await this.repo.isSubscriber(id, user.id)) return joined;
    throw new ForbiddenException('You cannot view this book request');
  }

  /**
   * Stop, at any point before the request has settled. A request that is mid-download is stopped
   * at its transfer handler too. Torrent data is kept because an import may hardlink from it;
   * partial direct-download staging has no reuse and is deleted.
   *
   * The removal is best-effort on purpose. A download client that is unreachable must not be the
   * reason a stuck request stays stuck, so the cancellation stands either way and the request
   * carries a note that a transfer may still be sitting in the client.
   */
  async cancel(id: number, user: RequestUser): Promise<BookRequestItem> {
    const joined = await this.repo.findById(id);
    if (!joined) throw new NotFoundException('Book request not found');

    if (!this.canDrive(joined.request, user)) throw new ForbiddenException('You cannot cancel this book request');
    if (!isCancellableBookRequestStatus(joined.request.status as BookRequestStatus)) {
      throw new BadRequestException(`A request that is ${joined.request.status} can no longer be cancelled`);
    }

    // The transition first, and only then the client. Detaching first would hand the seed of a
    // request that finished during the click to a cancellation that is then refused, and the
    // ordering bought nothing: once the row says cancelled, the monitor's own writes are
    // conditional on statuses it no longer holds, so there is no attempt left to revive.
    const updated = await this.repo.updateIf(id, CANCELLABLE_BOOK_REQUEST_STATUSES, {
      status: 'cancelled',
      decidedByUserId: user.id,
      decidedAt: new Date(),
      statusReason: null,
    });
    if (!updated) throw await this.staleTransition(id, (status) => `A request that is ${status} can no longer be cancelled`);

    const outcome = await this.removal.removeLatestForRequest(id, false, user.username);
    // The cancellation stands either way; the note is what tells the requester a transfer may
    // still be sitting in the client. Conditional, so it cannot resurrect a row a delete removed.
    if (outcome.error) {
      await this.repo.updateIf(id, ['cancelled'], {
        statusReason: `Cancelled, but the active download could not be stopped: ${outcome.error}`,
      });
    }

    this.logger.log(
      `[book_request.cancel] [end] requestId=${id} userId=${user.id} from=${joined.request.status} downloadRemoved=${outcome.removed} - book request cancelled`,
    );

    this.gateway.emitChanged();
    return this.getOne(id, user);
  }

  /**
   * The language a request asks for, changed after it was made.
   *
   * Worth being able to change, because this one field silently decides the outcome: it arrives
   * from whichever edition was picked in the metadata results, so a request can end up asking for
   * a translation nobody chose. Without this the only remedy is to cancel and start again, and an
   * approver looking at a picker full of the wrong language has no way to correct it.
   */
  async setLanguage(id: number, language: string | null, user: RequestUser): Promise<BookRequestItem> {
    const joined = await this.repo.findById(id);
    if (!joined) throw new NotFoundException('Book request not found');

    if (!this.canDrive(joined.request, user)) throw new ForbiddenException('You cannot change this book request');
    // Once the book is filed the language already decided what was imported, and changing it now
    // would describe the request as having asked for something it did not get.
    if (joined.request.status === 'available') {
      throw new BadRequestException('A request that has already been filed can no longer change language');
    }

    // Normalised rather than stored as given, because a request created before this existed may
    // hold "spa" or "English", and the picker's facets compare codes.
    // Stricter than the create path on purpose. This one is a person picking from a list, so a code
    // outside it is a mistake worth reporting; a language a provider stated is data we already have
    // and narrowing that would drop a filter that used to work.
    const normalized = language === null ? null : toRequestLanguage(language);
    if (language !== null && (normalized === null || !REQUEST_LANGUAGE_CODES.includes(normalized))) {
      throw new BadRequestException(`"${language}" is not a language releases can be matched against`);
    }

    const updated = await this.repo.updateIf(id, LANGUAGE_EDITABLE_STATUSES, { language: normalized });
    if (!updated) throw await this.staleTransition(id, () => 'A request that has already been filed can no longer change language');

    this.logger.log(
      `[book_request.set_language] [end] requestId=${id} userId=${user.id} from=${joined.request.language ?? 'any'} to=${normalized ?? 'any'} - request language changed`,
    );

    this.gateway.emitChanged();
    return this.getOne(id, user);
  }

  /**
   * "Stop showing me this." Personal to the caller, so tidying your own list never takes a row off
   * the approver queue or off the other people who asked for the same book. Only a settled request
   * can be hidden; open work is cancelled, not swept under the rug.
   */
  async dismiss(id: number, user: RequestUser): Promise<BookRequestItem> {
    const joined = await this.requireVisible(id, user);
    if (!isSettledBookRequestStatus(joined.request.status as BookRequestStatus)) {
      throw new BadRequestException(`A request that is ${joined.request.status} is still being worked on; cancel it instead`);
    }

    if (!(await this.repo.dismissIf(id, user.id, SETTLED_BOOK_REQUEST_STATUSES))) {
      throw await this.staleTransition(id, (status) => `A request that is ${status} is still being worked on; cancel it instead`);
    }
    return this.getOne(id, user);
  }

  async restore(id: number, user: RequestUser): Promise<BookRequestItem> {
    await this.requireVisible(id, user);
    await this.repo.restore(id, user.id);
    return this.getOne(id, user);
  }

  /**
   * The escape hatch, for rows that are worth nothing to anybody: the audit trail of who asked and
   * who decided goes with them, which is why this is a moderator action and dismissal is what
   * everyone else gets.
   *
   * A settled request can still own client state, especially a torrent that keeps seeding after
   * import, so the attempt is detached first. Deleting the row before that would leave client work
   * with nothing pointing at it. Torrent files are kept; direct-download staging is disposable.
   */
  async remove(id: number, user: RequestUser): Promise<void> {
    const joined = await this.repo.findById(id);
    if (!joined) throw new NotFoundException('Book request not found');
    if (!this.canManageAll(user)) throw new ForbiddenException('You cannot delete book requests');
    if (!isSettledBookRequestStatus(joined.request.status as BookRequestStatus)) {
      throw new BadRequestException(`A request that is ${joined.request.status} is still being worked on; cancel it before deleting it`);
    }

    // Failed is the one settled status that can be grabbed again. Reserve it before touching the
    // client so a concurrent retry cannot start a healthy transfer that this deletion then stops.
    // The other settled statuses have no outgoing transition and need no temporary claim.
    const reservedFailed = joined.request.status === 'failed';
    if (reservedFailed && !(await this.repo.updateIf(id, ['failed'], { status: 'cancelled' }))) {
      throw await this.staleTransition(id, (status) => `A request that is ${status} is still being worked on; cancel it before deleting it`);
    }

    const outcome = await this.removal.removeLatestForRequest(id, false, user.username);
    if (outcome.error) {
      if (reservedFailed) await this.repo.updateIf(id, ['cancelled'], { status: 'failed' });
      throw new BadRequestException(`Remove the download from its client first: ${outcome.error}`);
    }

    if (!(await this.repo.remove(id, SETTLED_BOOK_REQUEST_STATUSES))) {
      throw await this.staleTransition(id, (status) => `A request that is ${status} is still being worked on; cancel it before deleting it`);
    }

    this.logger.log(
      `[book_request.delete] [end] requestId=${id} userId=${user.id} status=${joined.request.status} downloadRemoved=${outcome.removed} title="${sanitizeLogValue(joined.request.title)}" - book request deleted`,
    );

    this.gateway.emitChanged();
  }

  async approve(id: number, dto: DecideBookRequestDto, user: RequestUser): Promise<BookRequestItem> {
    const joined = await this.repo.findById(id);
    if (!joined) throw new NotFoundException('Book request not found');
    if (joined.request.status !== 'pending') {
      throw new BadRequestException(`Only a pending request can be approved; this one is ${joined.request.status}`);
    }

    // The approver may reroute, but only somewhere they can reach themselves.
    let targetLibraryId = joined.request.targetLibraryId;
    if (dto.targetLibraryId !== undefined && dto.targetLibraryId !== null) {
      await this.libraryService.verifyUserAccess(user.id, dto.targetLibraryId, user.isSuperuser);
      targetLibraryId = dto.targetLibraryId;
    }

    // Requests made before an instance default existed carry no destination at all, and there is
    // no reason to make the approver retype one the operator has since set.
    let carriedFolderId = dto.targetFolderId ?? joined.request.targetFolderId;
    if (targetLibraryId === null) {
      const fallback = await this.automationSettings.resolveDestinationFor(joined.request.mediaKind);
      targetLibraryId = fallback.libraryId;
      carriedFolderId ??= fallback.folderId;
    }

    // Fulfilment has nowhere to file the book without one, and an approval that skips it only
    // fails much later, at the grab or after a whole download has already run.
    if (targetLibraryId === null) {
      throw new BadRequestException('Pick a destination library before approving this request');
    }

    const targetFolderId = await this.resolveDestinationFolder(carriedFolderId, targetLibraryId);

    // Nothing below this line happens unless the approval is the one that committed. Two
    // moderators deciding at once would otherwise both announce their decision and both hand the
    // request to automation, for a request only one of them actually changed.
    if (
      !(await this.repo.updateIf(id, PENDING_ONLY, {
        status: 'approved',
        decidedByUserId: user.id,
        decidedAt: new Date(),
        decisionNote: dto.decisionNote ?? null,
        targetLibraryId,
        targetFolderId,
      }))
    ) {
      throw await this.staleTransition(id, (status) => `Only a pending request can be approved; this one is ${status}`);
    }

    this.gateway.emitChanged();

    await this.notifier.notifyInterested(id, NotificationType.BookRequestApproved, {
      title: 'Book request approved',
      message: `"${joined.request.title}" was approved`,
      actionUrl: '/requests',
      meta: { requestId: id },
    });

    this.automation.considerRequest(id);

    return this.getOne(id, user);
  }

  /**
   * Runs one per-request action across a selection, one at a time.
   *
   * Sequential rather than concurrent on purpose: an approval hands the request to automation, and
   * forty simultaneous searches against the same private tracker is what a rate limit looks like
   * from the other side. Nothing is rolled back on a failure either, because an approval that has
   * already reached automation cannot be taken back cleanly; the caller is told which ids fell out
   * instead.
   */
  private async runBulk(
    event: string,
    ids: number[],
    user: RequestUser,
    fallbackReason: string,
    run: (id: number) => Promise<BookRequestItem>,
  ): Promise<BookRequestBulkResult> {
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] userId=${user.id} count=${ids.length} - applying an action to a selection of book requests`);

    const updated: BookRequestItem[] = [];
    const failed: BookRequestBulkFailure[] = [];

    for (const id of ids) {
      const itemStartedAt = Date.now();
      try {
        updated.push(await run(id));
      } catch (error) {
        // An HttpException is this service refusing on a rule it states, and the reason is the
        // sentence the operator reads. Anything else is a defect, and folding it into the same
        // generic per-item failure without a line here is what made one undiagnosable.
        if (!(error instanceof HttpException)) {
          this.logger.error(
            `[${event}] [fail] userId=${user.id} requestId=${id} durationMs=${Date.now() - itemStartedAt} errorClass=${error instanceof Error ? error.constructor.name : typeof error} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - a request in the selection failed unexpectedly`,
          );
        }
        const reason = error instanceof HttpException ? error.message : fallbackReason;
        const joined = await this.repo.findById(id);
        failed.push({ id, title: joined?.request.title ?? String(id), reason });
      }
    }

    this.logger.log(
      `[${event}] [end] userId=${user.id} updated=${updated.length} failed=${failed.length} durationMs=${Date.now() - startedAt} - selection applied`,
    );

    return { updated, failed };
  }

  async approveMany(dto: BulkBookRequestsDto, user: RequestUser): Promise<BookRequestBulkResult> {
    return this.runBulk('book_request.approve_many', [...new Set(dto.ids)], user, 'Could not approve that request', (id) =>
      this.approve(id, {}, user),
    );
  }

  /**
   * Rejecting a selection, with one shared sentence. Unlike a reroute, a reason is exactly the
   * kind of thing that applies to the whole batch: "not available anywhere" is one answer to
   * forty requests, and making the approver type it forty times is why it went unwritten.
   */
  async rejectMany(dto: BulkRejectBookRequestsDto, user: RequestUser): Promise<BookRequestBulkResult> {
    return this.runBulk('book_request.reject_many', [...new Set(dto.ids)], user, 'Could not reject that request', (id) =>
      this.reject(id, { decisionNote: dto.decisionNote }, user),
    );
  }

  /** Hiding is personal, so this needs no moderator permission and touches nobody else's list. */
  async dismissMany(dto: BulkBookRequestsDto, user: RequestUser): Promise<BookRequestBulkResult> {
    return this.runBulk('book_request.dismiss_many', [...new Set(dto.ids)], user, 'Could not hide that request', (id) => this.dismiss(id, user));
  }

  /**
   * A folder only means anything alongside its own library. Rerouting the library while leaving
   * a folder from the old one behind would carry the book back into that library at finalize
   * time, and both ids are individually valid so no constraint would catch it.
   */
  private async resolveDestinationFolder(folderId: number | null, libraryId: number | null): Promise<number | null> {
    if (folderId === null) return null;
    if (libraryId === null) throw submitRefusal('SUBMIT_FOLDER_NEEDS_LIBRARY', 'A destination folder needs a destination library');
    if (!(await this.repo.folderBelongsToLibrary(folderId, libraryId))) {
      throw submitRefusal('SUBMIT_FOLDER_NOT_IN_LIBRARY', 'That folder is not part of the destination library');
    }
    return folderId;
  }

  async reject(id: number, dto: DecideBookRequestDto, user: RequestUser): Promise<BookRequestItem> {
    const joined = await this.repo.findById(id);
    if (!joined) throw new NotFoundException('Book request not found');
    if (joined.request.status !== 'pending') {
      throw new BadRequestException(`Only a pending request can be rejected; this one is ${joined.request.status}`);
    }

    if (
      !(await this.repo.updateIf(id, PENDING_ONLY, {
        status: 'rejected',
        decidedByUserId: user.id,
        decidedAt: new Date(),
        decisionNote: dto.decisionNote ?? null,
      }))
    ) {
      throw await this.staleTransition(id, (status) => `Only a pending request can be rejected; this one is ${status}`);
    }

    this.gateway.emitChanged();

    await this.notifier.notifyInterested(id, NotificationType.BookRequestRejected, {
      title: 'Book request rejected',
      message: dto.decisionNote?.trim() ? `"${joined.request.title}": ${dto.decisionNote.trim()}` : `"${joined.request.title}" was rejected`,
      actionUrl: '/requests',
      meta: { requestId: id },
    });

    return this.getOne(id, user);
  }

  /**
   * Phase 1 fulfilment: the approver went and got the book themselves and is closing the loop.
   * Later phases drive the same transition from the download pipeline.
   */
  async markFulfilled(id: number, dto: FulfillBookRequestDto, user: RequestUser): Promise<BookRequestItem> {
    const joined = await this.repo.findById(id);
    if (!joined) throw new NotFoundException('Book request not found');
    if (joined.request.status === 'available') throw new BadRequestException('This request is already fulfilled');
    if (!isFulfillableBookRequestStatus(joined.request.status as BookRequestStatus)) {
      throw new BadRequestException(`A ${joined.request.status} request cannot be fulfilled`);
    }
    if (dto.matchedBookId == null && dto.bookDockFileId == null) {
      throw new BadRequestException('Provide either a book or a Book Dock file to close the request');
    }

    // Scoped to what this actor can reach, not merely to what exists. `ManageBookRequests` says
    // they may close a request; it says nothing about which libraries they can read or whose dock
    // items are theirs, and an unscoped id here files a permanent reference to a resource they
    // could never have opened.
    if (dto.matchedBookId != null && !(await this.repo.bookExists(dto.matchedBookId, await this.reachableLibraryIds(user)))) {
      throw new BadRequestException('That book no longer exists');
    }
    if (dto.bookDockFileId != null && !(await this.repo.bookDockFileExists(dto.bookDockFileId, this.dockUploaderScope(user)))) {
      throw new BadRequestException('That Book Dock file no longer exists');
    }

    // Before the transition, like cancel and delete: the person has the book already, so a transfer
    // still running is work nothing will ever use. Detaching it after the row settled would leave
    // a window where the poll loop still owns an attempt against a filed request; leaving it out
    // altogether, as this used to, left a mid-download torrent running in the client with nothing
    // in BookOrbit pointing at it. Best-effort, so a client that is down cannot block the filing.
    const outcome = await this.removal.removeLatestForRequest(id, false, user.username);

    if (
      !(await this.repo.updateIf(id, FULFILLABLE_BOOK_REQUEST_STATUSES, {
        status: 'available',
        matchedBookId: dto.matchedBookId ?? null,
        bookDockFileId: dto.bookDockFileId ?? null,
        decisionNote: dto.note ?? joined.request.decisionNote,
        decidedByUserId: user.id,
        decidedAt: new Date(),
        statusReason: outcome.error ? `Fulfilled by hand, but the active download could not be stopped: ${outcome.error}` : null,
      }))
    ) {
      throw await this.staleTransition(id, (status) =>
        status === 'available' ? 'This request is already fulfilled' : `A ${status} request cannot be fulfilled`,
      );
    }

    // After the transition, not before: an attempt still running belongs to a request that is now
    // filed, and one left in flight is one the poll loop would go on reporting progress for and
    // would eventually import a second copy of the book from. `removeLatestForRequest` above only
    // settles the newest attempt, so this is what catches an older one still in flight.
    let abandoned: number;
    try {
      abandoned = await this.downloads.failInFlightForRequest(id, `Fulfilled by hand by ${user.username}`);
    } finally {
      this.gateway.emitChanged();
    }

    this.logger.log(
      `[book_request.fulfill] [end] requestId=${id} userId=${user.id} bookId=${dto.matchedBookId ?? 'none'} dockFileId=${dto.bookDockFileId ?? 'none'} downloadRemoved=${outcome.removed} abandonedAttempts=${abandoned} - book request fulfilled`,
    );

    await this.notifier.notifyBookAvailable(id, dto.matchedBookId ?? null, {
      title: 'Your requested book is available',
      message: `"${joined.request.title}" is ready`,
      meta: { requestId: id, bookId: dto.matchedBookId ?? null },
    });

    return this.getOne(id, user);
  }

  async checkAvailability(queries: BookRequestAvailabilityQuery[], user: RequestUser): Promise<BookRequestAvailability[]> {
    const libraryIds = user.isSuperuser ? null : await this.libraryService.findAccessibleLibraryIds(user);
    return this.dedupe.checkAvailability(queries, user.id, libraryIds);
  }

  getSummary(user: RequestUser): Promise<BookRequestSummary> {
    return this.summaryCache.get('book-request-summary', `${user.id}:${this.gateway.changeVersion}`, () => this.loadSummary(user));
  }

  private async loadSummary(user: RequestUser): Promise<BookRequestSummary> {
    const canManage = this.canManageAll(user);
    const [pending, active, mine, mineTotal, allTotal] = await Promise.all([
      canManage ? this.repo.countByStatuses(['pending']) : Promise.resolve(0),
      canManage ? this.repo.countByStatuses(OPEN_STATUSES) : Promise.resolve(0),
      this.repo.countForUser(user.id, OPEN_STATUSES),
      this.repo.countForUser(user.id, [], true),
      canManage ? this.repo.countByStatuses([], user.id) : Promise.resolve(0),
    ]);
    return { pending, active, mine, mineTotal, allTotal };
  }

  private async toItems(rows: BookRequestJoinedRow[], viewerId: number): Promise<BookRequestItem[]> {
    const ids = rows.map((r) => r.request.id);
    const [subscribers, downloads, dismissed] = await Promise.all([
      this.repo.findSubscribers(ids),
      this.downloads.findLatestForRequests(ids),
      this.repo.findDismissedRequestIds(viewerId, ids),
    ]);
    return rows.map((row) =>
      mapBookRequestRow(row, subscribers.get(row.request.id) ?? [], downloads.get(row.request.id) ?? null, dismissed.has(row.request.id)),
    );
  }

  private async toItem(row: BookRequestJoinedRow, viewerId: number): Promise<BookRequestItem> {
    const [item] = await this.toItems([row], viewerId);
    return item;
  }
}
