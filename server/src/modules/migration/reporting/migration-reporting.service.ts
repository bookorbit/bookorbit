import { Injectable, NotFoundException } from '@nestjs/common';

import type { SourceBook, SourceExportData } from '../adapters/source-adapter.types';
import { asRecord } from '../core/coerce';
import { MigrationRepository } from '../migration.repository';
import { sanitizeRunForApi } from '../core/api-sanitizers';
import type { PlannedBookMatch, PlannedDuplicateBookMatch, PlannedUserPreview } from '../planner/planner.types';

@Injectable()
export class MigrationReportingService {
  constructor(private readonly repo: MigrationRepository) {}

  async getRunReport(runId: number) {
    const run = await this.repo.findRunById(runId);
    if (!run) throw new NotFoundException(`Migration run not found: ${runId}`);

    const [metrics, artifact] = await Promise.all([
      this.repo.listRunMetrics(runId),
      run.planArtifactId ? this.repo.findPlanArtifactById(run.planArtifactId) : Promise.resolve(null),
    ]);
    const totals = summarizeMetrics(metrics);
    const sourceData = (artifact?.sourceData as SourceExportData | null) ?? null;
    const plan = artifact?.plan ?? null;
    const summary = artifact?.summary ?? null;
    const sourceBooksById = new Map(sourceData?.books.map((book) => [book.sourceBookId, book]) ?? []);
    const matchedBooks = normalizeMatchedBooks(asRecord(plan).matchedBooks);
    const unresolvedBooks = normalizeUnresolvedBooks(asRecord(plan).unresolvedBooks, sourceBooksById);
    const duplicateBookMatches = normalizeDuplicateBookMatches(asRecord(plan).duplicateBookMatches);
    const userPreview = normalizeUserPreview(asRecord(plan).userPreview, asRecord(summary).perUserPreview);
    const targetTitlesById = await this.repo.findBookTitlesByIds(
      uniqueNumbers([...matchedBooks.map((row) => row.targetBookId), ...duplicateBookMatches.map((row) => row.targetBookId)]),
    );

    return {
      run: sanitizeRunForApi(run),
      totals,
      metrics,
      plan,
      summary,
      details: {
        matchedBooks: matchedBooks.map((row) => ({
          sourceBookId: row.sourceBookId,
          sourceTitle: sourceBooksById.get(row.sourceBookId)?.title ?? null,
          sourceAuthor: sourceBooksById.get(row.sourceBookId)?.author ?? null,
          targetBookId: row.targetBookId,
          targetTitle: targetTitlesById.get(row.targetBookId) ?? null,
          strategy: row.strategy,
        })),
        unresolvedBooks,
        duplicateBookMatches: duplicateBookMatches.map((row) => ({
          targetBookId: row.targetBookId,
          targetTitle: targetTitlesById.get(row.targetBookId) ?? null,
          sourceBookIds: row.sourceBookIds,
          sourceTitles: row.sourceBookIds.map((sourceBookId) => sourceBooksById.get(sourceBookId)?.title ?? null),
          strategies: row.strategies,
          reason: row.reason,
        })),
        userPreview,
      },
    };
  }

  async getRunProgress(runId: number) {
    const run = await this.repo.findRunById(runId);
    if (!run) throw new NotFoundException(`Migration run not found: ${runId}`);

    const metrics = await this.repo.listRunMetrics(runId);
    const totals = metrics.reduce(
      (acc, row) => ({
        processed: acc.processed + row.processed,
        imported: acc.imported + row.imported,
        skipped: acc.skipped + row.skipped,
        unresolved: acc.unresolved + row.unresolved,
        failed: acc.failed + row.failed,
      }),
      {
        processed: 0,
        imported: 0,
        skipped: 0,
        unresolved: 0,
        failed: 0,
      },
    );

    return {
      run: sanitizeRunForApi(run),
      totals,
      metrics,
    };
  }

