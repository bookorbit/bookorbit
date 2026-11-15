import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Permission, type JobActionKind, type JobCounts, type JobStatus, type JobSubject } from '@bookorbit/types';

import { LibraryScopeService } from '../../common/library-scope/library-scope.service';
import type { RequestUser } from '../../common/types/request-user';
import type {
  JobAccess,
  JobOwnerFilter,
  JobSource,
  JobViewer,
  SourceActionResult,
  SourceCountQuery,
  SourceItem,
  SourceListQuery,
  SourceRow,
} from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { ScanJobStore } from './scan-job-store.service';
import { ScannerRepository, type ScanJobPageRow } from './scanner.repository';

export const LIBRARY_SCAN_FAILED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_SERIAL = 2_147_483_647;
const NO_COUNTS: JobCounts = { queue: 0, needsYou: 0, failed: 0, running: 0, queued: 0, paused: 0 };

export interface LibraryScanJobRow extends SourceRow {
  job: ScanJobPageRow;
}

/** Scans belong to no account. Whoever manages libraries or the server sees them, in the libraries they can reach. */
export function managesScans(user: RequestUser): boolean {
  return (
    user.active &&
    (user.isSuperuser || user.permissions.includes(Permission.ManageLibraries) || user.permissions.includes(Permission.ManageAppSettings))
  );
}

function status(row: Pick<ScanJobPageRow, 'status'>): JobStatus {
  switch (row.status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    default:
      return 'failed';
  }
}

/** A read of one account's own rows that leaves out the ownerless ones holds no scans. */
function coversOwnerless(owner: JobOwnerFilter): boolean {
  return owner === null || owner.ownerless;
}

function serialId(id: string): number | null {
  if (!/^[1-9][0-9]{0,9}$/.test(id)) return null;
  const value = Number(id);
  return value <= MAX_SERIAL ? value : null;
}

/**
 * Library scans in the Jobs area. Several run at once, one per library, and none ever queues, so the
 * Queue holds running scans only. Starting a scan again is the retry, from the library page, so no
 * row offers an action. Error text can name server paths and stays on the library page.
 */
@Injectable()
export class LibraryScanJobSource implements JobSource<LibraryScanJobRow>, OnModuleInit {
  readonly type = 'library-scan' as const;
  readonly failedWindowMs = LIBRARY_SCAN_FAILED_WINDOW_MS;

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly scans: ScannerRepository,
    private readonly store: ScanJobStore,
    private readonly scope: LibraryScopeService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  access(user: RequestUser): JobAccess {
    return { own: false, all: managesScans(user) };
  }

  async list(query: SourceListQuery, viewer: JobViewer): Promise<LibraryScanJobRow[]> {
    if (!viewer.access.all || !coversOwnerless(query.owner)) return [];
    const rows = await this.scans.pageForJobs({
      view: query.view,
      libraryIds: await this.scope.visibleIdsOrAll(viewer.user),
      cutoffAt: query.cutoffAt,
      after: query.after,
      typeIndex: query.typeIndex,
      limit: query.limit,
    });
    return rows.map((job) => ({ nativeId: String(job.id), key: job.key, job, item: this.item(job) }));
  }

  async counts(query: SourceCountQuery, viewer: JobViewer): Promise<JobCounts> {
    if (!viewer.access.all || !coversOwnerless(query.owner)) return { ...NO_COUNTS };
    const { running, failed } = await this.scans.countForJobs(await this.scope.visibleIdsOrAll(viewer.user), query.cutoffAt);
    return { ...NO_COUNTS, queue: running, running, failed };
  }

  async describe(rows: LibraryScanJobRow[]): Promise<Map<string, JobSubject>> {
    const names = await this.scans.findLibraryNames([...new Set(rows.map((row) => row.job.libraryId))]);
    const subjects = new Map<string, JobSubject>();
    for (const row of rows) {
      const name = names.get(row.job.libraryId);
      if (name !== undefined) subjects.set(row.nativeId, { label: name, byline: null, url: `/library/${row.job.libraryId}`, image: null });
    }
    return subjects;
  }

  actions(): { actions: JobActionKind[]; note: string | null } {
    return { actions: [], note: null };
  }

  /** No action applies to a scan. A scan in a library the viewer cannot reach reads as missing. */
  async act(_action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const ids = [...new Set(nativeIds.map(serialId).filter((id): id is number => id !== null))];
    const found = viewer.access.all ? await this.scans.findScanJobsByIds(ids) : [];
    const visible = new Set(await this.scope.filterVisible(viewer.user, [...new Set(found.map((row) => row.libraryId))]));
    const rows = new Map(found.filter((row) => visible.has(row.libraryId)).map((row) => [String(row.id), row]));
    return nativeIds.map((id) => {
      const row = rows.get(id);
      return row ? { id, outcome: 'skipped', status: status(row) } : { id, outcome: 'not-found', status: null };
    });
  }

  private item(job: ScanJobPageRow): SourceItem {
    const running = job.status === 'running';
    const live = running ? this.store.get(job.libraryId) : undefined;
    // Added and updated stay 0 until a scan finishes, so a running scan shows the files it has read.
    const progress = live && live.jobId === job.id && live.total > 0 ? live : null;
    return {
      kind: job.triggeredBy,
      shape: 'job',
      status: status(job),
      reason: job.status === 'failed' ? 'error' : null,
      phase: null,
      done: progress ? progress.processed : null,
      total: progress ? progress.total : null,
      percent: null,
      position: null,
      requester: null,
      cost: null,
      createdAt: job.startedAt.toISOString(),
      startedAt: running ? job.startedAt.toISOString() : null,
      pausedAt: null,
      finishedAt: running ? null : (job.completedAt ?? job.startedAt).toISOString(),
      extra: null,
    };
  }
}
