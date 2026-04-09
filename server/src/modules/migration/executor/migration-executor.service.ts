import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { MigrationProgressEvent } from '@projectx/types';
import { asRecord } from '../core/coerce';
import { parseConnectionConfig } from '../core/connection-config';
import { MigrationEncryptionService } from '../core/migration-encryption.service';
import type { SourceExportData } from '../adapters/source-adapter.types';
import type { PlannedBookMatch, PlannedUnresolvedBook, PlannerResult, PlannedMigration } from '../planner/planner.types';
import { MigrationRepository } from '../migration.repository';
import { MigrationProgressGateway } from '../migration-progress.gateway';
import { SharedOverlaysImporter } from './shared-overlays.importer';
import { CoverImporter } from './cover.importer';
import { UserStateImporter } from './user-state.importer';
import { RunInterruptedError, type RunStateCheck } from './executor-utils';

const STAGE_ORDER = ['shared_overlays', 'book_covers', 'user_state'] as const;

@Injectable()
export class MigrationExecutorService {
  private readonly logger = new Logger(MigrationExecutorService.name);
  private readonly running = new Set<number>();
  private readonly appDataPath: string;

  constructor(
    private readonly repo: MigrationRepository,
    private readonly sharedOverlays: SharedOverlaysImporter,
    private readonly covers: CoverImporter,
    private readonly userState: UserStateImporter,
    private readonly config: ConfigService,
    private readonly encryption: MigrationEncryptionService,
    private readonly progressGateway: MigrationProgressGateway,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  start(runId: number): void {
    if (this.running.has(runId)) return;
    this.running.add(runId);

    void this.execute(runId).finally(() => {
      this.running.delete(runId);
    });
  }

  private async execute(runId: number): Promise<void> {
    const startMs = Date.now();
    this.logger.log(`[migration.execute] [start] runId=${runId} - migration execution started`);

    const run = await this.repo.findRunById(runId);
    if (!run) return;
    if (run.state !== 'running') return;
    if (!run.planArtifactId) {
      await this.failRun(runId, 'Migration run is missing a dry-run plan artifact');
      return;
    }

    const artifact = await this.repo.findPlanArtifactById(run.planArtifactId);
    const source = await this.repo.findSourceById(run.sourceId);

    if (!artifact || !source) {
      await this.failRun(runId, 'Migration run references missing source or plan artifact');
      return;
    }

    try {
      const artifactPlan = asRecord(artifact.plan) as unknown as PlannedMigration;
      const sourceData = artifact.sourceData as SourceExportData | null;
      if (!sourceData) {
        throw new Error('Plan artifact is missing cached source data. Re-run dry-run.');
      }

      const matchedBooks = Array.isArray(artifactPlan.matchedBooks) ? (artifactPlan.matchedBooks as PlannedBookMatch[]) : [];
      const unresolvedBooks = Array.isArray(artifactPlan.unresolvedBooks) ? (artifactPlan.unresolvedBooks as PlannedUnresolvedBook[]) : [];

      const planned: PlannerResult = {
        plan: artifactPlan,
        execution: {
          sourceData,
          matchedBooks,
          unresolvedBooks,
          duplicateBookMatches: Array.isArray(artifactPlan.duplicateBookMatches) ? artifactPlan.duplicateBookMatches : [],
        },
      };

      const decryptedConfig = this.encryption.decryptConfig(source.connectionConfig);
      const sourceMediaRootPath = this.resolveSourceMediaRootPath(source.type, decryptedConfig);

      const completedStages = await this.resolveCompletedStages(runId, run.currentStage);

      await this.executeStage(runId, 'shared_overlays', completedStages, async (ensureRunning) =>
        this.sharedOverlays.import(runId, planned, ensureRunning),
      );
      await this.emitRunProgress(runId, 'running', 'shared_overlays');

      await this.executeStage(runId, 'book_covers', completedStages, async (ensureRunning) =>
        this.covers.import(runId, planned, this.appDataPath, sourceMediaRootPath, ensureRunning),
      );
      await this.emitRunProgress(runId, 'running', 'book_covers');

      await this.executeStage(runId, 'user_state', completedStages, async (ensureRunning) => this.userState.import(runId, planned, ensureRunning));
      await this.assertRunIsRunning(runId);

      await this.repo.updateRunState(runId, 'completed', {
        currentStage: 'completed',
        endedAt: new Date(),
        errorMessage: null,
      });
      await this.emitRunProgress(runId, 'completed', 'completed');

      const durationMs = Date.now() - startMs;
      this.logger.log(
        `[migration.execute] [end] runId=${runId} durationMs=${durationMs} matchedBooks=${planned.plan.matchedBooks.length} unresolvedBooks=${planned.plan.unresolvedBooks.length} - migration execution completed`,
      );
    } catch (error) {
      const durationMs = Date.now() - startMs;
      if (error instanceof RunInterruptedError) {
        this.logger.warn(
          `[migration.execute] [fail] runId=${runId} durationMs=${durationMs} errorClass=RunInterruptedError error="run interrupted (state=${error.state})" - migration interrupted`,
        );
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error && error.cause instanceof Error ? ` cause="${error.cause.message}"` : '';
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[migration.execute] [fail] runId=${runId} durationMs=${durationMs} errorClass=${errorClass} error="${message}"${cause} - migration execution failed`,
      );
      const failedStage = await this.failRun(runId, message);
      await this.emitRunProgress(runId, 'failed', failedStage);
    }
  }

  private async resolveCompletedStages(runId: number, currentStage: string | null): Promise<Set<string>> {
    const completed = new Set<string>();
    if (!currentStage || currentStage === 'init') return completed;

    const currentIdx = STAGE_ORDER.indexOf(currentStage as (typeof STAGE_ORDER)[number]);
    if (currentIdx <= 0) return completed;

    for (let i = 0; i < currentIdx; i++) {
      const stage = STAGE_ORDER[i];
      const hasMetrics = await this.repo.hasStageMetrics(runId, stage);
      if (hasMetrics) completed.add(stage);
    }
    return completed;
  }

  private async executeStage(
    runId: number,
    stage: string,
    completedStages: Set<string>,
    handler: (ensureRunning: RunStateCheck) => Promise<void>,
  ): Promise<void> {
    if (completedStages.has(stage)) {
      this.logger.log(`[migration.execute] runId=${runId} stage=${stage} - skipping already completed stage`);
      return;
    }

    await this.repo.clearStageMetrics(runId, stage);
    await this.repo.updateRunState(runId, 'running', {
      currentStage: stage,
      errorMessage: null,
    });

    const ensureRunning = this.createRunStateChecker(runId);
    await ensureRunning(true);
    await handler(ensureRunning);
    await ensureRunning(true);
  }

  private createRunStateChecker(runId: number, checkEvery = 25): RunStateCheck {
    let sinceLastCheck = 0;
    return async (force = false) => {
      sinceLastCheck += 1;
      if (!force && sinceLastCheck % checkEvery !== 0) return;
      await this.assertRunIsRunning(runId);
    };
  }

  private async assertRunIsRunning(runId: number): Promise<void> {
    const run = await this.repo.findRunById(runId);
    const state = run?.state ?? 'missing';
    if (!run || state !== 'running') {
      throw new RunInterruptedError(runId, state);
    }
  }

  private resolveSourceMediaRootPath(sourceType: string, connectionConfig: unknown): string | null {
    if (sourceType !== 'booklore') return null;
    const config = parseConnectionConfig(sourceType, connectionConfig) as Record<string, unknown>;
    return typeof config.mediaRootPath === 'string' ? config.mediaRootPath : null;
  }

  private async failRun(runId: number, message: string): Promise<string | null> {
    const current = await this.repo.findRunById(runId);
    await this.repo.updateRunState(runId, 'failed', {
      endedAt: new Date(),
      errorMessage: message,
    });
    return current?.currentStage ?? null;
  }

  private async emitRunProgress(runId: number, state: string, currentStage: string | null): Promise<void> {
    try {
      const metrics = await this.repo.listRunMetrics(runId);
      const totals = metrics.reduce(
        (acc, row) => ({
          processed: acc.processed + row.processed,
          imported: acc.imported + row.imported,
          skipped: acc.skipped + row.skipped,
          unresolved: acc.unresolved + row.unresolved,
          failed: acc.failed + row.failed,
        }),
        { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
      );

      const event: MigrationProgressEvent = {
        runId,
        state: state as MigrationProgressEvent['state'],
        currentStage,
        totals,
        metrics: metrics.map((m) => ({
          stage: m.stage,
          entityType: m.entityType,
          processed: m.processed,
          imported: m.imported,
          skipped: m.skipped,
          unresolved: m.unresolved,
          failed: m.failed,
          updatedAt: m.updatedAt.toISOString(),
        })),
      };
      this.progressGateway.emitProgress(event);
    } catch {
      // Non-critical: don't let progress emission failures break the migration
    }
  }
}
