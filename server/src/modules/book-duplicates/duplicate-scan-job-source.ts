import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Permission, type JobActionKind, type JobCounts, type JobStatus, type JobSubject } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { JobAccess, JobSource, JobViewer, SourceActionResult, SourceCountQuery, SourceListQuery, SourceRow } from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { LibraryService } from '../library/library.service';
import { BookDuplicatesRepository, type DuplicateScanPageRow } from './book-duplicates.repository';

/** Failed scans stay in Failed this long; nothing retries them, so after that they are history. */
export const DUPLICATE_SCAN_FAILED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Where a person reviews their own scan's results. */
const DUPLICATE_BOOKS_URL = '/tools/duplicate-books';

const STATUSES = new Set<string>(['queued', 'running', 'completed', 'failed']);

export interface DuplicateScanJobRow extends SourceRow {
  scan: DuplicateScanPageRow;
}

/** Whoever may start a duplicate scan, by the controller's own rule. */
function mayScan(user: RequestUser): boolean {
  return (
    user.active &&
    (user.isSuperuser || user.permissions.includes(Permission.LibraryDeleteBooks) || user.permissions.includes(Permission.LibraryMergeBooks))
  );
}

function status(row: Pick<DuplicateScanPageRow, 'status'>): JobStatus {
  return STATUSES.has(row.status) ? (row.status as JobStatus) : 'failed';
}

/** `processedBooks` is a stage percentage of `totalBooks`, never a count of books done. */
function percent(row: Pick<DuplicateScanPageRow, 'processedBooks' | 'totalBooks'>): number | null {
  if (row.totalBooks === null || row.totalBooks <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((row.processedBooks / row.totalBooks) * 100)));
}

/**
 * Duplicate-book scans in the Jobs area. One in-memory worker runs every account's scans oldest
 * first, so a queued scan has a place in one line. Results open on the duplicate-books tool, which
 * only ever shows the viewer's own scan; nothing here can be acted on.
 */
@Injectable()
export class DuplicateScanJobSource implements JobSource<DuplicateScanJobRow>, OnModuleInit {
  readonly type = 'duplicate-scan' as const;
  readonly failedWindowMs = DUPLICATE_SCAN_FAILED_WINDOW_MS;

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly scans: BookDuplicatesRepository,
    private readonly libraries: LibraryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  access(user: RequestUser): JobAccess {
    return { own: mayScan(user), all: user.active && (user.isSuperuser || user.permissions.includes(Permission.ManageAppSettings)) };
  }

  async list(query: SourceListQuery): Promise<DuplicateScanJobRow[]> {
    const rows = await this.scans.pageForJobs({
      view: query.view,
      ownerId: query.owner?.id ?? null,
      cutoffAt: query.cutoffAt,
      after: query.after,
      typeIndex: query.typeIndex,
      limit: query.limit,
    });
    return rows.map((scan) => {
      const mapped = status(scan);
      return {
        nativeId: String(scan.id),
        key: scan.key,
        scan,
        item: {
          kind: scan.requestedLibraryId === null ? 'all-libraries' : 'library',
          shape: 'job',
          status: mapped,
          reason: mapped === 'failed' ? scan.errorCode : null,
          phase: null,
          done: null,
          total: null,
          percent: mapped === 'running' ? percent(scan) : null,
          position: mapped === 'queued' && scan.rank > 0 ? scan.rank : null,
          requester: { id: scan.userId, name: scan.requesterName ?? '' },
          cost: null,
          createdAt: scan.createdAt.toISOString(),
          // Scans record no start time; the queue runs them so soon after they are asked for that creation stands in.
          startedAt: mapped === 'running' ? scan.createdAt.toISOString() : null,
          pausedAt: null,
          finishedAt: mapped === 'completed' || mapped === 'failed' ? (scan.completedAt ?? scan.createdAt).toISOString() : null,
          extra: null,
        },
      };
    });
  }

  async counts(query: SourceCountQuery): Promise<JobCounts> {
    const counts = await this.scans.countForJobs(query.owner?.id ?? null, query.cutoffAt);
    return { queue: counts.queue, needsYou: 0, failed: counts.failed, running: counts.running, queued: counts.queued, paused: 0 };
  }

  /** Names the libraries each scan covered, leaving out any the viewer can no longer reach. */
  async describe(rows: DuplicateScanJobRow[], viewer: JobViewer): Promise<Map<string, JobSubject>> {
    const subjects = new Map<string, JobSubject>();
    if (rows.length === 0) return subjects;
    const libraryIds = [...new Set(rows.flatMap((row) => row.scan.libraryIds))];
    const [names, reachable] = await Promise.all([this.scans.findLibraryNames(libraryIds), this.libraries.findAccessibleLibraryIds(viewer.user)]);
    const reach = new Set(reachable);
    for (const row of rows) {
      const scanned = row.scan.requestedLibraryId === null ? row.scan.libraryIds : [row.scan.requestedLibraryId];
      const labels = scanned
        .filter((id) => reach.has(id))
        .map((id) => names.get(id))
        .filter((name): name is string => Boolean(name))
        .sort((a, b) => a.localeCompare(b));
      const own = row.scan.userId === viewer.user.id;
      if (labels.length === 0 && !own) continue;
      subjects.set(row.nativeId, {
        label: labels.length > 0 ? labels.join(', ') : null,
        byline: null,
        // The tool shows only the viewer's own scan, so another account's row links nowhere.
        url: own ? DUPLICATE_BOOKS_URL : null,
        image: null,
      });
    }
    return subjects;
  }

  actions(): { actions: JobActionKind[]; note: string | null } {
    return { actions: [], note: null };
  }

  /** A scan runs to the end or fails; nothing can be done to one from here. */
  async act(_action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const ids = nativeIds.map((id) => (/^[1-9]\d{0,9}$/.test(id) ? Number(id) : null));
    const owners = await this.scans.findScanOwners(ids.filter((id): id is number => id !== null && Number.isSafeInteger(id)));
    return nativeIds.map((nativeId, index) => {
      const id = ids[index];
      const owner = id === null || id === undefined ? undefined : owners.get(id);
      const visible = owner !== undefined && (viewer.access.all || owner === viewer.user.id);
      return { id: nativeId, outcome: visible ? 'refused' : 'not-found', status: null };
    });
  }
}
