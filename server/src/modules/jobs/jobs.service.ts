import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type {
  JobActionKind,
  JobActionResponse,
  JobActionResult,
  JobCounts,
  JobList,
  JobListItem,
  JobScope,
  JobSubject,
  JobType,
  JobView,
  JobsSummary,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { decodeJobCursor, encodeJobCursor } from './job-cursor';
import { compareJobPositions, type JobPosition } from './job-keyset';
import type { JobAccess, JobOwnerFilter, JobSource, JobViewer, SourceRow } from './job-source';
import { JobSourceRegistry, jobTypeIndex } from './job-source.registry';

export interface JobListQuery {
  view: JobView;
  type: JobType | null;
  scope: JobScope;
  cursor: string | null;
  limit: number;
  counts: boolean;
}

const NO_SUBJECT: JobSubject = { label: null, byline: null, url: null, image: null };
const NO_COUNTS: JobCounts = { queue: 0, needsYou: 0, failed: 0, running: 0, queued: 0, paused: 0 };

interface Entry {
  source: JobSource;
  viewer: JobViewer;
  typeIndex: number;
  owner: JobOwnerFilter;
}

interface Placed {
  entry: Entry;
  row: SourceRow;
  position: JobPosition;
}

function sees(access: JobAccess): boolean {
  return access.own || access.all;
}

/**
 * The Jobs area: every type's adapter asked in parallel, merged into one order per view, paged by
 * cursor. Each row is authorized by its own adapter on every request; the cursor is only a position.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly registry: JobSourceRegistry) {}

  async list(user: RequestUser, query: JobListQuery): Promise<JobList> {
    const visible = this.registry
      .list()
      .map((source) => ({ source, access: source.access(user) }))
      .filter(({ access }) => sees(access));
    if (query.scope === 'everyone' && !visible.some(({ access }) => access.all)) {
      throw new ForbiddenException("Missing permission to see other accounts' jobs");
    }
    const cursor = query.cursor === null ? null : decodeJobCursor(query.cursor);
    if (cursor && (cursor.view !== query.view || cursor.type !== query.type || cursor.scope !== query.scope)) {
      throw new BadRequestException('This cursor belongs to another list');
    }
    const asOf = cursor?.asOf ?? Date.now();
    const entries: Entry[] = visible
      .filter(({ source }) => query.type === null || source.type === query.type)
      .map(({ source, access }) => ({
        source,
        viewer: { user, access },
        typeIndex: jobTypeIndex(source.type),
        owner: query.scope === 'everyone' && access.all ? null : { id: user.id, ownerless: access.all },
      }));

    const [pages, counts] = await Promise.all([
      Promise.all(
        entries.map((entry) =>
          entry.source.list(
            {
              view: query.view,
              owner: entry.owner,
              cutoffAt: new Date(asOf - entry.source.failedWindowMs),
              after: cursor?.position ?? null,
              typeIndex: entry.typeIndex,
              // One more than a page tells whether another page follows.
              limit: query.limit + 1,
            },
            entry.viewer,
          ),
        ),
      ),
      query.counts ? this.counts(entries, asOf) : Promise.resolve(undefined),
    ]);

    const merged: Placed[] = pages
      .flatMap((rows, index) => rows.map((row) => ({ entry: entries[index]!, row, position: { ...row.key, typeIndex: entries[index]!.typeIndex } })))
      .sort((a, b) => compareJobPositions(query.view, a.position, b.position));
    const kept = merged.slice(0, query.limit);
    const last = kept.at(-1);
    const next =
      merged.length > query.limit && last
        ? encodeJobCursor({ view: query.view, type: query.type, scope: query.scope, asOf, position: last.position })
        : null;

    const subjects = await this.describe(kept);
    const now = Date.now();
    const items = kept.map(({ entry, row }): JobListItem => {
      const { actions, note } = entry.source.actions(row, entry.viewer, now);
      return {
        ...row.item,
        id: `${entry.source.type}:${row.nativeId}`,
        type: entry.source.type,
        subject: subjects.get(entry.source)?.get(row.nativeId) ?? NO_SUBJECT,
        actions,
        actionNote: actions.length === 0 ? note : null,
      };
    });
    if (!counts) return { items, next };
    const scopes: JobScope[] = visible.some(({ access }) => access.all) ? ['mine', 'everyone'] : ['mine'];
    return { items, next, counts, types: visible.map(({ source }) => source.type), scopes };
  }

  /**
   * Takes one action on each job, grouped by type, and says what happened to each. A job of a type
   * the viewer cannot see answers `not-found`, the same as one that does not exist.
   */
  async act(user: RequestUser, action: JobActionKind, ids: readonly string[]): Promise<JobActionResponse> {
    const startedAt = Date.now();
    const unique = [...new Set(ids)];
    const results = new Map<string, JobActionResult>();
    const groups = new Map<JobSource, { viewer: JobViewer; natives: string[] }>();
    for (const id of unique) {
      const split = id.indexOf(':');
      const source = this.registry.get(id.slice(0, split));
      const access = source?.access(user);
      if (!source || !access || !sees(access)) {
        results.set(id, { id, outcome: 'not-found', status: null });
        continue;
      }
      const group = groups.get(source) ?? { viewer: { user, access }, natives: [] };
      group.natives.push(id.slice(split + 1));
      groups.set(source, group);
    }
    for (const [source, group] of groups) {
      try {
        for (const result of await source.act(action, group.natives, group.viewer)) {
          const id = `${source.type}:${result.id}`;
          results.set(id, { id, outcome: result.outcome, status: result.status });
        }
      } catch (error) {
        this.logger.warn(
          `[jobs.action] [fail] userId=${user.id} type=${source.type} action=${action} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(
            error instanceof Error ? error.message : String(error),
          )}" - job action failed`,
        );
        for (const native of group.natives) {
          const id = `${source.type}:${native}`;
          results.set(id, { id, outcome: 'error', status: null });
        }
      }
    }
    const answered = unique.map((id) => results.get(id) ?? { id, outcome: 'not-found' as const, status: null });
    const done = answered.filter((result) => result.outcome === 'done').length;
    this.logger.log(
      `[jobs.action] [end] userId=${user.id} action=${action} jobs=${unique.length} done=${done} durationMs=${Date.now() - startedAt} - job action taken`,
    );
    return { results: answered };
  }

  /**
   * The sidebar's glance: the viewer's own jobs only, never the ownerless rows `mine` lists beside
   * them. Types no one owns (`access.own` is never true for them) are asked only whether they run.
   */
  async summary(user: RequestUser): Promise<JobsSummary> {
    const now = Date.now();
    const visible = this.registry
      .list()
      .map((source) => ({ source, viewer: { user, access: source.access(user) } }))
      .filter(({ viewer }) => sees(viewer.access));
    const ask = (source: JobSource, viewer: JobViewer, owner: JobOwnerFilter) =>
      source.counts({ owner, cutoffAt: new Date(now - source.failedWindowMs) }, viewer);
    const owned = visible.filter(({ viewer }) => viewer.access.own);
    const ownerless = visible.filter(({ viewer }) => !viewer.access.own && viewer.access.all);
    const [own, background] = await Promise.all([
      Promise.all(owned.map(({ source, viewer }) => ask(source, viewer, { id: user.id, ownerless: false }))),
      Promise.all(ownerless.map(({ source, viewer }) => ask(source, viewer, { id: user.id, ownerless: true }))),
    ]);
    return {
      running: own.reduce((sum, counts) => sum + counts.running, 0),
      waiting: own.reduce((sum, counts) => sum + counts.queued + counts.paused, 0),
      needsYou: own.reduce((sum, counts) => sum + counts.needsYou, 0),
      failed: own.reduce((sum, counts) => sum + counts.failed, 0),
      background: ownerless
        .filter((_, index) => background[index]!.running > 0)
        .map(({ source }) => source.type)
        .sort((a, b) => jobTypeIndex(a) - jobTypeIndex(b)),
    };
  }

  private async counts(entries: readonly Entry[], asOf: number): Promise<JobCounts> {
    const each = await Promise.all(
      entries.map((entry) => entry.source.counts({ owner: entry.owner, cutoffAt: new Date(asOf - entry.source.failedWindowMs) }, entry.viewer)),
    );
    return each.reduce<JobCounts>(
      (sum, counts) => ({
        queue: sum.queue + counts.queue,
        needsYou: sum.needsYou + counts.needsYou,
        failed: sum.failed + counts.failed,
        running: sum.running + counts.running,
        queued: sum.queued + counts.queued,
        paused: sum.paused + counts.paused,
      }),
      NO_COUNTS,
    );
  }

  /** Each type names the subjects of the rows the page keeps, in one batch per type. */
  private async describe(kept: readonly Placed[]): Promise<Map<JobSource, Map<string, JobSubject>>> {
    const byEntry = new Map<Entry, SourceRow[]>();
    for (const placed of kept) byEntry.set(placed.entry, [...(byEntry.get(placed.entry) ?? []), placed.row]);
    const described = await Promise.all(
      [...byEntry].map(async ([entry, rows]) => [entry.source, await entry.source.describe(rows, entry.viewer)] as const),
    );
    return new Map(described);
  }
}
