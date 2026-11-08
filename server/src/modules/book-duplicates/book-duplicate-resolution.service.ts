import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  AuditAction,
  AuditResource,
  BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS,
  BOOK_MERGE_MAX_BOOKS,
  Permission,
  allowedDuplicateActions,
  defaultDuplicateAction,
  recommendDuplicateKeeper,
  type BookDuplicateAction,
  type BookDuplicateBookAction,
  type BookDuplicateBookOutcome,
  type BookDuplicateGroupOutcome,
  type BookDuplicateKind,
  type BookDuplicatePermissions,
  type BookDuplicateResolutionEvent,
  type BookDuplicateResolutionJob,
  type BookDuplicateResolutionStartResponse,
  type BookDuplicateResolutionStatus,
} from '@bookorbit/types';

import { LibraryOperationGate, type LibraryOperationLease } from '../../common/services/library-operation-gate.service';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { BookDuplicateResolutionRow } from '../../db/schema';
import { AUDIT_EVENT, AuditEventsService, type AuditEventPayload } from '../audit/audit-events.service';
import { BookLinkService } from '../book-link/book-link.service';
import { BookMergeService } from '../book-merge/book-merge.service';
import { BookService } from '../book/book.service';
import { LibraryService } from '../library/library.service';
import { ScanGateway } from '../scanner/scan.gateway';
import { BookDuplicateResolutionRepository, type ResolutionGroupRow } from './book-duplicate-resolution.repository';
import { BookDuplicatesService } from './book-duplicates.service';
import type { BookDuplicateResolutionAllGroupsDto, CreateBookDuplicateResolutionDto } from './dto/book-duplicate.dto';

const EVENT = 'book_duplicates.resolve';
const ALL_GROUPS_BATCH_SIZE = 50;
const OUTCOME_FLUSH_EVERY = 25;
const MEMBER_LOOKUP_BATCH_SIZE = 5000;
const MERGE_SOURCES_PER_JOB = BOOK_MERGE_MAX_BOOKS - 1;

/** One group as decided when the run starts. Members are a snapshot: later groups may merge them away. */
export interface ResolutionDecision {
  groupId: number;
  kind: BookDuplicateKind | null;
  keeperId: number;
  action: BookDuplicateAction | null;
  perBook: Map<number, BookDuplicateBookAction>;
  memberIds: number[];
  skipReason: string | null;
}

interface RunContext {
  jobId: number;
  user: RequestUser;
  libraryIds: number[];
  lease: LibraryOperationLease;
  removeIdenticalCopies: boolean;
  /** Loser to keeper, for every merge of this run (H7). */
  mergedInto: Map<number, number>;
  deleted: Set<number>;
}

function permissionsOf(user: RequestUser): BookDuplicatePermissions {
  return {
    canDelete: user.isSuperuser || user.permissions.includes(Permission.LibraryDeleteBooks),
    canMerge: user.isSuperuser || user.permissions.includes(Permission.LibraryMergeBooks),
  };
}

function errorCodeOf(error: unknown, fallback: string): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null && typeof (response as { errorCode?: unknown }).errorCode === 'string') {
      return (response as { errorCode: string }).errorCode;
    }
    if (error instanceof ForbiddenException) return 'FORBIDDEN';
    if (error instanceof NotFoundException) return 'STALE';
  }
  return fallback;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/** A group's status from its copies' outcomes. */
export function groupStatus(books: BookDuplicateBookOutcome[]): Pick<BookDuplicateGroupOutcome, 'status' | 'reason'> {
  if (books.length === 0) return { status: 'skipped', reason: 'ALREADY_RESOLVED' };
  const succeeded = books.filter((book) => book.status === 'merged' || book.status === 'deleted' || book.status === 'linked').length;
  if (succeeded === books.length) return { status: 'done', reason: null };
  if (succeeded > 0) return { status: 'partial', reason: null };
  const reasons = [...new Set(books.map((book) => book.reason))];
  const reason = reasons.length === 1 ? (reasons[0] ?? null) : null;
  return { status: books.some((book) => book.status === 'failed') ? 'failed' : 'skipped', reason };
}

