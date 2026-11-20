import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JOB_TYPES, type JobCounts, type JobType, type JobView } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { decodeJobCursor, encodeJobCursor } from './job-cursor';
import type { JobOwnerFilter, SourceCountQuery } from './job-source';
import { JobSourceRegistry } from './job-source.registry';
import { JobsService, type JobListQuery } from './jobs.service';
import { createFakeJobSource, type FakeJob } from './testing/fake-job-source';

const viewer = { id: 7, isSuperuser: false, permissions: [] } as unknown as RequestUser;

/** A small seeded generator, so a failing case reproduces. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

function pick<T>(next: () => number, values: readonly T[]): T {
  return values[Math.floor(next() * values.length)]!;
}

function query(overrides: Partial<JobListQuery> = {}): JobListQuery {
  return { view: 'queue', type: null, scope: 'everyone', cursor: null, limit: 3, counts: false, ...overrides };
}

function makeService(...sources: ReturnType<typeof createFakeJobSource>[]) {
  const registry = new JobSourceRegistry();
  for (const source of sources) registry.register(source);
  return new JobsService(registry);
}

/** Every id, page by page, until the list ends. */
async function readAll(service: JobsService, base: JobListQuery, between?: (page: number) => void): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 500; page++) {
    const list = await service.list(viewer, { ...base, cursor });
    seen.push(...list.items.map((item) => item.id));
    if (!list.next) return seen;
    between?.(page);
    cursor = list.next;
  }
  throw new Error('paging did not end');
}

/** The full list in the merged order, worked out by sorting everything at once. */
async function readOnce(service: JobsService, base: JobListQuery): Promise<string[]> {
  return (await service.list(viewer, { ...base, limit: 100 })).items.map((item) => item.id);
}

