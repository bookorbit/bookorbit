import { Permission, STORY_GUIDE_FEATURE } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { JobChangesService } from '../jobs/job-changes.service';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { AiJobChanges } from './ai-job-changes.service';
import type { AiJobPageRow } from './ai-job.repository';
import { StoryGuideJobSource } from './story-guide-job-source';

const JOB_ID = '3f2a7c1e-0b5d-4e8a-9c3f-1d2e3f4a5b6c';

function user(id: number, permissions: Permission[] = []): RequestUser {
  return { id, active: true, isSuperuser: false, permissions } as unknown as RequestUser;
}

const builder = user(4, [Permission.LibraryGenerateStoryGuide]);
const manager = user(2, [Permission.ManageAppSettings]);

function page(change: Partial<AiJobPageRow> = {}): AiJobPageRow {
  return {
    id: JOB_ID,
    feature: STORY_GUIDE_FEATURE,
    kind: 'build',
    subjectRef: { bookId: 7, fileId: 70 },
    status: 'queued',
    phase: null,
    done: 0,
    total: 0,
    reason: null,
    requestedBy: builder.id,
    costMicros: 2_500_000,
    createdAt: new Date('2026-11-15T10:00:00.000Z'),
    startedAt: null,
    pausedAt: null,
    finishedAt: null,
    dismissedAt: null,
    requesterName: 'Sam Whitfield',
    rank: 3,
    key: { prefix: [1, 3], suffix: [1_763_200_800_000_000], id: JOB_ID },
    ...change,
  };
}

function makeSource() {
  const registry = new JobSourceRegistry();
  const changes = new JobChangesService();
  const aiChanges = new AiJobChanges();
  const features = { get: vi.fn((id: string) => (id === STORY_GUIDE_FEATURE ? { id, permission: Permission.LibraryGenerateStoryGuide } : null)) };
  const jobs = {
    pageForJobs: vi.fn((): Promise<AiJobPageRow[]> => Promise.resolve([])),
    countForJobs: vi.fn(() => Promise.resolve({ queue: 3, failed: 1, history: 0, running: 1, queued: 1, paused: 1 })),
  };
  const queue = {
    describe: vi.fn(() => Promise.resolve(new Map([[JOB_ID, { label: 'Dune', byline: 'Frank Herbert', url: '/books/7', image: null }]]))),
    allowedActions: vi.fn(() => ['cancel', 'prioritize']),
    act: vi.fn((_user: RequestUser, _action: string, ids: string[]) =>
      Promise.resolve({ results: ids.map((id) => ({ id, outcome: 'done', status: 'cancelled', reason: null })) }),
    ),
  };
  const source = new StoryGuideJobSource(registry, changes, aiChanges, features as never, jobs as never, queue as never);
  source.onModuleInit();
  return { source, registry, changes, aiChanges, jobs, queue };
}

const viewerOf = (who: RequestUser, all = false) => ({ user: who, access: { own: true, all } });

