import { NotFoundException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BookFileTextRow } from '../../db/schema';
import type { AiConnectionService } from '../ai/ai-connection.service';
import type { AiSettingsService } from '../ai/ai-settings.service';
import type { AiJobsService } from '../ai-jobs/ai-jobs.service';
import { AiStepRateTable, type AiStepRates } from '../ai-jobs/ai-step-rates.service';
import type { BookService } from '../book/book.service';
import type { StoryGuideFixesService } from './fixes/story-guide-fixes.service';
import { changedSteps, storyGuidePipelineName, type StoryGuideFeature } from './story-guide.feature';
import { StoryGuideEstimator } from './story-guide-estimator.service';
import type { StoryGuidesRepository } from './story-guides.repository';
import { StoryGuidesService, storyGuideFiles } from './story-guides.service';
import type { StoryTextService } from './story-text.service';
import { STORY_TEXT_EXTRACTION_VERSION } from './text/extraction-version';

function user(overrides: Partial<RequestUser> = {}): RequestUser {
  return { id: 7, username: 'reader', name: 'Reader', email: null, active: true, isSuperuser: false, permissions: [], ...overrides } as RequestUser;
}

function textRow(overrides: Partial<BookFileTextRow> = {}): BookFileTextRow {
  return {
    fileId: 11,
    sizeBytes: 100,
    mtime: null,
    extractionVersion: STORY_TEXT_EXTRACTION_VERSION,
    outcome: 'ready',
    textKey: 'a'.repeat(64),
    previousKey: null,
    language: 'en',
    words: 42_000,
    sections: Array.from({ length: 14 }, (_, s) => ({ s, title: null, chars: 1, h: 'h', start: 0, end: 1, words: 3_000 })),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BookFileTextRow;
}

/** A minute per unit in one lane for every model step on `model` over connection 1. */
function learned(models: readonly string[], stepIds: readonly string[] = ['names', 'review', 'ties', 'lines']): AiStepRates {
  const rows = models.flatMap((model) =>
    stepIds.map((step, index) => ({
      id: index,
      feature: 'story-guides',
      step,
      connectionId: 1,
      model,
      effort: null,
      units: 1,
      lanes: 1,
      durationMs: 60_000,
      jobId: null,
      createdAt: new Date('2026-11-10T00:00:00Z'),
    })),
  );
  return { table: vi.fn().mockResolvedValue(new AiStepRateTable(rows)) } as unknown as AiStepRates;
}

const steps = [
  { id: 'text', version: 1, slot: null, dependsOn: [] },
  { id: 'names', version: 1, slot: 'fast', dependsOn: ['text'] },
  { id: 'review', version: 1, slot: 'careful', dependsOn: ['names'] },
  { id: 'lines', version: 1, slot: 'fast', dependsOn: ['review'] },
];

function setup(options: { text?: BookFileTextRow | null; enabled?: boolean; artifact?: Record<string, unknown> | null; rates?: AiStepRates } = {}) {
  const text = options.text === undefined ? textRow() : options.text;
  const texts = {
    cached: vi.fn().mockResolvedValue(text),
    current: vi.fn(),
    compute: vi.fn(),
    file: vi.fn().mockResolvedValue({ id: 11, bookId: 3, absolutePath: '/books/a.epub', sizeBytes: 100, mtime: null, format: 'epub' }),
  };
  const jobs = {
    status: vi.fn().mockResolvedValue({ job: null, ahead: null, artifact: options.artifact ?? null }),
    readArtifact: vi.fn(),
    remove: vi.fn().mockResolvedValue({ removed: true, cancelled: null }),
    removeAll: vi.fn().mockResolvedValue({ kind: 'removed', removed: 2, cancelled: 0 }),
    models: vi.fn().mockResolvedValue({ fast: { connectionId: 1, model: 'm' }, careful: { connectionId: 1, model: 'c' } }),
    request: vi.fn(),
  };
  const repository = {
    findBook: vi.fn().mockResolvedValue({ id: 3, primaryFileId: null, formatPriority: null, title: 'A Book' }),
    findFiles: vi.fn().mockResolvedValue([
      { id: 10, bookId: 3, format: 'pdf', role: 'content', sizeBytes: 5, mediaOverlayAvailable: false },
      { id: 11, bookId: 3, format: 'epub', role: 'content', sizeBytes: 5, mediaOverlayAvailable: false },
    ]),
  };
  const books = { verifyBookAccess: vi.fn().mockResolvedValue(undefined) };
  const prices = { input: 0.1, output: 0.5 };
  const settings = {
    features: vi
      .fn()
      .mockResolvedValue({ 'story-guides': { enabled: options.enabled ?? true, limits: {}, monthlyBudget: null, buildsPerMonth: null } }),
    slots: vi.fn().mockResolvedValue({ fast: { connectionId: 1, prices }, careful: { connectionId: 1, prices } }),
  };
  const feature = {
    id: 'story-guides',
    permission: Permission.LibraryGenerateStoryGuide,
    pipeline: storyGuidePipelineName(steps, 1),
    steps,
    stepsToRun: vi.fn().mockReturnValue(steps.map((step) => step.id)),
  };
  const fixes = {
    state: vi.fn().mockResolvedValue({ revision: 0, live: 0 }),
    apply: vi.fn(),
    orphanCount: vi.fn().mockResolvedValue(2),
    removeForText: vi.fn().mockResolvedValue(3),
    removeAll: vi.fn().mockResolvedValue(5),
  };
  const connections = { getRow: vi.fn().mockResolvedValue({ id: 1, name: 'Home' }) };
  const estimator = new StoryGuideEstimator(
    settings as unknown as AiSettingsService,
    connections as unknown as AiConnectionService,
    options.rates ?? learned(['m', 'c']),
  );
  const service = new StoryGuidesService(
    feature as unknown as StoryGuideFeature,
    jobs as unknown as AiJobsService,
    texts as unknown as StoryTextService,
    repository as unknown as StoryGuidesRepository,
    books as unknown as BookService,
    settings as unknown as AiSettingsService,
    fixes as unknown as StoryGuideFixesService,
    estimator,
  );
  return { service, texts, jobs, books, fixes, connections };
}

describe('StoryGuidesService.status', () => {
  it('only reads the cache: it never reads the book', async () => {
    const { service, texts } = setup({ text: null });
    const { status } = await service.status(3, undefined, user({ permissions: [Permission.LibraryGenerateStoryGuide] }));
    expect(status.build).toEqual({ allowed: false, reason: 'checking' });
    expect(texts.cached).toHaveBeenCalledOnce();
    expect(texts.current).not.toHaveBeenCalled();
    expect(texts.compute).not.toHaveBeenCalled();
  });

  it('picks the book page file in a format a guide reads', async () => {
    const { service } = setup();
    expect((await service.status(3, undefined, user())).status.fileId).toBe(11);
  });

  it('gives readers no reason, estimate or cost', async () => {
    const { service } = setup({ enabled: false });
    const { status } = await service.status(3, undefined, user());
    expect(status).toEqual({ fileId: 11, textKey: 'a'.repeat(64), canManage: false, build: { allowed: false }, guide: null, job: null });
  });

  it('gives a manager the estimate, and dollars only with ManageAppSettings', async () => {
    const { service } = setup();
    const builder = (await service.status(3, undefined, user({ permissions: [Permission.LibraryGenerateStoryGuide] }))).status;
    expect(builder.build).toEqual({ allowed: true });
    expect(builder.estimate).toEqual({ words: 42_000, minutes: expect.any(Number) });
    const admin = (await service.status(3, undefined, user({ permissions: [Permission.LibraryGenerateStoryGuide, Permission.ManageAppSettings] })))
      .status;
    expect(admin.estimate?.cost).toBeGreaterThan(0);
  });

  it('leaves the time out until a build on the slot models has finished', async () => {
    const { service } = setup({ rates: learned(['m']) });
    const admin = user({ permissions: [Permission.LibraryGenerateStoryGuide, Permission.ManageAppSettings] });
    const { estimate } = (await service.status(3, undefined, admin)).status;
    expect(estimate?.minutes).toBeNull();
    expect(estimate?.cost).toBeGreaterThan(0);
  });

  describe('a running job', () => {
    const builder = user({ permissions: [Permission.LibraryGenerateStoryGuide] });

    function running(models: Record<string, unknown> | null, done: number) {
      return {
        job: {
          kind: 'build',
          status: 'running',
          reason: null,
          phase: 'lines',
          done,
          total: 14,
          estimate: null,
          startedAt: new Date(),
          costMicros: null,
          models,
        },
        ahead: null,
        artifact: null,
      };
    }

    it('counts the minutes left from its progress and its own models, not the clock', async () => {
      const { service, jobs } = setup({ rates: learned(['old-m', 'old-c']) });
      jobs.status.mockResolvedValue(running({ fast: { connectionId: 1, model: 'old-m' }, careful: { connectionId: 1, model: 'old-c' } }, 10));
      expect((await service.status(3, undefined, builder)).status.job).toMatchObject({ state: 'running', done: 10, total: 14, minutesLeft: 4 });
      jobs.status.mockResolvedValue(running({ fast: { connectionId: 1, model: 'old-m' }, careful: { connectionId: 1, model: 'old-c' } }, 13));
      expect((await service.status(3, undefined, builder)).status.job).toMatchObject({ minutesLeft: 1 });
    });

    it('has no minutes left while its models have no learned speed', async () => {
      const { service, jobs } = setup({ rates: learned(['m', 'c']) });
      jobs.status.mockResolvedValue(running({ fast: { connectionId: 1, model: 'new-m' }, careful: { connectionId: 1, model: 'c' } }, 3));
      expect((await service.status(3, undefined, builder)).status.job).toMatchObject({ minutesLeft: null });
    });
  });

  describe('a job that has spent money', () => {
    const builder = user({ permissions: [Permission.LibraryGenerateStoryGuide] });
    const admin = user({ permissions: [Permission.LibraryGenerateStoryGuide, Permission.ManageAppSettings] });

    function paused(costMicros: number | null) {
      return {
        job: {
          kind: 'update',
          status: 'paused',
          reason: 'over-estimate',
          phase: 'ties',
          done: 0,
          total: 0,
          estimate: null,
          startedAt: null,
          costMicros,
        },
        ahead: null,
        artifact: null,
      };
    }

    it('gives its dollars so far to a caller who sees dollars, rounded to a tenth of a cent', async () => {
      const { service, jobs } = setup();
      jobs.status.mockResolvedValue(paused(91_234));
      expect((await service.status(3, undefined, admin)).status.job).toMatchObject({ state: 'paused', reason: 'over-estimate', spentCost: 0.0912 });
    });

    it('leaves it out for a manager without ManageAppSettings, for readers, and while nothing has a price', async () => {
      const { service, jobs } = setup();
      jobs.status.mockResolvedValue(paused(91_234));
      expect((await service.status(3, undefined, builder)).status.job).not.toHaveProperty('spentCost');
      expect((await service.status(3, undefined, user())).status.job).toEqual({ kind: 'update', state: 'paused', phase: 'ties' });
      jobs.status.mockResolvedValue(paused(null));
      expect((await service.status(3, undefined, admin)).status.job).not.toHaveProperty('spentCost');
    });
  });

  it('names the longest-book setting for a book over it', async () => {
    const { service } = setup({ text: textRow({ words: 500_000 }) });
    const { status } = await service.status(3, undefined, user({ isSuperuser: true }));
    expect(status.build).toEqual({ allowed: false, reason: 'too-long', limit: 400_000 });
  });

  it('names the book language and the supported ones for a book in another language', async () => {
    const admin = user({ isSuperuser: true });
    const portuguese = setup({ text: textRow({ language: 'pt' }) });
    expect((await portuguese.service.status(3, undefined, admin)).status.build).toEqual({
      allowed: false,
      reason: 'language',
      language: 'pt',
      languages: ['en', 'es'],
    });
    const undetermined = setup({ text: textRow({ language: 'und' }) });
    expect((await undetermined.service.status(3, undefined, admin)).status.build).toEqual({
      allowed: false,
      reason: 'language',
      languages: ['en', 'es'],
    });
    const spanish = setup({ text: textRow({ language: 'es' }) });
    expect((await spanish.service.status(3, undefined, admin)).status.build).toEqual({ allowed: true });
  });

  it('answers 404 for a file of another book', async () => {
    const { service } = setup();
    await expect(service.status(3, 99, user())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gives the same body the same tag', async () => {
    const { service } = setup();
    const first = await service.status(3, undefined, user());
    expect((await service.status(3, undefined, user())).etag).toBe(first.etag);
  });
});

describe('StoryGuidesService and fixes for everyone', () => {
  const builder = () => user({ permissions: [Permission.LibraryGenerateStoryGuide] });
  const artifact = { builtAt: new Date(), models: null, coverage: 1, format: 1, pipeline: 'x0', sha256: 'f'.repeat(64) };

  it('tells managers how many fixes find no target in the guide, and readers nothing', async () => {
    const { service, fixes } = setup({ artifact });
    expect((await service.status(3, undefined, builder())).status.guide?.orphanedFixes).toBe(2);
    expect((await service.status(3, undefined, user())).status.guide).not.toHaveProperty('orphanedFixes');
    expect(fixes.orphanCount).toHaveBeenCalledOnce();
  });

  it('serves the guide with fixes applied under a tag that names their revision', async () => {
    const { service, jobs, fixes } = setup();
    const body = { format: 1, entities: [], ties: [], sections: [], fixesRevision: 0 };
    jobs.readArtifact.mockResolvedValue({ kind: 'found', format: 1, body, sha256: 'a'.repeat(64), builtAt: new Date() });
    fixes.state.mockResolvedValue({ revision: 41, live: 1 });
    fixes.apply.mockResolvedValue({ ...body, fixesRevision: 41 });

    const found = await service.content(11, [1], user());
    expect(found).toEqual({ kind: 'found', body: { ...body, fixesRevision: 41 }, etag: `"${'a'.repeat(32)}.f1.r41"` });
    fixes.apply.mockClear();
    expect(await service.content(11, [1], user(), `"${'a'.repeat(32)}.f1.r41"`)).toEqual({
      kind: 'not-modified',
      etag: `"${'a'.repeat(32)}.f1.r41"`,
    });
    expect(fixes.apply).not.toHaveBeenCalled();
  });

  it('keeps a text with no fixes on the tag it had before fixes existed', async () => {
    const { service, jobs, fixes } = setup();
    jobs.readArtifact.mockResolvedValue({ kind: 'found', format: 1, body: {}, sha256: 'b'.repeat(64), builtAt: new Date() });
    expect(await service.content(11, [1], user())).toEqual({ kind: 'found', body: {}, etag: `"${'b'.repeat(32)}.f1"` });
    expect(fixes.apply).not.toHaveBeenCalled();
  });

  it('deletes fixes with the guide only when asked', async () => {
    const { service, fixes } = setup();
    await service.remove(3, undefined, 'keep', builder());
    expect(fixes.removeForText).not.toHaveBeenCalled();
    await service.remove(3, undefined, 'delete', builder());
    expect(fixes.removeForText).toHaveBeenCalledWith('a'.repeat(64), expect.objectContaining({ id: 7 }));
  });

  it('deletes every fix with every guide only when asked, and nothing when the count changed', async () => {
    const { service, jobs, fixes } = setup();
    await service.removeAll(2, 'keep', builder());
    expect(fixes.removeAll).not.toHaveBeenCalled();
    await service.removeAll(2, 'delete', builder());
    expect(fixes.removeAll).toHaveBeenCalledOnce();
    jobs.removeAll.mockResolvedValue({ kind: 'count-changed', count: 4 });
    expect(await service.removeAll(2, 'delete', builder())).toEqual({ countChanged: 4 });
    expect(fixes.removeAll).toHaveBeenCalledOnce();
  });
});

describe('storyGuideFiles', () => {
  it('keeps content files a guide reads, the primary first', () => {
    const files = [
      { id: 1, bookId: 1, format: 'epub', role: 'content', sizeBytes: 5, mediaOverlayAvailable: false },
      { id: 2, bookId: 1, format: 'azw3', role: 'content', sizeBytes: 5, mediaOverlayAvailable: false },
      { id: 3, bookId: 1, format: 'cbz', role: 'content', sizeBytes: 5, mediaOverlayAvailable: false },
      { id: 4, bookId: 1, format: 'epub', role: 'cover', sizeBytes: 5, mediaOverlayAvailable: false },
    ];
    expect(storyGuideFiles(files, null, 2).map((file) => file.id)).toEqual([2, 1]);
  });
});

describe('pipeline name', () => {
  it('names the extraction version and every step', () => {
    expect(storyGuidePipelineName(steps, 1)).toBe(`x${STORY_TEXT_EXTRACTION_VERSION}.te1.na1.re1.li1.as1`);
  });

  it('finds the steps an update reruns: the changed one and every step that reads it', () => {
    const before = storyGuidePipelineName(steps, 1);
    const after = steps.map((step) => (step.id === 'review' ? { ...step, version: 2 } : step));
    expect(changedSteps(after, before, storyGuidePipelineName(after, 1))).toEqual(['review', 'lines']);
    expect(changedSteps(steps, before, before)).toEqual([]);
    expect(changedSteps(steps, 'x0.te1.na1.re1.li1.as1', before)).toEqual(['text', 'names', 'review', 'lines']);
  });
});

describe('StoryGuideEstimator', () => {
  const prices = { input: 0.1, output: 0.5 };
  const text = textRow();
  const models = { fast: { connectionId: 1, model: 'm' }, careful: { connectionId: 1, model: 'c' } };

  function estimator(rates: AiStepRates = learned(['m', 'c']), getRow = vi.fn().mockResolvedValue({ id: 1, name: 'Home' })) {
    const settings = { slots: vi.fn().mockResolvedValue({ fast: { connectionId: 1, prices }, careful: { connectionId: 1, prices } }) };
    const connections = { getRow };
    return new StoryGuideEstimator(settings as unknown as AiSettingsService, connections as unknown as AiConnectionService, rates);
  }

  it('prices a whole build and an update by the steps it reruns', async () => {
    const full = await estimator().estimate(text, ['text', 'names', 'review', 'ties', 'lines'], models);
    const lines = await estimator().estimate(text, ['lines'], models);
    expect(full.words).toBe(42_000);
    expect(full.cost).toBeGreaterThan(0.05);
    expect(lines.cost!).toBeLessThan(full.cost!);
    expect(lines.minutes).toBe(14);
    expect(await estimator().estimate(text, [], models)).toEqual({ words: 42_000, minutes: 0, cost: 0 });
  });

  it('reads each step at the speed of the model its slot uses', async () => {
    expect((await estimator(learned(['m'])).estimate(text, ['names', 'lines'], models)).minutes).not.toBeNull();
    expect((await estimator(learned(['m'])).estimate(text, ['review'], models)).minutes).toBeNull();
    expect((await estimator(learned(['m', 'c'])).estimate(text, ['review'], { fast: models.fast })).minutes).toBeNull();
  });

  it('lists each model it has learned, with its connection, newest first, steps in pipeline order', async () => {
    const rows = [
      { step: 'lines', model: 'm', durationMs: 12_000, units: 2, lanes: 1, createdAt: new Date('2026-11-10T00:00:00Z') },
      { step: 'names', model: 'm', durationMs: 10_000, units: 24, lanes: 12, createdAt: new Date('2026-11-09T00:00:00Z') },
      { step: 'review', model: 'c', durationMs: 40_000, units: 1, lanes: 1, createdAt: new Date('2026-11-08T00:00:00Z') },
    ].map((row, id) => ({ id, feature: 'story-guides', connectionId: 1, effort: null, jobId: null, ...row }));
    const rates = { table: vi.fn().mockResolvedValue(new AiStepRateTable(rows)) } as unknown as AiStepRates;
    expect(await estimator(rates).speeds()).toEqual({
      models: [
        {
          connectionId: 1,
          connectionName: 'Home',
          model: 'm',
          learnedAt: '2026-11-10T00:00:00.000Z',
          steps: [
            { step: 'names', secondsPerCall: 5, builds: 1 },
            { step: 'lines', secondsPerCall: 6, builds: 1 },
          ],
        },
        {
          connectionId: 1,
          connectionName: 'Home',
          model: 'c',
          learnedAt: '2026-11-08T00:00:00.000Z',
          steps: [{ step: 'review', secondsPerCall: 40, builds: 1 }],
        },
      ],
    });
    const gone = estimator(rates, vi.fn().mockRejectedValue(new NotFoundException()));
    expect((await gone.speeds()).models.map((entry) => entry.connectionName)).toEqual([null, null]);
  });

  it('lists a model apart at each effort it was learned at', async () => {
    const rows = [
      { effort: null, durationMs: 10_000, createdAt: new Date('2026-11-09T00:00:00Z') },
      { effort: 'high' as const, durationMs: 30_000, createdAt: new Date('2026-11-10T00:00:00Z') },
    ].map((row, id) => ({ id, feature: 'story-guides', step: 'review', connectionId: 1, model: 'c', units: 1, lanes: 1, jobId: null, ...row }));
    const rates = { table: vi.fn().mockResolvedValue(new AiStepRateTable(rows)) } as unknown as AiStepRates;
    const { models } = await estimator(rates).speeds();
    expect(models.map((entry) => [entry.effort, entry.steps[0]!.secondsPerCall])).toEqual([
      ['high', 30],
      [undefined, 10],
    ]);
    expect(models[1]).not.toHaveProperty('effort');
  });

  it('forgets one model on one connection, at every effort, at one level, or at the feature level', async () => {
    const forget = vi.fn().mockResolvedValue(4);
    const rates = { forget } as unknown as AiStepRates;
    expect(await estimator(rates).resetSpeed({ connectionId: 1, model: 'm' })).toEqual({ removed: 4 });
    expect(forget).toHaveBeenLastCalledWith({ feature: 'story-guides', connectionId: 1, model: 'm' });
    await estimator(rates).resetSpeed({ connectionId: 1, model: 'm', effort: 'high' });
    expect(forget).toHaveBeenLastCalledWith({ feature: 'story-guides', connectionId: 1, model: 'm', effort: 'high' });
    await estimator(rates).resetSpeed({ connectionId: 1, model: 'm', effort: 'auto' });
    expect(forget).toHaveBeenLastCalledWith({ feature: 'story-guides', connectionId: 1, model: 'm', effort: null });
  });
});
