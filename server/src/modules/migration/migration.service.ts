import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';

import type { MigrationSource, MigrationProfile, MigrationPlanArtifact, MigrationRun } from '../../db/schema';
import { CreateDryRunPlanDto } from './dto/create-dry-run-plan.dto';
import type { ResolveDuplicateMatchesDto } from './dto/resolve-duplicate-matches.dto';
import { StartLiveRunDto } from './dto/start-live-run.dto';
import { buildPathMappingsHash, buildPlanHash, buildProfileHash, buildSourceSnapshotHash } from './core/plan-hash';
import { asInteger, asRecord, asString } from './core/coerce';
import {
  type ApiMigrationPlanArtifact,
  type ApiMigrationRun,
  sanitizeSourceForApi,
  sanitizeProfileForApi,
  sanitizePlanArtifactForApi,
  sanitizeRunForApi,
} from './core/api-sanitizers';
import { MigrationEncryptionService } from './core/migration-encryption.service';
import { MigrationRepository } from './migration.repository';
import { buildUserPreview, MigrationPlannerService } from './planner/planner.service';
import type { SourceExportData } from './adapters/source-adapter.types';
import type { MatchStrategy, PlannedBookMatch } from './planner/planner.types';
import { MigrationExecutorService } from './executor/migration-executor.service';
import { MigrationReportingService } from './reporting/migration-reporting.service';

export type { ApiMigrationSource, ApiMigrationProfile, ApiMigrationPlanArtifact, ApiMigrationRun } from './core/api-sanitizers';

const ACTIVE_LIVE_STATES = new Set(['running']);

