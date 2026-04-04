import { Injectable, NotFoundException } from '@nestjs/common';

import { MigrationRepository } from '../migration.repository';

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

    return {
      run: sanitizeRunForApi(run),
      metrics,
      plan: artifact?.plan ?? null,
      summary: artifact?.summary ?? null,
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
        processed: report.metrics.reduce((sum, row) => sum + row.processed, 0),
        imported: report.metrics.reduce((sum, row) => sum + row.imported, 0),
        skipped: report.metrics.reduce((sum, row) => sum + row.skipped, 0),
        unresolved: report.metrics.reduce((sum, row) => sum + row.unresolved, 0),
        failed: report.metrics.reduce((sum, row) => sum + row.failed, 0),
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
        code: null,
        message: null,
        createdAt: row.updatedAt.toISOString(),
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

function sanitizeRunForApi(run: Awaited<ReturnType<MigrationRepository['listRuns']>>[number]) {
  return {
    id: run.id,
    sourceId: run.sourceId,
    profileId: run.profileId,
    planArtifactId: run.planArtifactId,
    state: run.state,
    currentStage: run.currentStage,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
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
