import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuditAction, AuditResource, BULK_RUN_ID_HEADER, BULK_RUN_MAX_UNFINISHED, Permission, type BulkRunKind } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { apiKeyCredentialOf } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';
import { AUDIT_EVENT, AuditEventsService } from '../audit/audit-events.service';
import { JobChangesService } from '../jobs/job-changes.service';
import { BulkRunDispatcher } from './bulk-run-dispatcher.service';
import { BulkRunHandlerRegistry } from './bulk-run-handler.registry';
import { BulkRunStreams, type BulkRunSink } from './bulk-run-streams.service';
import { BulkRunsRepository } from './bulk-runs.repository';

const SETTLED = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

export interface BulkRunAudit {
  action: AuditAction;
  resource: AuditResource;
  /** Says what was done to how many, from the resolved count. */
  description: (count: number) => string;
  meta?: Record<string, unknown>;
}

export interface StartBulkRun {
  kind: BulkRunKind;
  /** The resolved, authorized selection; duplicates are dropped and the order is kept. */
  subjectIds: readonly number[];
  options?: Record<string, unknown>;
  actor: RequestUser;
  audit: BulkRunAudit;
}

/** Whether `user` may cancel another account's run: those who see everyone's runs in Jobs. */
export function managesBulkRuns(user: RequestUser): boolean {
  return user.active && (user.isSuperuser || user.permissions.includes(Permission.ManageAppSettings));
}

/**
 * Creates bulk runs for the bulk routes and follows them over the route's event stream. A run is
 * worked by `BulkRunDispatcher` whether or not anyone follows it.
 */
@Injectable()
export class BulkRunsService {
  private readonly logger = new Logger(BulkRunsService.name);

  constructor(
    private readonly repo: BulkRunsRepository,
    private readonly handlers: BulkRunHandlerRegistry,
    private readonly streams: BulkRunStreams,
    private readonly dispatcher: BulkRunDispatcher,
    private readonly jobChanges: JobChangesService,
    private readonly auditEvents: AuditEventsService,
  ) {}

  /**
   * Creates the run, records it in the audit log and answers with its event stream, the run's id
   * in the `X-Bulk-Run-Id` header. Refusals (too many runs) answer before the stream starts. An
   * empty selection creates nothing and answers at once with the kind's empty `done`.
   */
  async startAndStream(reply: FastifyReply, input: StartBulkRun): Promise<void> {
    const handler = this.handlers.get(input.kind);
    if (!handler) throw new Error(`No handler for bulk run kind ${input.kind}`);
    const ids = [...new Set(input.subjectIds)];
    if (ids.length === 0) {
      reply.raw.writeHead(200, this.headers(null));
      reply.raw.write(`data: ${JSON.stringify(handler.doneEvent(this.emptyRun(input)))}\n\n`);
      reply.raw.end();
      return;
    }
    const run = await this.create({ ...input, subjectIds: ids }, reply.request?.ip ?? null);
    await this.follow(reply, run);
  }