/**
 * Resolves many duplicate groups in one run (#2094). The library gate is held once for the whole run,
 * so no scan, move or other merge lands between two groups (H12); each group is checked against the
 * library just before it is acted on (H1), and a book merged by an earlier group resolves to its
 * keeper (H7).
 */
@Injectable()
export class BookDuplicateResolutionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BookDuplicateResolutionService.name);
  private readonly activeUsers = new Set<number>();

  constructor(
    private readonly repo: BookDuplicateResolutionRepository,
    private readonly duplicates: BookDuplicatesService,
    private readonly merges: BookMergeService,
    private readonly links: BookLinkService,
    private readonly books: BookService,
    private readonly gate: LibraryOperationGate,
    private readonly gateway: ScanGateway,
    private readonly auditEvents: AuditEventsService,
    private readonly libraries: LibraryService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.repo.markInterruptedFailed();
  }

  async start(dto: CreateBookDuplicateResolutionDto, user: RequestUser): Promise<BookDuplicateResolutionStartResponse> {
    if ((dto.groups?.length ?? 0) === 0 && !dto.allGroups) throw new BadRequestException('Choose at least one duplicate group');
    const permissions = permissionsOf(user);
    if (dto.removeIdenticalCopies && !permissions.canDelete)
      throw new ForbiddenException('Removing identical copies needs the delete-books permission');
    if (this.activeUsers.has(user.id)) throw this.inProgress(null);
    this.activeUsers.add(user.id);

    let started = false;
    try {
      const running = await this.repo.findRunningForUser(user.id);
      if (running) throw this.inProgress(running.id);
      const scan = await this.duplicates.findResolvableScan(dto.scanId, user);
      const { decisions, libraryIds } = await this.decide(dto, scan, user, permissions);
      const lease = this.gate.tryAcquireLease(libraryIds, 'book_merge');
      if (!lease) throw new ConflictException({ message: 'Another operation is running in this library.', errorCode: 'LIBRARY_BUSY' });

      let job: BookDuplicateResolutionRow;
      try {
        job = await this.repo.create({ userId: user.id, scanId: scan.id, total: decisions.length });
      } catch (error) {
        lease.release();
        throw error;
      }
      this.logger.log(
        `[${EVENT}] [start] jobId=${job.id} scanId=${scan.id} userId=${user.id} groups=${decisions.length} libraries=${libraryIds.join(',') || 'none'} removeIdenticalCopies=${dto.removeIdenticalCopies === true} - duplicate resolution started`,
      );
      started = true;
      void this.run(decisions, {
        jobId: job.id,
        user,
        libraryIds: scan.libraryIds,
        lease,
        removeIdenticalCopies: dto.removeIdenticalCopies === true,
        mergedInto: new Map(),
        deleted: new Set(),
      });
      return { jobId: job.id, total: decisions.length };
    } finally {
      if (!started) this.activeUsers.delete(user.id);
    }
  }

  async getJob(jobId: number, user: RequestUser): Promise<BookDuplicateResolutionJob> {
    const row = await this.repo.find(jobId);
    if (!row || row.userId !== user.id) throw new NotFoundException('Duplicate resolution not found');
    return this.toJob(row);
  }

  /** Every group's keeper, action and members, fixed before the run so a page the user never opened still resolves (H8). */
  private async decide(
    dto: CreateBookDuplicateResolutionDto,
    scan: { id: number; libraryIds: number[] },
    user: RequestUser,
    permissions: BookDuplicatePermissions,
  ): Promise<{ decisions: ResolutionDecision[]; libraryIds: number[] }> {
    const requested = dto.groups ?? [];
    const rows = new Map(
      (
        await this.repo.findGroups(
          scan.id,
          requested.map((group) => group.groupId),
        )
      ).map((row) => [row.id, row]),
    );
    const decisions: ResolutionDecision[] = requested.map((group) => {
      const row = rows.get(group.groupId);
      if (row) {
        this.assertAllowed(row.kind, group.action, permissions);
        for (const choice of group.perBook ?? []) if (choice.action !== 'skip') this.assertAllowed(row.kind, choice.action, permissions);
      }
      return {
        groupId: group.groupId,
        kind: row?.kind ?? null,
        keeperId: group.keeperId,
        action: group.action,
        perBook: new Map((group.perBook ?? []).map((choice) => [choice.bookId, choice.action])),
        memberIds: [],
        skipReason: row ? null : 'STALE',
      };
    });

    if (dto.allGroups) {
      decisions.push(
        ...(await this.decideAllGroups(dto.allGroups, scan, user, permissions, {
          excludeGroupIds: [...requested.map((group) => group.groupId), ...(dto.allGroups.excludeGroupIds ?? [])],
          room: BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS - decisions.length,
        })),
      );
    }

    const members = await this.repo.findMemberIds(
      scan.id,
      decisions.filter((decision) => decision.skipReason === null).map((decision) => decision.groupId),
    );
    const visible = new Map<number, number>();
    for (const ids of chunk([...new Set([...members.values()].flat())], MEMBER_LOOKUP_BATCH_SIZE)) {
      for (const book of await this.repo.findLiveBooks(ids, scan.libraryIds, user)) visible.set(book.id, book.libraryId);
    }
    const libraryIds = new Set<number>();
    for (const decision of decisions) {
      decision.memberIds = (members.get(decision.groupId) ?? []).filter((bookId) => visible.has(bookId));
      if (decision.action) for (const bookId of decision.memberIds) libraryIds.add(visible.get(bookId)!);
    }
    return { decisions, libraryIds: [...libraryIds].sort((a, b) => a - b) };
  }

  private async decideAllGroups(
    allGroups: BookDuplicateResolutionAllGroupsDto,
    scan: { id: number; libraryIds: number[] },
    user: RequestUser,
    permissions: BookDuplicatePermissions,
    limits: { excludeGroupIds: number[]; room: number },
  ): Promise<ResolutionDecision[]> {
    const kind = allGroups.kind ?? 'duplicate';
    if (allGroups.action) this.assertAllowed(kind, allGroups.action, permissions);
    const decisions: ResolutionDecision[] = [];
    const editable = new Map<number, Promise<boolean>>();
    const canEdit = (libraryId: number) => {
      if (!editable.has(libraryId)) {
        editable.set(
          libraryId,
          this.libraries.verifyAccessLevel(user, libraryId, 'editor').then(
            () => true,
            () => false,
          ),
        );
      }
      return editable.get(libraryId)!;
    };
    let afterGroupId = 0;
    while (decisions.length < limits.room) {
      const groups: ResolutionGroupRow[] = await this.repo.findResolvableGroups(
        scan.id,
        scan.libraryIds,
        user,
        { kind, reason: allGroups.reason, excludeGroupIds: limits.excludeGroupIds, afterGroupId },
        Math.min(ALL_GROUPS_BATCH_SIZE, limits.room - decisions.length),
      );
      if (groups.length === 0) break;
      const candidates = await this.duplicates.findCandidates(
        groups.map((group) => group.id),
        scan.libraryIds,
        user,
      );
      for (const group of groups) {
        const books = candidates.get(group.id) ?? [];
        const { keeperId } = recommendDuplicateKeeper({ books }, allGroups.keepRule);
        const action = allGroups.action ?? defaultDuplicateAction({ kind: group.kind, reasons: group.reasons, books }, keeperId, permissions);
        // Groups left with nothing to do stay out of the run, so they never fill its room and a rerun reaches the rest.
        if (!action || decisions.length >= limits.room) continue;
        if (action !== 'delete' && !(await this.allEditable(books, canEdit))) continue;
        decisions.push({ groupId: group.id, kind: group.kind, keeperId, action, perBook: new Map(), memberIds: [], skipReason: null });
      }
      afterGroupId = groups.at(-1)!.id;
    }
    return decisions;
  }

  /** Merge and link need editor access to every book's library; delete follows the delete permission alone. */
  private async allEditable(books: { libraryId: number }[], canEdit: (libraryId: number) => Promise<boolean>): Promise<boolean> {
    for (const libraryId of new Set(books.map((book) => book.libraryId))) if (!(await canEdit(libraryId))) return false;
    return true;
  }

  private assertAllowed(kind: BookDuplicateKind, action: BookDuplicateAction, permissions: BookDuplicatePermissions): void {
    if (allowedDuplicateActions(kind, permissions).includes(action)) return;
    if (action === 'delete' && kind !== 'duplicate') throw new BadRequestException('Books of another format are never deleted from this tool');
    throw new ForbiddenException(`The ${action} action needs a permission this account does not have`);
  }

  private async run(decisions: ResolutionDecision[], context: RunContext): Promise<void> {
    const startedAt = Date.now();
    const outcomes: BookDuplicateGroupOutcome[] = decisions.map((decision) => ({
      groupId: decision.groupId,
      keeperId: decision.keeperId,
      status: 'pending',
      reason: null,
      books: [],
    }));
    let status: BookDuplicateResolutionStatus = 'completed';
    let errorCode: string | null = null;
    let processed = 0;
    try {
      for (const [index, decision] of decisions.entries()) {
        await this.repo.update(context.jobId, { currentGroupId: decision.groupId });
        const outcome = await this.resolveGroup(decision, context);
        outcomes[index] = outcome;
        processed = index + 1;
        const flush = processed % OUTCOME_FLUSH_EVERY === 0;
        await this.repo.update(context.jobId, { processed, ...(flush ? { outcomes } : {}) });
        this.emit(context, 'progress', { status: 'running', processed, total: decisions.length, currentGroupId: decision.groupId, outcome });
      }
    } catch (error) {
      status = 'failed';
      errorCode = 'RESOLUTION_FAILED';
      const errorClass = error instanceof Error ? error.name : 'Error';
      this.logger.error(
        `[${EVENT}] [fail] jobId=${context.jobId} userId=${context.user.id} processed=${processed} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - duplicate resolution failed`,
      );
    } finally {
      context.lease.release();
      this.activeUsers.delete(context.user.id);
    }

    try {
      await this.repo.update(context.jobId, { status, processed, outcomes, errorCode, currentGroupId: null, finishedAt: new Date() });
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      this.logger.error(
        `[${EVENT}] [fail] jobId=${context.jobId} userId=${context.user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - duplicate resolution result not saved`,
      );
    }
    this.emit(context, 'finished', { status, processed, total: decisions.length, currentGroupId: null, outcome: null });
    if (status === 'completed') {
      const count = (wanted: BookDuplicateGroupOutcome['status']) => outcomes.filter((outcome) => outcome.status === wanted).length;
      this.logger.log(
        `[${EVENT}] [end] jobId=${context.jobId} userId=${context.user.id} groups=${decisions.length} done=${count('done')} partial=${count('partial')} skipped=${count('skipped')} failed=${count('failed')} durationMs=${Date.now() - startedAt} - duplicate resolution completed`,
      );
    }
  }

  private resolveId(bookId: number, mergedInto: Map<number, number>): number {
    let current = bookId;
    const seen = new Set<number>();
    while (mergedInto.has(current) && !seen.has(current)) {
      seen.add(current);
      current = mergedInto.get(current)!;
    }
    return current;
  }

  /** One group, re-checked against the library as it is now. Never throws for a group's own failure. */
  async resolveGroup(decision: ResolutionDecision, context: RunContext): Promise<BookDuplicateGroupOutcome> {
    const outcome = (
      keeperId: number | null,
      status: BookDuplicateGroupOutcome['status'],
      reason: string | null,
      books: BookDuplicateBookOutcome[] = [],
    ) => ({
      groupId: decision.groupId,
      keeperId,
      status,
      reason,
      books,
    });
    if (decision.skipReason) return outcome(decision.keeperId, 'skipped', decision.skipReason);
    if (!decision.action) return outcome(decision.keeperId, 'skipped', 'NO_ACTION');
    if (!decision.memberIds.includes(decision.keeperId)) return outcome(decision.keeperId, 'skipped', 'KEEPER_MISSING');

    const keeperId = this.resolveId(decision.keeperId, context.mergedInto);
    const others = new Map<number, number>();
    for (const memberId of decision.memberIds) {
      const resolved = this.resolveId(memberId, context.mergedInto);
      if (resolved !== keeperId && !others.has(resolved)) others.set(resolved, memberId);
    }

    const live = new Map(
      (await this.repo.findLiveBooks([keeperId, ...others.keys()], context.libraryIds, context.user)).map((book) => [book.id, book]),
    );
    const keeper = live.get(keeperId);
    if (!keeper || keeper.status !== 'present' || context.deleted.has(keeperId)) return outcome(keeperId, 'skipped', 'KEEPER_MISSING');

    const books: BookDuplicateBookOutcome[] = [];
    const buckets: Record<BookDuplicateAction, number[]> = { merge: [], link: [], delete: [] };
    for (const [bookId, memberId] of others) {
      const action = decision.perBook.get(memberId) ?? decision.perBook.get(bookId) ?? decision.action;
      if (action === 'skip') books.push({ bookId, action, status: 'skipped', reason: 'NOT_SELECTED' });
      else if (!live.has(bookId) || context.deleted.has(bookId)) books.push({ bookId, action, status: 'skipped', reason: 'STALE' });
      else buckets[action].push(bookId);
    }

    for (const sources of chunk(buckets.merge, MERGE_SOURCES_PER_JOB)) books.push(...(await this.merge(keeperId, sources, context)));
    if (buckets.link.length > 0) books.push(...(await this.link(keeperId, buckets.link, context)));
    if (buckets.delete.length > 0) books.push(...(await this.delete(decision.groupId, buckets.delete, context)));

    books.sort((a, b) => a.bookId - b.bookId);
    const { status, reason } = groupStatus(books);
    if (status === 'failed' || status === 'partial') {
      this.logger.warn(
        `[${EVENT}] [fail] jobId=${context.jobId} groupId=${decision.groupId} keeperId=${keeperId} status=${status} reasons=${[...new Set(books.map((book) => book.reason).filter(Boolean))].join(',')} - duplicate group not fully resolved`,
      );
    }
    return outcome(keeperId, status, reason, books);
  }

  private async merge(keeperId: number, sourceIds: number[], context: RunContext): Promise<BookDuplicateBookOutcome[]> {
    const failed = (reason: string, status: 'failed' | 'skipped' = 'failed') =>
      sourceIds.map((bookId): BookDuplicateBookOutcome => ({ bookId, action: 'merge', status, reason }));
    try {
      const result = await this.merges.mergeWithinLease(
        { targetBookId: keeperId, sourceBookIds: sourceIds, deleteIdenticalCopies: context.removeIdenticalCopies },
        context.user,
        context.lease,
      );
      if (result.status === 'blocked') return failed(result.blockers[0]?.code ?? result.errorCode ?? 'MERGE_BLOCKED', 'skipped');
      const bySource = new Map(result.outcomes.map((entry) => [entry.sourceBookId, entry]));
      const merged = sourceIds.filter((bookId) => bySource.get(bookId)?.status === 'merged');
      if (merged.length > 0) {
        this.audit(context, AuditAction.BookMerge, keeperId, `Merged books ${merged.join(', ')} into book #${keeperId}`, {
          targetBookId: keeperId,
          sourceBookIds: merged,
          jobId: result.jobId,
        });
      }
      return sourceIds.map((bookId): BookDuplicateBookOutcome => {
        const entry = bySource.get(bookId);
        if (entry?.status === 'merged') {
          context.mergedInto.set(bookId, keeperId);
          return { bookId, action: 'merge', status: 'merged', reason: null };
        }
        return { bookId, action: 'merge', status: 'failed', reason: entry?.errorCode ?? result.errorCode ?? 'MERGE_FAILED' };
      });
    } catch (error) {
      return failed(errorCodeOf(error, 'MERGE_FAILED'));
    }
  }

  private async link(keeperId: number, bookIds: number[], context: RunContext): Promise<BookDuplicateBookOutcome[]> {
    try {
      const group = await this.links.link({ bookIds: [keeperId, ...bookIds] }, context.user);
      this.audit(context, AuditAction.BookLink, keeperId, `Linked books ${[keeperId, ...bookIds].join(', ')}`, {
        bookIds: [keeperId, ...bookIds],
        groupId: group.groupId,
      });
      return bookIds.map((bookId) => ({ bookId, action: 'link', status: 'linked', reason: null }));
    } catch (error) {
      const reason = errorCodeOf(error, 'LINK_FAILED');
      return bookIds.map((bookId) => ({ bookId, action: 'link', status: 'failed', reason }));
    }
  }

  private async delete(groupId: number, bookIds: number[], context: RunContext): Promise<BookDuplicateBookOutcome[]> {
    try {
      const deleted = await this.books.deleteBooks(bookIds, context.user);
      this.audit(
        context,
        AuditAction.BookBulkDelete,
        deleted.total === 1 ? deleted.books[0]?.id : undefined,
        deleted.total === 1 && deleted.books[0]?.title
          ? `Deleted "${deleted.books[0].title}" (#${deleted.books[0].id})`
          : `Deleted ${deleted.total} books`,
        { total: deleted.total, books: deleted.books, omitted: deleted.omitted },
      );
      for (const bookId of bookIds) context.deleted.add(bookId);
      return bookIds.map((bookId) => ({ bookId, action: 'delete', status: 'deleted', reason: null }));
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      this.logger.warn(
        `[${EVENT}] [fail] jobId=${context.jobId} groupId=${groupId} count=${bookIds.length} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - duplicate copies not deleted`,
      );
      const reason = errorCodeOf(error, 'DELETE_FAILED');
      return bookIds.map((bookId) => ({ bookId, action: 'delete', status: 'failed', reason }));
    }
  }

  /** Each change is recorded as the endpoint that makes it alone would record it, tied to this run. */
  private audit(context: RunContext, action: AuditAction, resourceId: number | undefined, description: string, meta: Record<string, unknown>): void {
    const payload: AuditEventPayload = {
      userId: context.user.id,
      actorUsername: context.user.username,
      action,
      resource: AuditResource.Book,
      resourceId,
      description,
      meta: { ...meta, duplicateResolutionJobId: context.jobId },
    };
    this.auditEvents.emit(AUDIT_EVENT, payload);
  }

  private emit(context: RunContext, phase: 'progress' | 'finished', event: Omit<BookDuplicateResolutionEvent, 'jobId'>): void {
    this.gateway.emitDuplicateResolution(context.user.id, phase, { jobId: context.jobId, ...event });
  }

  private inProgress(jobId: number | null): ConflictException {
    return new ConflictException({
      message: 'A duplicate resolution is already running.',
      errorCode: 'RESOLUTION_IN_PROGRESS',
      ...(jobId === null ? {} : { errorMeta: { jobId } }),
    });
  }

  private toJob(row: BookDuplicateResolutionRow): BookDuplicateResolutionJob {
    return {
      id: row.id,
      scanId: row.scanId,
      status: row.status as BookDuplicateResolutionStatus,
      processed: row.processed,
      total: row.total,
      currentGroupId: row.currentGroupId,
      outcomes: row.outcomes as BookDuplicateGroupOutcome[],
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}
