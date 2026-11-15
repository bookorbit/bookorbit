import type { JobActionKind, JobActionOutcome, JobCounts, JobListItem, JobStatus, JobSubject, JobType, JobView } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { JobKey, JobPosition } from './job-keyset';

/** `own`: the viewer sees their own jobs of the type. `all`: everyone's and the ownerless ones too. */
export interface JobAccess {
  own: boolean;
  all: boolean;
}

export interface JobViewer {
  user: RequestUser;
  access: JobAccess;
}

/** Whose rows a read covers: one account's, plus the ownerless ones when the viewer may see them. Null covers every account. */
export type JobOwnerFilter = { id: number; ownerless: boolean } | null;

export interface SourceListQuery {
  view: JobView;
  owner: JobOwnerFilter;
  /** Failed rows that finished at or before this have aged into History. */
  cutoffAt: Date;
  /** Rows strictly after this position in the view's order; null from the start. */
  after: JobPosition | null;
  /** This source's place in `JOB_TYPES`, which the cursor rule compares against `after.typeIndex`. */
  typeIndex: number;
  limit: number;
}

export interface SourceCountQuery {
  owner: JobOwnerFilter;
  cutoffAt: Date;
}

/** A listed row: everything but what the service fills in (id, type, subject, actions). */
export type SourceItem = Omit<JobListItem, 'id' | 'type' | 'subject' | 'actions' | 'actionNote'>;

export interface SourceRow {
  /** The id inside the type, after `<type>:`. */
  nativeId: string;
  key: JobKey;
  item: SourceItem;
}

export interface SourceActionResult {
  /** The native id. */
  id: string;
  outcome: JobActionOutcome;
  status: JobStatus | null;
}

/**
 * One job type's adapter. It owns its SQL and its status mapping; its database access stays in its
 * own module's repository. Keyset predicates come from `job-keyset.ts`, never by hand.
 */
export interface JobSource<Row extends SourceRow = SourceRow> {
  readonly type: JobType;
  /** How long a failed row stays in Failed before it ages into History. */
  readonly failedWindowMs: number;
  access(user: RequestUser): JobAccess;
  /** Up to `limit` rows in the view's order, after the cursor position. */
  list(query: SourceListQuery, viewer: JobViewer): Promise<Row[]>;
  counts(query: SourceCountQuery, viewer: JobViewer): Promise<JobCounts>;
  /** Names the subjects of the rows a page keeps, in one batch, hiding what the viewer can no longer reach. */
  describe(rows: Row[], viewer: JobViewer): Promise<Map<string, JobSubject>>;
  actions(row: Row, viewer: JobViewer, now: number): { actions: JobActionKind[]; note: string | null };
  act(action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]>;
}