  async create(input: StartBulkRun, ip: string | null): Promise<BulkRunRow> {
    const ids = [...new Set(input.subjectIds)];
    const credential = apiKeyCredentialOf(input.actor);
    const run = await this.repo.insertWithinLimit(
      {
        kind: input.kind,
        requestedBy: input.actor.id,
        credentialKind: credential ? 'api_key' : 'session',
        apiKeyId: credential?.keyId ?? null,
        subjectIds: ids,
        options: input.options ?? {},
        total: ids.length,
        actorUsername: input.actor.username,
        actorIp: ip,
      },
      BULK_RUN_MAX_UNFINISHED,
    );
    if (!run) {
      throw new HttpException(
        `You already have ${BULK_RUN_MAX_UNFINISHED} bulk actions waiting or running. Wait for one to finish, or cancel one in Jobs.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.auditEvents.emit(AUDIT_EVENT, {
      userId: input.actor.id,
      actorUsername: input.actor.username,
      action: input.audit.action,
      resource: input.audit.resource,
      description: input.audit.description(ids.length),
      ...(ip ? { ip } : {}),
      meta: { bulkRunId: run.id, count: ids.length, ...(input.audit.meta ?? {}) },
      ...(credential ? { apiKeyId: credential.keyId } : {}),
    });
    this.logger.log(
      `[bulk_run.create] [end] runId=${run.id} kind=${run.kind} userId=${input.actor.id} credential=${run.credentialKind} count=${ids.length} - bulk run queued`,
    );
    this.jobChanges.notify({ type: 'bulk-run', ownerId: input.actor.id, state: true });
    this.dispatcher.wake();
    return run;
  }

  /** Cancels a waiting run at once, or asks a running one to stop before its next item. */
  async cancel(runId: string, viewer: RequestUser): Promise<BulkRunRow> {
    const run = await this.readable(runId, viewer);
    if (run.requestedBy !== viewer.id && !managesBulkRuns(viewer)) throw new ForbiddenException('Only the person who started this can cancel it.');
    if (run.status !== 'queued' && run.status !== 'running') throw new ConflictException('This run already ended.');
    const updated = await this.dispatcher.cancel(run.id);
    if (!updated) throw new ConflictException('This run already ended.');
    if (run.requestedBy !== viewer.id) {
      this.auditEvents.emit(AUDIT_EVENT, {
        userId: viewer.id,
        actorUsername: viewer.username,
        action: AuditAction.BulkRunCancel,
        description: `Cancelled another account's bulk ${run.kind} run of ${run.total} items`,
        meta: { bulkRunId: run.id, kind: run.kind, requestedBy: run.requestedBy },
      });
    }
    return updated;
  }

  /** Returns an interrupted run to the line; it resumes where it stopped. */
  async continueRun(runId: string, viewer: RequestUser): Promise<BulkRunRow> {
    const run = await this.readable(runId, viewer);
    if (run.requestedBy !== viewer.id && !viewer.isSuperuser) throw new ForbiddenException('Only the person who started this can continue it.');
    if (run.status !== 'interrupted' || run.dismissedAt) throw new ConflictException('Only an interrupted run can continue.');
    const handler = this.handlers.get(run.kind);
    if (handler?.continuable && !handler.continuable(run))
      throw new ConflictException('This run can continue once the server finishes checking its libraries.');
    const updated = await this.repo.continueWithinLimit(run.id, run.requestedBy, BULK_RUN_MAX_UNFINISHED);
    if (updated === 'limit') {
      throw new HttpException(`You already have ${BULK_RUN_MAX_UNFINISHED} bulk actions waiting or running.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!updated) throw new ConflictException('Only an interrupted run can continue.');
    this.jobChanges.notify({ type: 'bulk-run', ownerId: updated.requestedBy, state: true });
    this.dispatcher.wake();
    return updated;
  }

  /** Moves a failed or interrupted run out of Failed. */
  async dismiss(runId: string, viewer: RequestUser): Promise<BulkRunRow> {
    const run = await this.readable(runId, viewer);
    if (run.requestedBy !== viewer.id && !managesBulkRuns(viewer)) throw new ForbiddenException('Only the person who started this can dismiss it.');
    const updated = await this.repo.dismiss(run.id);
    if (!updated) throw new ConflictException('Only a failed or interrupted run can be dismissed.');
    this.jobChanges.notify({ type: 'bulk-run', ownerId: updated.requestedBy, state: true });
    return updated;
  }

  /** A run its requester or a manager may read; anyone else cannot tell it from a missing one. */
  private async readable(runId: string, viewer: RequestUser): Promise<BulkRunRow> {
    const run = await this.repo.findById(runId);
    if (!run || (run.requestedBy !== viewer.id && !managesBulkRuns(viewer))) throw new NotFoundException('Bulk run not found');
    return run;
  }

  /** Follows the run until it settles or the client leaves; leaving never stops the run. */
  private async follow(reply: FastifyReply, run: BulkRunRow): Promise<void> {
    const handler = this.handlers.get(run.kind)!;
    reply.raw.writeHead(200, this.headers(run.id));
    // A waiting run writes nothing for a while, but the client needs the run id now. Proxies hold
    // headers back until the first body bytes, so an SSE comment, which readers skip, goes first.
    reply.raw.write(': open\n\n');
    await new Promise<void>((resolve) => {
      let open = true;
      const sink: BulkRunSink = {
        write: (event) => {
          if (!open || reply.raw.destroyed || reply.raw.writableEnded) return false;
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
          return true;
        },
        end: () => {
          if (open && !reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
          leave();
        },
      };
      const leave = () => {
        if (!open) return;
        open = false;
        reply.raw.off('close', leave);
        reply.raw.off('aborted', leave);
        this.streams.detach(run.id, sink);
        resolve();
      };
      reply.raw.on('close', leave);
      reply.raw.on('aborted', leave);
      this.streams.attach(run.id, sink);
      // A short run can settle before the stream attached; answer from the row then.
      void this.repo
        .findById(run.id)
        .then((latest) => {
          if (latest && SETTLED.has(latest.status) && open) {
            if (latest.status !== 'failed' && latest.status !== 'interrupted') sink.write(handler.doneEvent(latest));
            sink.end();
          }
        })
        .catch(() => undefined);
    });
  }

  private headers(runId: string | null): Record<string, string> {
    return {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(runId ? { [BULK_RUN_ID_HEADER]: runId, 'Access-Control-Expose-Headers': BULK_RUN_ID_HEADER } : {}),
    };
  }

  private emptyRun(input: StartBulkRun): BulkRunRow {
    const now = new Date();
    return {
      id: '00000000-0000-0000-0000-000000000000',
      kind: input.kind,
      requestedBy: input.actor.id,
      credentialKind: 'session',
      apiKeyId: null,
      status: 'completed',
      subjectIds: [],
      options: input.options ?? {},
      total: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      stats: {},
      failures: [],
      errorCode: null,
      error: null,
      cancelRequested: false,
      actorUsername: input.actor.username,
      actorIp: null,
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      dismissedAt: null,
    };
  }
}