  async exportRunReport(runId: number, requestedFormat?: string) {
    const report = await this.getRunReport(runId);
    const format = requestedFormat?.toLowerCase() === 'csv' ? 'csv' : 'json';

    if (format === 'json') {
      return {
        format,
        fileName: `migration-run-${runId}-report.json`,
        contentType: 'application/json',
        content: JSON.stringify(report, null, 2),
      };
    }

    const rows: Record<string, string | number | null>[] = [
      {
        section: 'summary',
        stage: null,
        entityType: null,
        processed: report.totals.processed,
        imported: report.totals.imported,
        skipped: report.totals.skipped,
        unresolved: report.totals.unresolved,
        failed: report.totals.failed,
        sourceBookId: null,
        sourceTitle: null,
        sourceAuthor: null,
        targetBookId: null,
        targetTitle: null,
        strategy: null,
        sourceUserId: null,
        targetUserId: null,
        username: null,
        reason: null,
        details: `matchedBooks=${report.details.matchedBooks.length}; unresolvedBooks=${report.details.unresolvedBooks.length}; mappedUsers=${report.details.userPreview.length}`,
        code: 'summary',
        message: `Run state: ${report.run.state}`,
        createdAt: report.run.updatedAt?.toISOString() ?? report.run.createdAt.toISOString(),
      },
      ...report.metrics.map((row) => ({
        section: 'metrics',
        stage: row.stage,
        entityType: row.entityType,
        processed: row.processed,
        imported: row.imported,
        skipped: row.skipped,
        unresolved: row.unresolved,
        failed: row.failed,
        sourceBookId: null,
        sourceTitle: null,
        sourceAuthor: null,
        targetBookId: null,
        targetTitle: null,
        strategy: null,
        sourceUserId: null,
        targetUserId: null,
        username: null,
        reason: null,
        details: null,
        code: null,
        message: null,
        createdAt: row.updatedAt.toISOString(),
      })),
      ...report.details.matchedBooks.map((row) => ({
        section: 'matched_books',
        stage: 'shared_overlays',
        entityType: 'book_match',
        processed: null,
        imported: null,
        skipped: null,
        unresolved: null,
        failed: null,
        sourceBookId: row.sourceBookId,
        sourceTitle: row.sourceTitle,
        sourceAuthor: row.sourceAuthor,
        targetBookId: row.targetBookId,
        targetTitle: row.targetTitle,
        strategy: row.strategy,
        sourceUserId: null,
        targetUserId: null,
        username: null,
        reason: null,
        details: null,
        code: null,
        message: null,
        createdAt: report.run.updatedAt?.toISOString() ?? report.run.createdAt.toISOString(),
      })),
      ...report.details.unresolvedBooks.map((row) => ({
        section: 'unresolved_books',
        stage: null,
        entityType: 'book_match',
        processed: null,
        imported: null,
        skipped: null,
        unresolved: null,
        failed: null,
        sourceBookId: row.sourceBookId,
        sourceTitle: row.title,
        sourceAuthor: row.author,
        targetBookId: null,
        targetTitle: null,
        strategy: null,
        sourceUserId: null,
        targetUserId: null,
        username: null,
        reason: row.reason,
        details: null,
        code: null,
        message: null,
        createdAt: report.run.updatedAt?.toISOString() ?? report.run.createdAt.toISOString(),
      })),
      ...report.details.duplicateBookMatches.map((row) => ({
        section: 'duplicate_matches',
        stage: null,
        entityType: 'book_match',
        processed: null,
        imported: null,
        skipped: null,
        unresolved: null,
        failed: null,
        sourceBookId: row.sourceBookIds.join('|'),
        sourceTitle: row.sourceTitles.filter((title): title is string => typeof title === 'string').join(' | '),
        sourceAuthor: null,
        targetBookId: row.targetBookId,
        targetTitle: row.targetTitle,
        strategy: row.strategies.join('|'),
        sourceUserId: null,
        targetUserId: null,
        username: null,
        reason: row.reason,
        details: `sourceBookIds=${row.sourceBookIds.join('|')}`,
        code: null,
        message: null,
        createdAt: report.run.updatedAt?.toISOString() ?? report.run.createdAt.toISOString(),
      })),
      ...report.details.userPreview.map((row) => ({
        section: 'user_preview',
        stage: 'user_state',
        entityType: 'user_preview',
        processed: null,
        imported: null,
        skipped: null,
        unresolved: null,
        failed: null,
        sourceBookId: null,
        sourceTitle: null,
        sourceAuthor: null,
        targetBookId: null,
        targetTitle: null,
        strategy: null,
        sourceUserId: row.sourceUserId,
        targetUserId: row.targetUserId,
        username: row.username,
        reason: null,
        details: `statuses=${row.counts.statuses}; fileProgress=${row.counts.fileProgress}; bookmarks=${row.counts.bookmarks}; annotations=${row.counts.annotations}; shelves=${row.counts.shelves}`,
        code: null,
        message: null,
        createdAt: report.run.updatedAt?.toISOString() ?? report.run.createdAt.toISOString(),
      })),
    ];

    return {
      format,
      fileName: `migration-run-${runId}-report.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: toCsv(rows),
    };
  }
}

function toCsv(rows: Record<string, string | number | null>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map((header) => csvCell(row[header]));
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function summarizeMetrics(metrics: Array<{ processed: number; imported: number; skipped: number; unresolved: number; failed: number }>) {
  return metrics.reduce(
    (acc, row) => ({
      processed: acc.processed + row.processed,
      imported: acc.imported + row.imported,
      skipped: acc.skipped + row.skipped,
      unresolved: acc.unresolved + row.unresolved,
      failed: acc.failed + row.failed,
    }),
    {
      processed: 0,
      imported: 0,
      skipped: 0,
      unresolved: 0,
      failed: 0,
    },
  );
}

function normalizeMatchedBooks(value: unknown): PlannedBookMatch[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const record = asRecord(row);
    const sourceBookId = typeof record.sourceBookId === 'string' ? record.sourceBookId : null;
    const targetBookId = typeof record.targetBookId === 'number' ? record.targetBookId : null;
    const strategy = typeof record.strategy === 'string' ? record.strategy : null;
    if (!sourceBookId || targetBookId == null || !strategy) return [];
    return [{ sourceBookId, targetBookId, strategy: strategy as PlannedBookMatch['strategy'] }];
  });
}

function normalizeUnresolvedBooks(
  value: unknown,
  sourceBooksById: Map<string, SourceBook>,
): Array<{ sourceBookId: string; title: string | null; author: string | null; reason: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const record = asRecord(row);
    const sourceBookId = typeof record.sourceBookId === 'string' ? record.sourceBookId : null;
    const reason = typeof record.reason === 'string' ? record.reason : null;
    if (!sourceBookId || !reason) return [];
    const sourceBook = sourceBooksById.get(sourceBookId);
    return [
      {
        sourceBookId,
        title: (typeof record.title === 'string' ? record.title : null) ?? sourceBook?.title ?? null,
        author: sourceBook?.author ?? null,
        reason,
      },
    ];
  });
}

function normalizeDuplicateBookMatches(value: unknown): PlannedDuplicateBookMatch[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const record = asRecord(row);
    const targetBookId = typeof record.targetBookId === 'number' ? record.targetBookId : null;
    const sourceBookIds = Array.isArray(record.sourceBookIds) ? record.sourceBookIds.filter((id): id is string => typeof id === 'string') : [];
    const strategies = Array.isArray(record.strategies)
      ? record.strategies.filter((strategy): strategy is PlannedBookMatch['strategy'] => typeof strategy === 'string')
      : [];
    if (targetBookId == null || sourceBookIds.length === 0) return [];
    return [
      {
        targetBookId,
        sourceBookIds,
        matches: sourceBookIds.map((sourceBookId, index) => ({
          sourceBookId,
          targetBookId,
          strategy: strategies[index] ?? 'title_author',
        })),
        strategies,
        reason: 'duplicate_target_match',
      } satisfies PlannedDuplicateBookMatch,
    ];
  });
}

function normalizeUserPreview(planValue: unknown, summaryValue: unknown): PlannedUserPreview[] {
  const rows = Array.isArray(planValue) ? planValue : Array.isArray(summaryValue) ? summaryValue : [];
  return rows.flatMap((row) => {
    const record = asRecord(row);
    const counts = asRecord(record.counts);
    const sourceUserId = typeof record.sourceUserId === 'string' ? record.sourceUserId : null;
    const targetUserId = typeof record.targetUserId === 'number' ? record.targetUserId : null;
    const username = typeof record.username === 'string' ? record.username : null;
    if (!sourceUserId || targetUserId == null || !username) return [];
    return [
      {
        sourceUserId,
        targetUserId,
        username,
        counts: {
          statuses: typeof counts.statuses === 'number' ? counts.statuses : 0,
          fileProgress: typeof counts.fileProgress === 'number' ? counts.fileProgress : 0,
          bookmarks: typeof counts.bookmarks === 'number' ? counts.bookmarks : 0,
          annotations: typeof counts.annotations === 'number' ? counts.annotations : 0,
          shelves: typeof counts.shelves === 'number' ? counts.shelves : 0,
        },
      },
    ];
  });
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))];
}