interface WorkflowStateBundle {
  source: MigrationSource;
  profile: MigrationProfile | null;
  plan: MigrationPlanArtifact | null;
  run: MigrationRun | null;
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    private readonly repo: MigrationRepository,
    private readonly planner: MigrationPlannerService,
    private readonly executor: MigrationExecutorService,
    private readonly reporting: MigrationReportingService,
    private readonly encryption: MigrationEncryptionService,
  ) {}

  async createDryRunPlan(dto: CreateDryRunPlanDto, userId: number) {
    await this.assertNoGlobalActiveRun();

    const profile = await this.repo.findProfileById(dto.profileId);
    if (!profile) throw new NotFoundException(`Migration profile not found: ${dto.profileId}`);

    const source = await this.repo.findSourceById(profile.sourceId);
    if (!source) throw new NotFoundException(`Migration source not found: ${profile.sourceId}`);

    await this.repo.purgeRunState(source.id);

    const planned = await this.planner.buildPlan({
      source: this.withDecryptedConfig(source),
      profile,
      scopeOverride: dto.scopeOverride,
    });

    const sourceSnapshotHash = buildSourceSnapshotHash(planned.plan.snapshot);
    const profileHash = buildProfileHash(profile);
    const planHash = buildPlanHash({ sourceSnapshotHash, profileHash, plan: planned.plan });
    const planSizeBytes = jsonByteLength(planned.plan);
    const sourceDataSizeBytes = jsonByteLength(planned.execution.sourceData);

    const summary = {
      generatedAt: planned.plan.generatedAt,
      status: planned.plan.duplicateBookMatches.length > 0 ? 'blocked' : 'ready_for_live_run',
      matchedBooks: planned.plan.matchedBooks.length,
      unresolvedBooks: planned.plan.unresolvedBooks.length,
      duplicateBookMatches: planned.plan.duplicateBookMatches.length,
      unresolvedByReason: planned.plan.unresolvedBooks.reduce<Record<string, number>>((acc, row) => {
        acc[row.reason] = (acc[row.reason] ?? 0) + 1;
        return acc;
      }, {}),
      mappedUsers: planned.plan.userPreview.length,
      perUserPreview: planned.plan.userPreview,
      artifactSizeBytes: {
        plan: planSizeBytes,
        sourceData: sourceDataSizeBytes,
        total: planSizeBytes + sourceDataSizeBytes,
      },
    };

    const artifact = await this.repo.createPlanArtifact({
      sourceId: source.id,
      profileId: profile.id,
      sourceSnapshotHash,
      profileHash,
      planHash,
      plan: planned.plan,
      sourceData: planned.execution.sourceData,
      summary,
      createdByUserId: userId,
    });
    return sanitizePlanArtifactWithDuplicateCandidates(artifact);
  }

  async resolveDuplicateMatches(artifactId: number, dto: ResolveDuplicateMatchesDto) {
    const artifact = await this.repo.findPlanArtifactById(artifactId);
    if (!artifact) throw new NotFoundException(`Migration plan artifact not found: ${artifactId}`);

    const plan = asRecord(artifact.plan);
    const duplicates: Array<{
      targetBookId: number;
      matches?: PlannedBookMatch[];
      sourceBookIds: string[];
      strategies: MatchStrategy[];
      reason: string;
    }> = Array.isArray(plan.duplicateBookMatches) ? plan.duplicateBookMatches : [];

    if (duplicates.length === 0) {
      throw new BadRequestException('No duplicate matches to resolve.');
    }

    const dupMap = new Map(duplicates.map((d) => [d.targetBookId, d]));
    const matchedBooks: PlannedBookMatch[] = Array.isArray(plan.matchedBooks) ? ([...plan.matchedBooks] as PlannedBookMatch[]) : [];
    const unresolvedBooks: unknown[] = Array.isArray(plan.unresolvedBooks) ? [...plan.unresolvedBooks] : [];
    const sourceData = artifact.sourceData as SourceExportData | null;
    const sourceBooksById = new Map(sourceData?.books.map((book) => [book.sourceBookId, book]) ?? []);
    const resolved = new Set<number>();

    for (const resolution of dto.resolutions) {
      const dup = dupMap.get(resolution.targetBookId);
      if (!dup) {
        throw new BadRequestException(`No duplicate match found for target book ${resolution.targetBookId}.`);
      }
      const dupMatches = normalizeDuplicateMatches(dup);
      if (!dupMatches.some((match) => match.sourceBookId === resolution.selectedSourceBookId)) {
        throw new BadRequestException(
          `Source book ${resolution.selectedSourceBookId} is not in the duplicate group for target book ${resolution.targetBookId}.`,
        );
      }

      const winnerStrategy = dupMatches.find((match) => match.sourceBookId === resolution.selectedSourceBookId)?.strategy ?? 'title_author';
      matchedBooks.push({
        sourceBookId: resolution.selectedSourceBookId,
        targetBookId: resolution.targetBookId,
        strategy: winnerStrategy,
      });

      for (const duplicateMatch of dupMatches) {
        if (duplicateMatch.sourceBookId !== resolution.selectedSourceBookId) {
          unresolvedBooks.push({
            sourceBookId: duplicateMatch.sourceBookId,
            title: sourceBooksById.get(duplicateMatch.sourceBookId)?.title ?? null,
            reason: 'duplicate_target_match',
          });
        }
      }

      resolved.add(resolution.targetBookId);
    }

    const remainingDuplicates = duplicates.filter((d) => !resolved.has(d.targetBookId));
    if (remainingDuplicates.length > 0) {
      throw new BadRequestException(`All duplicate groups must be resolved. Missing: ${remainingDuplicates.map((d) => d.targetBookId).join(', ')}`);
    }

    const userMappings = parsePlanUserMappings(plan.userMappings);
    const matchedBookIds = new Set(matchedBooks.map((entry) => entry.sourceBookId));
    const userPreview = sourceData ? buildUserPreview(sourceData, userMappings, matchedBookIds) : plan.userPreview;
    const unresolvedByReason = summarizeUnresolvedByReason(unresolvedBooks);

    const updatedPlan = { ...plan, matchedBooks, unresolvedBooks, duplicateBookMatches: [], userPreview };
    const summary = asRecord(artifact.summary);
    const updatedSummary = {
      ...summary,
      status: 'ready_for_live_run',
      matchedBooks: matchedBooks.length,
      unresolvedBooks: unresolvedBooks.length,
      duplicateBookMatches: 0,
      unresolvedByReason,
      perUserPreview: userPreview,
      mappedUsers: Array.isArray(userPreview) ? userPreview.length : summary.mappedUsers,
    };

    const updated = await this.repo.updatePlanArtifact(artifact.id, {
      plan: updatedPlan,
      sourceData: artifact.sourceData,
      summary: updatedSummary,
    });

    this.logger.log(`[plan.resolve_duplicates] [end] artifactId=${artifactId} resolved=${resolved.size} - duplicates resolved`);
    return sanitizePlanArtifactWithDuplicateCandidates(updated);
  }

  async startLiveRun(dto: StartLiveRunDto, userId: number) {
    await this.assertNoGlobalActiveRun();

    const artifact = await this.repo.findPlanArtifactById(dto.planArtifactId);
    if (!artifact) throw new NotFoundException(`Migration plan artifact not found: ${dto.planArtifactId}`);
    const artifactPlan = asRecord(artifact.plan);
    const duplicateBookMatches = Array.isArray(artifactPlan.duplicateBookMatches) ? artifactPlan.duplicateBookMatches : [];
    if (duplicateBookMatches.length > 0) {
      throw new BadRequestException('Cannot start migration: dry-run has duplicate target book matches. Resolve matching before running migration.');
    }

    const source = await this.repo.findSourceById(artifact.sourceId);
    if (!source) throw new NotFoundException(`Migration source not found: ${artifact.sourceId}`);
    if (!source.lastValidatedAt) {
      throw new BadRequestException('Validate source before starting migration.');
    }
    const sourceCapabilities = asRecord(source.capabilities);
    if (sourceCapabilities.ok === false) {
      const missingTables = Array.isArray(sourceCapabilities.missingTables) ? sourceCapabilities.missingTables.join(', ') : 'unknown';
      throw new BadRequestException(`Source validation is not successful. Missing required tables: ${missingTables || 'unknown'}`);
    }

    const profile = await this.repo.findProfileById(artifact.profileId);
    if (!profile) throw new NotFoundException(`Migration profile not found: ${artifact.profileId}`);
    if (profile.sourceId !== source.id) {
      throw new BadRequestException('Plan artifact profile does not match source.');
    }
    const profileMappings = Array.isArray(profile.userMappings) ? profile.userMappings : [];
    if (profileMappings.length === 0) {
      throw new BadRequestException('Save user mappings before starting migration.');
    }

    const targetUserIds = profileMappings.map((m) => asInteger(asRecord(m).targetUserId)).filter((id): id is number => id !== null);
    if (targetUserIds.length > 0) {
      const existingUsers = await this.repo.listTargetUsersForMapping();
      const existingIds = new Set(existingUsers.map((u) => u.id));
      const missing = targetUserIds.filter((id) => !existingIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(`Target users no longer exist: ${missing.join(', ')}. Update user mappings.`);
      }
    }

    const scope = asRecord(profile.scope);
    const preflightScope = asRecord(scope.preflight);
    const pathValidatedAt = asString(preflightScope.pathValidatedAt);
    const pathMappingsHash = asString(preflightScope.pathMappingsHash);
    const pathMappings = Array.isArray(profile.pathMappings) ? profile.pathMappings : [];
    if (pathMappings.length > 0 && (!pathValidatedAt || pathMappingsHash !== buildPathMappingsHash(pathMappings))) {
      throw new BadRequestException('Validate path mappings before starting migration.');
    }

    const freshnessAnchor = latestDate(source.lastValidatedAt, source.updatedAt, profile.updatedAt);
    if (artifact.createdAt < freshnessAnchor) {
      throw new BadRequestException('Dry-run plan is stale. Re-run dry-run after latest source/profile updates.');
    }

    const targetKey = normalizeTargetKey(dto.targetKey);
    const { run, activeRun } = await this.repo.createRunWithLock({
      sourceId: artifact.sourceId,
      profileId: artifact.profileId,
      planArtifactId: artifact.id,
      targetKey,
      state: 'running',
      currentStage: 'init',
      triggeredByUserId: userId,
      startedAt: new Date(),
    });
    if (!run && activeRun) {
      throw new ConflictException(
        `Another migration run is active (runId=${activeRun.id}, source=${activeRun.sourceId}, target=${activeRun.targetKey}, state=${activeRun.state})`,
      );
    }
    if (!run) {
      throw new InternalServerErrorException('Failed to create migration run');
    }

    this.executor.start(run.id);
    return sanitizeRunForApi(run);
  }

  async cancelRun(runId: number): Promise<ApiMigrationRun> {
    const run = await this.repo.findRunById(runId);
    if (!run) throw new NotFoundException(`Migration run not found: ${runId}`);
    if (run.state !== 'running') {
      throw new BadRequestException(`Cannot cancel run in state "${run.state}" - only running migrations can be cancelled`);
    }
    const updated = await this.repo.updateRunState(runId, 'failed', {
      currentStage: 'cancelled',
      endedAt: new Date(),
      errorMessage: 'Migration cancelled by user',
    });
    if (!updated) throw new InternalServerErrorException('Failed to cancel migration run');
    return sanitizeRunForApi(updated);
  }

  async retryFailedRun(runId: number): Promise<ApiMigrationRun> {
    await this.assertNoGlobalActiveRun();

    const run = await this.repo.findRunById(runId);
    if (!run) throw new NotFoundException(`Migration run not found: ${runId}`);
    if (run.state !== 'failed') {
      throw new BadRequestException(`Cannot retry run in state "${run.state}" - only failed migrations can be retried`);
    }
    if (!run.planArtifactId) {
      throw new BadRequestException('Run is missing a plan artifact. Create a new dry-run plan.');
    }

    const source = await this.repo.findSourceById(run.sourceId);
    if (!source) throw new NotFoundException(`Migration source no longer exists: ${run.sourceId}`);

    const artifact = await this.repo.findPlanArtifactById(run.planArtifactId);
    if (!artifact) throw new NotFoundException(`Plan artifact no longer exists: ${run.planArtifactId}`);

    const updated = await this.repo.updateRunState(runId, 'running', {
      endedAt: null,
      errorMessage: null,
    });
    if (!updated) throw new InternalServerErrorException('Failed to reset migration run for retry');

    this.executor.start(updated.id);
    return sanitizeRunForApi(updated);
  }

  getRunProgress(runId: number) {
    return this.reporting.getRunProgress(runId);
  }

  getRunReport(runId: number) {
    return this.reporting.getRunReport(runId);
  }

  exportRunReport(runId: number, format?: string) {
    return this.reporting.exportRunReport(runId, format);
  }

  async getWorkflowState() {
    const [sources, profiles, plans, runs] = await Promise.all([
      this.repo.listSources(),
      this.repo.listProfiles(),
      this.repo.listPlanArtifacts(),
      this.repo.listRuns(),
    ]);

    const activeRun = runs.find((row) => ACTIVE_LIVE_STATES.has(row.state)) ?? null;
    const sourceById = new Map(sources.map((row) => [row.id, row]));
    const activeSource = activeRun ? (sourceById.get(activeRun.sourceId) ?? null) : (sources[0] ?? null);
    const activeBundle = this.resolveActiveBundle(activeSource, profiles, plans, runs);

    return {
      active: activeBundle
        ? {
            source: sanitizeSourceForApi(this.withDecryptedConfig(activeBundle.source)),
            profile: activeBundle.profile ? sanitizeProfileForApi(activeBundle.profile) : null,
            plan: activeBundle.plan ? sanitizePlanArtifactWithDuplicateCandidates(activeBundle.plan) : null,
            run: activeBundle.run ? sanitizeRunForApi(activeBundle.run) : null,
          }
        : null,
      hasActiveRun: activeRun != null,
    };
  }

  private resolveActiveBundle(
    source: MigrationSource | null,
    profiles: MigrationProfile[],
    plans: MigrationPlanArtifact[],
    runs: MigrationRun[],
  ): WorkflowStateBundle | null {
    if (!source) return null;
    const profile = profiles.find((row) => row.sourceId === source.id) ?? null;
    const plan = profile
      ? (plans.find((row) => row.profileId === profile.id) ?? plans.find((row) => row.sourceId === source.id) ?? null)
      : (plans.find((row) => row.sourceId === source.id) ?? null);
    const run = runs.find((row) => row.sourceId === source.id) ?? null;
    return { source, profile, plan, run };
  }

  private async assertNoGlobalActiveRun() {
    const runs = await this.repo.listRuns();
    const active = runs.find((row) => ACTIVE_LIVE_STATES.has(row.state));
    if (!active) return;
    throw new ConflictException(`Another migration run is active (runId=${active.id}, state=${active.state}).`);
  }

  private withDecryptedConfig(source: MigrationSource): MigrationSource {
    return { ...source, connectionConfig: this.encryption.decryptConfig(source.connectionConfig) };
  }
}