describe('StoryGuideJobSource', () => {
  it('registers itself as the story-guide type', () => {
    const { source, registry } = makeSource();
    expect(registry.get('story-guide')).toBe(source);
  });

  it("lets builders see their own guides and managers everyone's", () => {
    const { source } = makeSource();
    expect(source.access(builder)).toEqual({ own: true, all: false });
    expect(source.access(manager)).toEqual({ own: false, all: true });
    expect(source.access(user(9))).toEqual({ own: false, all: false });
  });

  it('maps a queued build with its place in the lane, no total until planned, and cost only for managers', async () => {
    const { source, jobs } = makeSource();
    jobs.pageForJobs.mockResolvedValue([page()]);
    const query = { view: 'queue' as const, owner: { id: 4, ownerless: false }, cutoffAt: new Date(0), after: null, typeIndex: 0, limit: 51 };
    const [row] = await source.list(query, viewerOf(builder));
    expect(jobs.pageForJobs).toHaveBeenCalledWith({ feature: STORY_GUIDE_FEATURE, ...query });
    expect(row).toMatchObject({ nativeId: JOB_ID, key: page().key, item: { status: 'queued', position: 3, total: null, cost: null, kind: 'build' } });
    const [managed] = await source.list(query, viewerOf(manager, true));
    expect(managed?.item.cost).toBe(2.5);
  });

  it('gives no position to a running build and keeps its counted total', async () => {
    const { source, jobs } = makeSource();
    jobs.pageForJobs.mockResolvedValue([page({ status: 'running', rank: 0, done: 4, total: 10, startedAt: new Date('2026-11-15T10:05:00.000Z') })]);
    const [row] = await source.list(
      { view: 'queue', owner: null, cutoffAt: new Date(0), after: null, typeIndex: 0, limit: 51 },
      viewerOf(manager, true),
    );
    expect(row?.item).toMatchObject({ status: 'running', position: null, done: 4, total: 10, startedAt: '2026-11-15T10:05:00.000Z' });
  });

  it('has nothing waiting on a person', async () => {
    const { source, jobs } = makeSource();
    expect(
      await source.list({ view: 'needs-you', owner: null, cutoffAt: new Date(0), after: null, typeIndex: 0, limit: 51 }, viewerOf(manager, true)),
    ).toEqual([]);
    expect(jobs.pageForJobs).not.toHaveBeenCalled();
    expect((await source.counts({ owner: null, cutoffAt: new Date(0) })).needsYou).toBe(0);
  });

  it("names subjects and decides actions with the AI area's own rules", async () => {
    const { source, queue } = makeSource();
    const row = { nativeId: JOB_ID, key: page().key, job: page(), item: {} as never };
    const subjects = await source.describe([row], viewerOf(builder));
    expect(subjects.get(JOB_ID)?.label).toBe('Dune');
    expect(source.actions(row, viewerOf(builder), 5)).toEqual({ actions: ['cancel', 'prioritize'], note: null });
    expect(queue.allowedActions).toHaveBeenCalledWith(row.job, builder, 5);
  });

  it('acts through the AI area limited to story guides, refusing actions it does not have and not finding ids that are not jobs', async () => {
    const { source, queue } = makeSource();
    expect(await source.act('cancel', [JOB_ID, 'nope'], viewerOf(builder))).toEqual([
      { id: JOB_ID, outcome: 'done', status: 'cancelled' },
      { id: 'nope', outcome: 'not-found', status: null },
    ]);
    expect(queue.act).toHaveBeenCalledWith(builder, 'cancel', [JOB_ID], STORY_GUIDE_FEATURE);
    queue.act.mockClear();
    expect(await source.act('move-to-top', [JOB_ID], viewerOf(builder))).toEqual([{ id: JOB_ID, outcome: 'refused', status: null }]);
    expect(queue.act).not.toHaveBeenCalled();
  });

  it("passes the AI feed's story-guide changes to the Jobs area and ignores other features", () => {
    const { source, changes, aiChanges } = makeSource();
    const heard = vi.fn();
    changes.listen(heard);
    aiChanges.changed({ id: JOB_ID, feature: STORY_GUIDE_FEATURE, subjectRef: {}, requestedBy: 4, kind: 'state' });
    aiChanges.changed({ id: JOB_ID, feature: STORY_GUIDE_FEATURE, subjectRef: {}, requestedBy: null, kind: 'progress' });
    aiChanges.changed({ id: JOB_ID, feature: 'other', subjectRef: {}, requestedBy: 4, kind: 'state' });
    expect(heard.mock.calls).toEqual([[{ type: 'story-guide', ownerId: 4, state: true }], [{ type: 'story-guide', ownerId: null, state: false }]]);
    source.onModuleDestroy();
    aiChanges.changed({ id: JOB_ID, feature: STORY_GUIDE_FEATURE, subjectRef: {}, requestedBy: 4, kind: 'state' });
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