function randomJobs(next: () => number, view: JobView, count: number, prefix: string): FakeJob[] {
  // Narrow ranges force ties at every level of the key.
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index.toString().padStart(3, '0')}`,
    view,
    ownerId: pick(next, [7, 8, null]),
    prefix: view === 'queue' ? [pick(next, [0, 1, 2]), pick(next, [0, 1, 2])] : [1_763_164_800_000_000 + pick(next, [0, 1, 2, 999])],
    suffix: view === 'queue' ? [1_763_164_800_000_000 + pick(next, [0, 1, 5])] : [],
  }));
}

describe('JobsService paging', () => {
  it.each(['queue', 'history'] as const)('shows every %s row exactly once across pages, whatever the page size', async (view) => {
    for (let seed = 1; seed <= 40; seed++) {
      const next = random(seed);
      const types: JobType[] = ['story-guide', 'read-along', 'library-scan'];
      const sources = types.map((type, index) => createFakeJobSource(type, randomJobs(next, view, Math.floor(next() * 15), `${index}-`)));
      const service = makeService(...sources);
      const base = query({ view, limit: 1 + Math.floor(next() * 6) });
      const expected = await readOnce(service, base);
      const paged = await readAll(service, base);
      expect(paged).toEqual(expected);
      expect(new Set(paged).size).toBe(paged.length);
      expect(paged.length).toBe(sources.reduce((sum, source) => sum + source.jobs.length, 0));
    }
  });

  it('keeps History pages stable while new jobs finish', async () => {
    const next = random(99);
    const story = createFakeJobSource('story-guide', randomJobs(next, 'history', 12, 's-'));
    const scans = createFakeJobSource('library-scan', randomJobs(next, 'history', 12, 'l-'));
    const service = makeService(story, scans);
    const base = query({ view: 'history', limit: 4 });
    const before = await readOnce(service, base);
    let added = 0;
    const paged = await readAll(service, base, () => {
      // A job that ends now finishes later than anything already listed.
      story.jobs.push({ id: `new-${added++}`, view: 'history', ownerId: 7, prefix: [1_763_164_900_000_000 + added], suffix: [] });
    });
    expect(added).toBeGreaterThan(0);
    expect(paged).toEqual(before);
  });

  it('neither skips nor repeats rows a few microseconds apart inside one millisecond at a page edge', async () => {
    const base = 1_763_164_800_123_000;
    const jobs: FakeJob[] = [0, 1, 2, 3, 4, 5].map((offset) => ({
      id: `j${offset}`,
      view: 'failed',
      ownerId: 7,
      prefix: [base + offset],
      suffix: [],
    }));
    const service = makeService(createFakeJobSource('story-guide', jobs));
    for (const limit of [1, 2, 4, 5]) {
      expect(await readAll(service, query({ view: 'failed', limit }))).toEqual(['j5', 'j4', 'j3', 'j2', 'j1', 'j0'].map((id) => `story-guide:${id}`));
    }
  });

  it('breaks ties between types by type order, before the rest of the key', async () => {
    const at = 1_763_164_800_000_000;
    const reads = createFakeJobSource('read-along', [
      { id: 'r1', view: 'queue', ownerId: 7, prefix: [1, 1], suffix: [at] },
      { id: 'r0', view: 'queue', ownerId: 7, prefix: [0, 0], suffix: [at + 9] },
    ]);
    const guides = createFakeJobSource('story-guide', [
      { id: 'g1', view: 'queue', ownerId: 7, prefix: [1, 1], suffix: [at + 5] },
      { id: 'g2', view: 'queue', ownerId: 7, prefix: [1, 2], suffix: [at] },
    ]);
    const service = makeService(reads, guides);
    const expected = ['read-along:r0', 'story-guide:g1', 'read-along:r1', 'story-guide:g2'];
    expect(await readOnce(service, query())).toEqual(expected);
    expect(await readAll(service, query({ limit: 1 }))).toEqual(expected);
  });
});

describe('JobsService cursors and scope', () => {
  const guides = () => createFakeJobSource('story-guide', randomJobs(random(3), 'queue', 8, 'g-'));

  it('refuses a cursor minted for another view, type filter or scope', async () => {
    const service = makeService(guides());
    const { next } = await service.list(viewer, query({ limit: 2 }));
    expect(next).not.toBeNull();
    await expect(service.list(viewer, query({ view: 'history', cursor: next }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list(viewer, query({ type: 'story-guide', cursor: next }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list(viewer, query({ scope: 'mine', cursor: next }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list(viewer, query({ cursor: 'not-a-cursor' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the first page time in the cursor, so the failed window does not move while paging', async () => {
    const service = makeService(guides());
    const { next } = await service.list(viewer, query({ limit: 2 }));
    const asOf = decodeJobCursor(next!).asOf;
    const second = await service.list(viewer, query({ limit: 2, cursor: next }));
    expect(decodeJobCursor(second.next!).asOf).toBe(asOf);
  });

  it("refuses everyone's jobs to a viewer who sees no type's everyone view", async () => {
    const service = makeService(createFakeJobSource('story-guide', [], { own: true, all: false }));
    await expect(service.list(viewer, query({ scope: 'everyone' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("reads the viewer's own rows, plus ownerless ones only where they see everyone's", async () => {
    const jobs: FakeJob[] = [
      { id: 'mine', view: 'queue', ownerId: 7, prefix: [1, 1], suffix: [1] },
      { id: 'theirs', view: 'queue', ownerId: 8, prefix: [1, 2], suffix: [1] },
      { id: 'nobody', view: 'queue', ownerId: null, prefix: [1, 3], suffix: [1] },
    ];
    const limited = makeService(createFakeJobSource('story-guide', jobs, { own: true, all: false }));
    expect((await limited.list(viewer, query({ scope: 'mine' }))).items.map((item) => item.id)).toEqual(['story-guide:mine']);
    const manager = makeService(createFakeJobSource('story-guide', jobs));
    expect((await manager.list(viewer, query({ scope: 'mine' }))).items.map((item) => item.id)).toEqual(['story-guide:mine', 'story-guide:nobody']);
    expect((await manager.list(viewer, query({ scope: 'everyone' }))).items).toHaveLength(3);
  });

  it('skips types the viewer cannot see and reads only the filtered type', async () => {
    const hidden = createFakeJobSource('read-along', [{ id: 'r', view: 'queue', ownerId: 7, prefix: [0, 0], suffix: [0] }], {
      own: false,
      all: false,
    });
    const scans = createFakeJobSource('library-scan', [{ id: 's', view: 'queue', ownerId: null, prefix: [0, 0], suffix: [0] }]);
    const service = makeService(hidden, guides(), scans);
    expect((await service.list(viewer, query({ limit: 100 }))).items.some((item) => item.type === 'read-along')).toBe(false);
    const filtered = await service.list(viewer, query({ type: 'library-scan' }));
    expect(filtered.items.map((item) => item.id)).toEqual(['library-scan:s']);
  });

  it('gives an action note only to rows that offer no action', async () => {
    const service = makeService(guides());
    const { items } = await service.list(viewer, query());
    expect(items.every((item) => item.actions.length === 0 && item.actionNote === 'owner-only')).toBe(true);
  });

  it('adds counts only when asked', async () => {
    const service = makeService(guides());
    expect((await service.list(viewer, query())).counts).toBeUndefined();
    expect((await service.list(viewer, query({ counts: true }))).counts).toEqual({
      queue: 0,
      needsYou: 0,
      failed: 0,
      running: 0,
      queued: 0,
      paused: 0,
    });
  });

  it('names the types the viewer sees beside the counts, whatever the type filter', async () => {
    const service = makeService(
      createFakeJobSource('bulk-run', []),
      createFakeJobSource('read-along', [], { own: false, all: false }),
      createFakeJobSource('story-guide', []),
    );
    expect((await service.list(viewer, query())).types).toBeUndefined();
    const listed = await service.list(viewer, query({ counts: true, type: 'bulk-run' }));
    expect(listed.types).toEqual(['story-guide', 'bulk-run']);
    expect(listed.scopes).toEqual(['mine', 'everyone']);
  });

  it('offers only the mine scope to a viewer no type shows other accounts to', async () => {
    const service = makeService(createFakeJobSource('story-guide', [], { own: true, all: false }));
    expect((await service.list(viewer, query({ counts: true, scope: 'mine' }))).scopes).toEqual(['mine']);
  });
});

describe('JobsService actions', () => {
  it('routes each id to its type, answers not-found for types the viewer cannot see, and keeps the request order', async () => {
    const guides = createFakeJobSource('story-guide', []);
    const hidden = createFakeJobSource('read-along', [], { own: false, all: false });
    const act = vi.spyOn(guides, 'act');
    const service = makeService(guides, hidden);
    const response = await service.act(viewer, 'cancel', ['read-along:a', 'story-guide:b', 'nope:c', 'story-guide:b', 'story-guide:d']);
    expect(act).toHaveBeenCalledWith('cancel', ['b', 'd'], expect.objectContaining({ user: viewer }));
    expect(response.results).toEqual([
      { id: 'read-along:a', outcome: 'not-found', status: null },
      { id: 'story-guide:b', outcome: 'done', status: 'cancelled' },
      { id: 'nope:c', outcome: 'not-found', status: null },
      { id: 'story-guide:d', outcome: 'done', status: 'cancelled' },
    ]);
  });

  it("answers error for a type whose adapter failed, without failing the others' ids", async () => {
    const guides = createFakeJobSource('story-guide', []);
    vi.spyOn(guides, 'act').mockRejectedValue(new Error('down'));
    const scans = createFakeJobSource('library-scan', []);
    const response = await makeService(guides, scans).act(viewer, 'cancel', ['story-guide:a', 'library-scan:b']);
    expect(response.results.map((result) => result.outcome)).toEqual(['error', 'done']);
  });
});

describe('job cursors', () => {
  const position = { prefix: [1, 2], suffix: [1_763_164_800_000_001], typeIndex: 0, id: '3f2a' };

  it('round-trips', () => {
    const cursor = { view: 'queue' as const, type: null, scope: 'mine' as const, asOf: 1_763_164_800_000, position };
    expect(decodeJobCursor(encodeJobCursor(cursor), 1_763_164_800_000)).toEqual(cursor);
  });

  function tampered(change: (wire: Record<string, unknown>) => void): string {
    const wire = JSON.parse(
      Buffer.from(encodeJobCursor({ view: 'queue', type: null, scope: 'mine', asOf: 1_000, position }), 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    change(wire);
    return Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');
  }

  it.each([
    ['an unknown version', (wire: Record<string, unknown>) => (wire.v = 2)],
    ['an extra field', (wire: Record<string, unknown>) => (wire.extra = 1)],
    ['an unknown type', (wire: Record<string, unknown>) => (wire.type = 'mystery')],
    ['a type its key does not belong to', (wire: Record<string, unknown>) => (wire.type = JOB_TYPES[1])],
    ['a key of the wrong shape', (wire: Record<string, unknown>) => ((wire.key as Record<string, unknown>).p = [1])],
    ['a fractional key value', (wire: Record<string, unknown>) => ((wire.key as Record<string, unknown>).s = [1.5])],
    ['a type index out of range', (wire: Record<string, unknown>) => ((wire.key as Record<string, unknown>).t = JOB_TYPES.length)],
    ['an id with other characters', (wire: Record<string, unknown>) => ((wire.key as Record<string, unknown>).i = "x' or 1=1")],
    ['a time in the future', (wire: Record<string, unknown>) => (wire.asOf = 10 ** 15)],
  ])('refuses %s', (_label, change) => {
    expect(() => decodeJobCursor(tampered(change), 1_763_164_800_000)).toThrow(BadRequestException);
  });

  it('refuses text that is not a cursor at all', () => {
    expect(() => decodeJobCursor('%%%')).toThrow(BadRequestException);
    expect(() => decodeJobCursor(Buffer.from('[1,2]').toString('base64url'))).toThrow(BadRequestException);
  });
});

describe('JobsService summary', () => {
  const ZERO = { queue: 0, needsYou: 0, failed: 0, running: 0, queued: 0, paused: 0 };

  function counting(type: JobType, access: { own: boolean; all: boolean }, answer: (owner: JobOwnerFilter) => Partial<JobCounts>) {
    const source = createFakeJobSource(type, [], access);
    const counts = vi.fn((query: SourceCountQuery) => Promise.resolve({ ...ZERO, ...answer(query.owner) }));
    source.counts = counts;
    return { source, counts };
  }

  it("sums only the viewer's own jobs, never the ownerless rows the mine scope lists", async () => {
    const guides = counting('story-guide', { own: true, all: true }, (owner) =>
      owner?.ownerless ? { running: 50 } : { running: 1, queued: 2, failed: 1 },
    );
    const aloud = counting('read-along', { own: true, all: false }, () => ({ running: 1, paused: 1, needsYou: 2 }));
    const summary = await makeService(guides.source, aloud.source).summary(viewer);
    expect(summary).toEqual({ running: 2, waiting: 3, needsYou: 2, failed: 1, background: [] });
    expect(guides.counts).toHaveBeenCalledWith(expect.objectContaining({ owner: { id: viewer.id, ownerless: false } }), expect.anything());
  });

  it('names running ownerless types in JOB_TYPES order and leaves them out of every count', async () => {
    const enrichment = counting('author-enrichment', { own: false, all: true }, () => ({ running: 1, failed: 4 }));
    const scans = counting('library-scan', { own: false, all: true }, () => ({ running: 2 }));
    const fetches = counting('metadata-fetch', { own: false, all: true }, () => ({ queued: 1 }));
    const summary = await makeService(enrichment.source, scans.source, fetches.source).summary(viewer);
    expect(summary).toEqual({ running: 0, waiting: 0, needsYou: 0, failed: 0, background: ['library-scan', 'author-enrichment'] });
    expect(scans.counts).toHaveBeenCalledWith(expect.objectContaining({ owner: { id: viewer.id, ownerless: true } }), expect.anything());
  });

  it('asks no type the viewer cannot see', async () => {
    const hidden = counting('book-merge', { own: false, all: false }, () => ({ running: 9 }));
    const summary = await makeService(hidden.source).summary(viewer);
    expect(summary).toEqual({ running: 0, waiting: 0, needsYou: 0, failed: 0, background: [] });
    expect(hidden.counts).not.toHaveBeenCalled();
  });

  it("measures each type's failures against its own failed window", async () => {
    const guides = counting('story-guide', { own: true, all: false }, () => ({}));
    const before = Date.now();
    await makeService(guides.source).summary(viewer);
    const cutoff = guides.counts.mock.calls[0]![0].cutoffAt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - guides.source.failedWindowMs);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - guides.source.failedWindowMs);
  });
});
