import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { Permission, type JobActionKind, type JobCounts, type JobStatus, type JobSubject } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { BulkRunRow } from '../../db/schema';
import type { JobAccess, JobSource, JobViewer, SourceActionResult, SourceCountQuery, SourceListQuery, SourceRow } from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { BulkRunHandlerRegistry } from './bulk-run-handler.registry';
import { BulkRunsRepository, type BulkRunPageRow } from './bulk-runs.repository';
import { BulkRunsService } from './bulk-runs.service';

/** A failed or interrupted run stays in Failed this long, and an interrupted one can continue until then. */
export const BULK_RUN_FAILED_VISIBLE_MS = 30 * 24 * 60 * 60 * 1000;

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type RunState = Pick<BulkRunRow, 'status' | 'dismissedAt' | 'cancelRequested' | 'requestedBy'>;

export interface BulkRunJobRow extends SourceRow {
  run: BulkRunPageRow;
}

function statusOf(run: Pick<BulkRunRow, 'status'>): JobStatus {
  switch (run.status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'failed';
  }
}

function reasonOf(run: Pick<BulkRunRow, 'status' | 'errorCode'>): string | null {
  if (run.status === 'interrupted') return 'interrupted';
  if (run.status === 'failed') return run.errorCode ?? 'error';
  return null;
}

function isRequester(run: Pick<BulkRunRow, 'requestedBy'>, user: RequestUser): boolean {
  return run.requestedBy !== null && run.requestedBy === user.id;
}

/** The actions the run's state allows, before who is asking is considered. */
function stateAllows(run: RunState, action: JobActionKind): boolean {
  switch (action) {
    case 'cancel':
      return run.status === 'queued' || (run.status === 'running' && !run.cancelRequested);
    case 'continue':
      return run.status === 'interrupted' && run.dismissedAt === null;
    case 'dismiss':
      return (run.status === 'failed' || run.status === 'interrupted') && run.dismissedAt === null;
    default:
      return false;
  }
}

/** Continue belongs to whoever started the run, or a superuser; cancel and dismiss also to those who manage everyone's runs. */
function viewerMay(viewer: JobViewer, run: RunState, action: JobActionKind): boolean {
  if (action === 'continue') return isRequester(run, viewer.user) || viewer.user.isSuperuser;
  return isRequester(run, viewer.user) || viewer.access.all;
}

/**
 * Bulk actions in the Jobs area: refreshing metadata, re-extracting or embedding covers, refreshing
 * authors and moving books. Each account's runs wait in their own line and accounts take turns, so a
 * waiting run shows its place in its account's line.
 */
@Injectable()
export class BulkRunJobSource implements JobSource<BulkRunJobRow>, OnModuleInit {
  readonly type = 'bulk-run' as const;
  readonly failedWindowMs = BULK_RUN_FAILED_VISIBLE_MS;
  private readonly logger = new Logger(BulkRunJobSource.name);

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly runs: BulkRunsRepository,
    private readonly service: BulkRunsService,
    private readonly handlers: BulkRunHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  access(user: RequestUser): JobAccess {
    return {
      own: user.active && (user.isSuperuser || user.permissions.includes(Permission.LibraryEditMetadata)),
      all: user.active && (user.isSuperuser || user.permissions.includes(Permission.ManageAppSettings)),
    };
  }

  async list(query: SourceListQuery): Promise<BulkRunJobRow[]> {
    const rows = await this.runs.pageForJobs({
      view: query.view,
      owner: query.owner,
      cutoffAt: query.cutoffAt,
      after: query.after,
      typeIndex: query.typeIndex,
      limit: query.limit,
    });
    return rows.map((run) => {
      const status = statusOf(run);
      const settled = status !== 'queued' && status !== 'running';
      return {
        nativeId: run.id,
        key: run.key,
        run,
        item: {
          kind: run.kind,
          shape: 'job',
          status,
          reason: reasonOf(run),
          phase: status === 'running' && run.cancelRequested ? 'cancelling' : null,
          done: run.processed,
          total: run.total,
          percent: null,
          position: status === 'queued' && run.rank > 0 ? run.rank : null,
          requester: run.requestedBy === null ? null : { id: run.requestedBy, name: run.requesterName ?? '' },
          cost: null,
          createdAt: run.createdAt.toISOString(),
          startedAt: status === 'queued' ? null : (run.startedAt?.toISOString() ?? null),
          pausedAt: null,
          finishedAt: settled ? (run.finishedAt?.toISOString() ?? null) : null,
          extra: run.failed > 0 ? { failed: run.failed } : null,
        },
      };
    });
  }

  async counts(query: SourceCountQuery): Promise<JobCounts> {
    const counts = await this.runs.countForJobs(query.owner, query.cutoffAt);
    return { queue: counts.running + counts.queued, needsYou: 0, failed: counts.failed, running: counts.running, queued: counts.queued, paused: 0 };
  }

  /** A run has no single subject; the page names it by its kind. */
  describe(): Promise<Map<string, JobSubject>> {
    return Promise.resolve(new Map());
  }

  actions(row: BulkRunJobRow, viewer: JobViewer): { actions: JobActionKind[]; note: string | null } {
    const actions = (['cancel', 'continue', 'dismiss'] as const).filter(
      (action) => stateAllows(row.run, action) && viewerMay(viewer, row.run, action),
    );
    if (actions.includes('continue')) {
      const handler = this.handlers.get(row.run.kind);
      if (handler?.continuable && !handler.continuable(row.run)) {
        return { actions: actions.filter((action) => action !== 'continue'), note: 'bulk-run-continue-later' };
      }
    }
    return { actions: [...actions], note: null };
  }

  async act(action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const ids = [...new Set(nativeIds.filter((id) => RUN_ID.test(id)))];
    const rows = new Map((await this.runs.findByIds(ids)).map((row) => [row.id, row]));
    const results = new Map<string, SourceActionResult>();
    for (const id of new Set(nativeIds)) results.set(id, await this.actOn(action, id, rows.get(id) ?? null, viewer));
    return nativeIds.map((id) => results.get(id)!);
  }

  private async actOn(action: JobActionKind, id: string, row: RunState | null, viewer: JobViewer): Promise<SourceActionResult> {
    // Another account's run reads the same as a missing one to a viewer who does not manage runs.
    if (!row || !(viewer.access.all || isRequester(row, viewer.user))) return { id, outcome: 'not-found', status: null };
    const result = (outcome: SourceActionResult['outcome'], run: RunState = row): SourceActionResult => ({ id, outcome, status: statusOf(run) });
    if (!stateAllows(row, action)) return result('skipped');
    if (!viewerMay(viewer, row, action)) return result('refused');
    try {
      switch (action) {
        case 'cancel':
          return result('done', await this.service.cancel(id, viewer.user));
        case 'continue':
          return result('done', await this.service.continueRun(id, viewer.user));
        case 'dismiss':
          return result('done', await this.service.dismiss(id, viewer.user));
        default:
          return result('skipped');
      }
    } catch (error) {
      if (error instanceof ForbiddenException) return result('refused');
      if (error instanceof NotFoundException) return { id, outcome: 'not-found', status: null };
      if (error instanceof ConflictException) return result('skipped', (await this.runs.findById(id)) ?? row);
      if (error instanceof HttpException && error.getStatus() === Number(HttpStatus.TOO_MANY_REQUESTS)) return result('refused');
      this.logger.warn(
        `[bulk_run.jobs_action] [fail] runId=${id} action=${action} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - bulk run job action failed`,
      );
      return result('error');
    }
  }
}