function normalizeDuplicateMatches(duplicate: {
  targetBookId: number;
  matches?: PlannedBookMatch[];
  sourceBookIds: string[];
  strategies: MatchStrategy[];
}): PlannedBookMatch[] {
  if (Array.isArray(duplicate.matches) && duplicate.matches.length > 0) {
    return duplicate.matches.filter((match) => match.sourceBookId && Number.isFinite(match.targetBookId));
  }

  return duplicate.sourceBookIds.map((sourceBookId, index) => ({
    sourceBookId,
    targetBookId: duplicate.targetBookId,
    strategy: duplicate.strategies[index] ?? duplicate.strategies[0] ?? 'title_author',
  }));
}

function sanitizePlanArtifactWithDuplicateCandidates(artifact: MigrationPlanArtifact): ApiMigrationPlanArtifact {
  const sourceData = artifact.sourceData as SourceExportData | null;
  const hydratedPlan = hydrateDuplicateSourceCandidates(artifact.plan, sourceData);
  return sanitizePlanArtifactForApi({ ...artifact, plan: hydratedPlan });
}

function hydrateDuplicateSourceCandidates(planRaw: unknown, sourceData: SourceExportData | null): unknown {
  const plan = asRecord(planRaw);
  const duplicateBookMatches = Array.isArray(plan.duplicateBookMatches) ? plan.duplicateBookMatches : [];
  if (duplicateBookMatches.length === 0) return planRaw;

  const sourceBooksById = new Map(sourceData?.books.map((book) => [book.sourceBookId, book]) ?? []);
  if (sourceBooksById.size === 0) return planRaw;

  let changed = false;
  const hydratedDuplicates = duplicateBookMatches.map((item) => {
    const row = asRecord(item);
    const sourceBookIds = Array.isArray(row.sourceBookIds) ? row.sourceBookIds.filter((id): id is string => typeof id === 'string') : [];
    if (sourceBookIds.length === 0) return item;

    const existingCandidates = Array.isArray(row.sourceCandidates) ? row.sourceCandidates : [];
    if (existingCandidates.length > 0) {
      const hasMetadata = existingCandidates.some((candidate) => {
        const value = asRecord(candidate);
        return typeof value.title === 'string' || typeof value.author === 'string' || typeof value.filePath === 'string';
      });
      if (hasMetadata) return item;
    }

    const duplicateMatches = Array.isArray(row.matches) ? row.matches : [];
    const strategyBySourceBookId = new Map<string, MatchStrategy>();
    for (const duplicateMatch of duplicateMatches) {
      const match = asRecord(duplicateMatch);
      const sourceBookId = asString(match.sourceBookId);
      const strategy = asString(match.strategy);
      if (sourceBookId && (strategy === 'isbn' || strategy === 'file_hash' || strategy === 'path_mapping' || strategy === 'title_author')) {
        strategyBySourceBookId.set(sourceBookId, strategy);
      }
    }

    const strategies = Array.isArray(row.strategies) ? row.strategies.map((value) => asString(value)) : [];
    const sourceCandidates = sourceBookIds.map((sourceBookId, index) => {
      const sourceBook = sourceBooksById.get(sourceBookId);
      const strategyFromMatch = strategyBySourceBookId.get(sourceBookId);
      const strategyFromList = strategies[index] ?? strategies[0] ?? null;
      const strategy = strategyFromMatch ?? toMatchStrategy(strategyFromList) ?? 'title_author';
      return {
        sourceBookId,
        title: sourceBook?.title ?? null,
        author: sourceBook?.author ?? null,
        filePath: sourceBook?.filePath ?? null,
        strategy,
      };
    });

    changed = true;
    return { ...row, sourceCandidates };
  });

  if (!changed) return planRaw;
  return { ...plan, duplicateBookMatches: hydratedDuplicates };
}

function toMatchStrategy(value: string | null): MatchStrategy | null {
  if (value === 'isbn' || value === 'file_hash' || value === 'path_mapping' || value === 'title_author') return value;
  return null;
}

function parsePlanUserMappings(raw: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(raw)) return out;

  for (const item of raw) {
    const row = asRecord(item);
    const sourceUserId = asString(row.sourceUserId);
    const targetUserId = asInteger(row.targetUserId);
    if (sourceUserId && targetUserId != null) out.set(sourceUserId, targetUserId);
  }

  return out;
}

function summarizeUnresolvedByReason(rows: unknown[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const reason = asString(asRecord(row).reason);
    if (reason) acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function normalizeTargetKey(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : 'bookorbit';
}

function latestDate(...dates: Date[]): Date {
  const [first, ...rest] = dates;
  return rest.reduce((max, current) => (current > max ? current : max), first);
}
