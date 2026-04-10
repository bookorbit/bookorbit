import { NotFoundException } from '@nestjs/common';

import { MigrationReportingService } from './migration-reporting.service';

function makeRun(overrides?: Record<string, unknown>) {
  return {
    id: 7,
    sourceId: 1,
    profileId: 2,
    planArtifactId: 99,
    state: 'running',
    currentStage: 'user_state',
    targetKey: 'default',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: null,
    errorMessage: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function makeService() {
  const repo = {
    findRunById: vi.fn(),
    listRunMetrics: vi.fn(),
    findPlanArtifactById: vi.fn(),
    findBookTitlesByIds: vi.fn(),
  };

  return {
    service: new MigrationReportingService(repo as never),
    repo,
  };
}

describe('MigrationReportingService', () => {
  it('throws NotFoundException when run does not exist', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(null);

    await expect(service.getRunProgress(123)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getRunReport(123)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('aggregates run progress metrics', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(makeRun());
    repo.listRunMetrics.mockResolvedValue([
      { processed: 3, imported: 2, skipped: 1, unresolved: 0, failed: 0 },
      { processed: 4, imported: 3, skipped: 0, unresolved: 1, failed: 1 },
    ]);

    const result = await service.getRunProgress(7);

    expect(result.totals).toEqual({
      processed: 7,
      imported: 5,
      skipped: 1,
      unresolved: 1,
      failed: 1,
    });
  });

  it('builds detailed report view with normalized plan details and resolved titles', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(makeRun());
    repo.listRunMetrics.mockResolvedValue([
      {
        stage: 'user_state',
        entityType: 'reading_progress',
        processed: 5,
        imported: 4,
        skipped: 0,
        unresolved: 1,
        failed: 0,
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);
    repo.findPlanArtifactById.mockResolvedValue({
      sourceData: {
        books: [
          {
            sourceBookId: 's1',
            title: 'Source One',
            author: 'Author One',
          },
        ],
      },
      plan: {
        matchedBooks: [{ sourceBookId: 's1', targetBookId: 100, strategy: 'isbn' }],
        unresolvedBooks: [{ sourceBookId: 'sx', reason: 'unresolved_title' }],
        duplicateBookMatches: [{ targetBookId: 101, sourceBookIds: ['s1', 's2'], strategies: ['isbn', 'path_mapping'] }],
      },
      summary: {
        perUserPreview: [
          {
            sourceUserId: 'u1',
            targetUserId: 9,
            username: 'alice',
            counts: { statuses: 1, fileProgress: 2, bookmarks: 3, annotations: 4, shelves: 5 },
          },
        ],
      },
    });
    repo.findBookTitlesByIds.mockResolvedValue(
      new Map([
        [100, 'Target One'],
        [101, 'Target Two'],
      ]),
    );

    const result = await service.getRunReport(7);

    expect(result.totals).toEqual({
      processed: 5,
      imported: 4,
      skipped: 0,
      unresolved: 1,
      failed: 0,
    });
    expect(result.details.matchedBooks).toEqual([
      {
        sourceBookId: 's1',
        sourceTitle: 'Source One',
        sourceAuthor: 'Author One',
        targetBookId: 100,
        targetTitle: 'Target One',
        strategy: 'isbn',
      },
    ]);
    expect(result.details.unresolvedBooks).toEqual([
      {
        sourceBookId: 'sx',
        title: null,
        author: null,
        reason: 'unresolved_title',
      },
    ]);
    expect(result.details.duplicateBookMatches).toEqual([
      {
        targetBookId: 101,
        targetTitle: 'Target Two',
        sourceBookIds: ['s1', 's2'],
        sourceTitles: ['Source One', null],
        strategies: ['isbn', 'path_mapping'],
        reason: 'duplicate_target_match',
      },
    ]);
    expect(result.details.userPreview).toEqual([
      {
        sourceUserId: 'u1',
        targetUserId: 9,
        username: 'alice',
        counts: { statuses: 1, fileProgress: 2, bookmarks: 3, annotations: 4, shelves: 5 },
      },
    ]);
  });

  it('exports JSON report format by default', async () => {
    const { service } = makeService();
    const report = {
      run: makeRun(),
      totals: { processed: 1, imported: 1, skipped: 0, unresolved: 0, failed: 0 },
      metrics: [],
      plan: {},
      summary: {},
      details: { matchedBooks: [], unresolvedBooks: [], duplicateBookMatches: [], userPreview: [] },
    };
    vi.spyOn(service, 'getRunReport').mockResolvedValue(report as never);

    const result = await service.exportRunReport(7);

    expect(result.format).toBe('json');
    expect(result.contentType).toBe('application/json');
    expect(result.fileName).toBe('migration-run-7-report.json');
    expect(result.content).toContain('"processed": 1');
  });

  it('exports CSV report and escapes commas/quotes', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getRunReport').mockResolvedValue({
      run: makeRun(),
      totals: { processed: 1, imported: 1, skipped: 0, unresolved: 0, failed: 0 },
      metrics: [],
      plan: {},
      summary: {},
      details: {
        matchedBooks: [
          {
            sourceBookId: 's1',
            sourceTitle: 'Title, "Quoted"',
            sourceAuthor: 'Author',
            targetBookId: 10,
            targetTitle: 'Target',
            strategy: 'isbn',
          },
        ],
        unresolvedBooks: [],
        duplicateBookMatches: [],
        userPreview: [],
      },
    } as never);

    const result = await service.exportRunReport(7, 'csv');

    expect(result.format).toBe('csv');
    expect(result.contentType).toBe('text/csv; charset=utf-8');
    expect(result.fileName).toBe('migration-run-7-report.csv');
    expect(result.content).toContain('section,stage,entityType');
    expect(result.content).toContain('"Title, ""Quoted"""');
  });
});
