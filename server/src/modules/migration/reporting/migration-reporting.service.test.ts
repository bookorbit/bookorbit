import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

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

  it('exports CSV with metrics, unresolved books, duplicate matches, and user preview rows', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getRunReport').mockResolvedValue({
      run: makeRun(),
      totals: { processed: 10, imported: 8, skipped: 1, unresolved: 1, failed: 0 },
      metrics: [
        {
          stage: 'user_state',
          entityType: 'reading_progress',
          processed: 10,
          imported: 8,
          skipped: 1,
          unresolved: 1,
          failed: 0,
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        } as never,
      ],
      plan: {},
      summary: {},
      details: {
        matchedBooks: [{ sourceBookId: 's1', sourceTitle: 'T', sourceAuthor: 'A', targetBookId: 1, targetTitle: 'TT', strategy: 'isbn' }],
        unresolvedBooks: [{ sourceBookId: 'sx', title: 'Unresolved Title', author: 'UA', reason: 'no_isbn_match' }],
        duplicateBookMatches: [
          {
            targetBookId: 2,
            targetTitle: 'Dup Target',
            sourceBookIds: ['s2', 's3'],
            sourceTitles: ['Source 2', null],
            strategies: ['isbn', 'title_author'],
            reason: 'duplicate_target_match',
          },
        ],
        userPreview: [
          {
            sourceUserId: 'u1',
            targetUserId: 9,
            username: 'alice',
            counts: { statuses: 1, fileProgress: 2, bookmarks: 3, annotations: 4, shelves: 5 },
          },
        ],
      },
    } as never);

    const result = await service.exportRunReport(7, 'csv');

    expect(result.format).toBe('csv');
    expect(result.content).toContain('user_state');
    expect(result.content).toContain('reading_progress');
    expect(result.content).toContain('matched_books');
    expect(result.content).toContain('s1');
    expect(result.content).toContain('unresolved_books');
    expect(result.content).toContain('sx');
    expect(result.content).toContain('duplicate_matches');
    expect(result.content).toContain('s2|s3');
    expect(result.content).toContain('user_preview');
    expect(result.content).toContain('u1');
  });

  it('exports empty CSV when no details exist', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getRunReport').mockResolvedValue({
      run: makeRun(),
      totals: { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
      metrics: [],
      plan: null,
      summary: null,
      details: { matchedBooks: [], unresolvedBooks: [], duplicateBookMatches: [], userPreview: [] },
    } as never);

    const result = await service.exportRunReport(7, 'csv');

    expect(result.format).toBe('csv');
    expect(result.content).toContain('summary');
    expect(result.content).not.toContain('matched_books');
  });

  it('handles run with no planArtifactId', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(makeRun({ planArtifactId: null }));
    repo.listRunMetrics.mockResolvedValue([]);
    repo.findBookTitlesByIds.mockResolvedValue(new Map());

    const result = await service.getRunReport(7);

    expect(result.details.matchedBooks).toHaveLength(0);
    expect(result.details.unresolvedBooks).toHaveLength(0);
    expect(result.details.userPreview).toHaveLength(0);
    expect(result.plan).toBeNull();
    expect(result.summary).toBeNull();
  });

  it('normalizes unresolved books enriching title from sourceData', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(makeRun());
    repo.listRunMetrics.mockResolvedValue([]);
    repo.findBookTitlesByIds.mockResolvedValue(new Map());
    repo.findPlanArtifactById.mockResolvedValue({
      sourceData: {
        books: [{ sourceBookId: 'sx', title: 'Enriched Title', author: 'EA', filePath: null }],
      },
      plan: {
        matchedBooks: [],
        unresolvedBooks: [{ sourceBookId: 'sx', title: null, reason: 'no_isbn_match' }],
        duplicateBookMatches: [],
      },
      summary: { perUserPreview: [] },
    });

    const result = await service.getRunReport(7);

    expect(result.details.unresolvedBooks[0]).toMatchObject({
      sourceBookId: 'sx',
      title: 'Enriched Title',
      author: 'EA',
      reason: 'no_isbn_match',
    });
  });

  it('normalizes userPreview falling back to summary.perUserPreview when plan has no userPreview', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(makeRun());
    repo.listRunMetrics.mockResolvedValue([]);
    repo.findBookTitlesByIds.mockResolvedValue(new Map());
    repo.findPlanArtifactById.mockResolvedValue({
      sourceData: null,
      plan: {
        matchedBooks: [],
        unresolvedBooks: [],
        duplicateBookMatches: [],
      },
      summary: {
        perUserPreview: [
          {
            sourceUserId: 'u2',
            targetUserId: 5,
            username: 'bob',
            counts: { statuses: 0, fileProgress: 0, bookmarks: 0, annotations: 0, shelves: 0 },
          },
        ],
      },
    });

    const result = await service.getRunReport(7);

    expect(result.details.userPreview).toHaveLength(1);
    expect(result.details.userPreview[0]).toMatchObject({ sourceUserId: 'u2', username: 'bob' });
  });

  it('returns aggregated zero totals for empty metrics', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(makeRun());
    repo.listRunMetrics.mockResolvedValue([]);
    repo.findBookTitlesByIds.mockResolvedValue(new Map());
    repo.findPlanArtifactById.mockResolvedValue({
      sourceData: null,
      plan: null,
      summary: null,
    });

    const result = await service.getRunProgress(7);

    expect(result.totals).toEqual({ processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 });
  });

  it('getRunProgress throws NotFoundException when run is missing', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(null);

    await expect(service.getRunProgress(404)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('normalizeMatchedBooks skips rows with missing fields', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(makeRun());
    repo.listRunMetrics.mockResolvedValue([]);
    repo.findBookTitlesByIds.mockResolvedValue(new Map());
    repo.findPlanArtifactById.mockResolvedValue({
      sourceData: null,
      plan: {
        matchedBooks: [
          { sourceBookId: 's1', targetBookId: 10, strategy: 'isbn' },
          { sourceBookId: null, targetBookId: 10, strategy: 'isbn' },
          { sourceBookId: 's2', targetBookId: null, strategy: 'isbn' },
          { sourceBookId: 's3', targetBookId: 10, strategy: null },
        ],
        unresolvedBooks: [],
        duplicateBookMatches: [],
      },
      summary: { perUserPreview: [] },
    });

    const result = await service.getRunReport(7);
    expect(result.details.matchedBooks).toHaveLength(1);
    expect(result.details.matchedBooks[0].sourceBookId).toBe('s1');
  });

  it('normalizeUnresolvedBooks skips rows with missing sourceBookId or reason', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(makeRun());
    repo.listRunMetrics.mockResolvedValue([]);
    repo.findBookTitlesByIds.mockResolvedValue(new Map());
    repo.findPlanArtifactById.mockResolvedValue({
      sourceData: null,
      plan: {
        matchedBooks: [],
        unresolvedBooks: [
          { sourceBookId: 'sx', reason: 'no_isbn_match' },
          { sourceBookId: null, reason: 'no_isbn_match' },
          { sourceBookId: 'sy', reason: null },
        ],
        duplicateBookMatches: [],
      },
      summary: { perUserPreview: [] },
    });

    const result = await service.getRunReport(7);
    expect(result.details.unresolvedBooks).toHaveLength(1);
  });

  it('normalizeDuplicateBookMatches skips rows with missing targetBookId or empty sourceBookIds', async () => {
    const { service, repo } = makeService();
    repo.findRunById.mockResolvedValue(makeRun());
    repo.listRunMetrics.mockResolvedValue([]);
    repo.findBookTitlesByIds.mockResolvedValue(new Map());
    repo.findPlanArtifactById.mockResolvedValue({
      sourceData: null,
      plan: {
        matchedBooks: [],
        unresolvedBooks: [],
        duplicateBookMatches: [
          { targetBookId: 5, sourceBookIds: ['s1', 's2'], strategies: ['isbn', 'title_author'] },
          { targetBookId: null, sourceBookIds: ['s3'], strategies: ['isbn'] },
          { targetBookId: 6, sourceBookIds: [], strategies: [] },
        ],
      },
      summary: { perUserPreview: [] },
    });

    const result = await service.getRunReport(7);
    expect(result.details.duplicateBookMatches).toHaveLength(1);
    expect(result.details.duplicateBookMatches[0].targetBookId).toBe(5);
  });

  it('exports CSV with newline in content correctly escaped', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getRunReport').mockResolvedValue({
      run: makeRun(),
      totals: { processed: 1, imported: 1, skipped: 0, unresolved: 0, failed: 0 },
      metrics: [],
      plan: {},
      summary: {},
      details: {
        matchedBooks: [],
        unresolvedBooks: [],
        duplicateBookMatches: [],
        userPreview: [
          {
            sourceUserId: 'u1',
            targetUserId: 1,
            username: 'user\nwith\nnewlines',
            counts: { statuses: 0, fileProgress: 0, bookmarks: 0, annotations: 0, shelves: 0 },
          },
        ],
      },
    } as never);

    const result = await service.exportRunReport(7, 'csv');
    expect(result.content).toContain('"user\nwith\nnewlines"');
  });

  it('uses format=csv case-insensitively', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getRunReport').mockResolvedValue({
      run: makeRun(),
      totals: { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
      metrics: [],
      plan: null,
      summary: null,
      details: { matchedBooks: [], unresolvedBooks: [], duplicateBookMatches: [], userPreview: [] },
    } as never);

    const result = await service.exportRunReport(7, 'CSV');
    expect(result.format).toBe('csv');
    expect(result.contentType).toBe('text/csv; charset=utf-8');
  });

  it('defaults to JSON format when format param is unrecognized', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getRunReport').mockResolvedValue({
      run: makeRun(),
      totals: { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
      metrics: [],
      plan: null,
      summary: null,
      details: { matchedBooks: [], unresolvedBooks: [], duplicateBookMatches: [], userPreview: [] },
    } as never);

    const result = await service.exportRunReport(7, 'xml');
    expect(result.format).toBe('json');
    expect(result.contentType).toBe('application/json');
  });

  it('includes run.updatedAt fallback to createdAt in CSV summary row', async () => {
    const { service } = makeService();
    const runWithoutUpdatedAt = { ...makeRun(), updatedAt: null };
    vi.spyOn(service, 'getRunReport').mockResolvedValue({
      run: runWithoutUpdatedAt as never,
      totals: { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
      metrics: [],
      plan: null,
      summary: null,
      details: { matchedBooks: [], unresolvedBooks: [], duplicateBookMatches: [], userPreview: [] },
    } as never);

    const result = await service.exportRunReport(7, 'csv');
    expect(result.content).toContain('2026-01-01T00:00:00.000Z');
  });
});
