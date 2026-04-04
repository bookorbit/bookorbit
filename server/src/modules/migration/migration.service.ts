import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';

import { CreateDryRunPlanDto } from './dto/create-dry-run-plan.dto';
import { CreateMigrationProfileDto } from './dto/create-migration-profile.dto';
import { CreateMigrationSourceDto } from './dto/create-migration-source.dto';
import { StartLiveRunDto } from './dto/start-live-run.dto';
import { TestMigrationSourceDto } from './dto/test-migration-source.dto';
import { ValidatePathMappingsDto } from './dto/validate-path-mappings.dto';
import { buildPlanHash, buildProfileHash, buildSourceSnapshotHash } from './core/plan-hash';
import { MigrationRepository } from './migration.repository';
import { SourceAdapterRegistry } from './adapters/source-adapter.registry';
import { MigrationPlannerService } from './planner/planner.service';
import { MigrationExecutorService } from './executor/migration-executor.service';
import { MigrationReportingService } from './reporting/migration-reporting.service';
import { parseBookloreConnectionConfig } from './adapters/booklore/booklore-connection-config';
import { PathMappingValidationService } from './planner/path-mapping-validation.service';

const ACTIVE_LIVE_STATES = new Set(['running']);

type MigrationSourceRow = Awaited<ReturnType<MigrationRepository['listSources']>>[number];
type MigrationProfileRow = Awaited<ReturnType<MigrationRepository['listProfiles']>>[number];
type MigrationPlanArtifactRow = Awaited<ReturnType<MigrationRepository['listPlanArtifacts']>>[number];
type MigrationRunRow = Awaited<ReturnType<MigrationRepository['listRuns']>>[number];

export interface ApiMigrationSource {
  id: number;
  type: string;
  name: string;
  connectionConfig: unknown;
  capabilities: MigrationSourceRow['capabilities'];
  lastValidatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiMigrationProfile {
  id: number;
  sourceId: number;
  name: string;
  userMappings: MigrationProfileRow['userMappings'];
  pathMappings: MigrationProfileRow['pathMappings'];
  scope: MigrationProfileRow['scope'];
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiMigrationPlanArtifact {
  id: number;
  sourceId: number;
  profileId: number;
  plan: MigrationPlanArtifactRow['plan'];
  summary: MigrationPlanArtifactRow['summary'];
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiMigrationRun {
  id: number;
  sourceId: number;
  profileId: number;
  planArtifactId: number | null;
  state: MigrationRunRow['state'];
  currentStage: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkflowStateBundle {
  source: MigrationSourceRow;
  profile: MigrationProfileRow | null;
  plan: MigrationPlanArtifactRow | null;
  run: MigrationRunRow | null;
}

@Injectable()
export class MigrationService {
  constructor(
    private readonly repo: MigrationRepository,
    private readonly adapterRegistry: SourceAdapterRegistry,
    private readonly planner: MigrationPlannerService,
    private readonly executor: MigrationExecutorService,
    private readonly reporting: MigrationReportingService,
    private readonly pathValidator: PathMappingValidationService,
  ) {}

  listSupportedSourceTypes() {
    return this.adapterRegistry.listTypes();
  }

  async testSource(dto: TestMigrationSourceDto) {
    const adapter = this.adapterRegistry.get(dto.type);
    return adapter.validate(parseConnectionConfig(dto.type, dto.connectionConfig));
  }

  async validateSourceById(sourceId: number) {
    const source = await this.repo.findSourceById(sourceId);
    if (!source) throw new NotFoundException(`Migration source not found: ${sourceId}`);

    const adapter = this.adapterRegistry.get(source.type);
    const result = await adapter.validate(parseConnectionConfig(source.type, source.connectionConfig));

    await this.repo.updateSourceValidation(source.id, {
      capabilities: {
        sourceType: result.sourceType,
        sourceVersion: result.sourceVersion,
        warnings: result.warnings,
        counts: result.counts,
        missingTables: result.missingTables,
      },
      lastValidatedAt: new Date(),
    });
    await this.repo.purgeRunState(source.id);

    return result;
  }

  async createSource(dto: CreateMigrationSourceDto, userId: number) {
    await this.assertNoGlobalActiveRun();

    const adapter = this.adapterRegistry.get(dto.type);
    const validation = await adapter.validate(parseConnectionConfig(dto.type, dto.connectionConfig));
    const payload = {
      type: dto.type.trim().toLowerCase(),
      name: dto.name.trim(),
      connectionConfig: dto.connectionConfig,
      capabilities: {
        sourceType: validation.sourceType,
        sourceVersion: validation.sourceVersion,
        warnings: validation.warnings,
        counts: validation.counts,
        missingTables: validation.missingTables,
      },
      createdByUserId: userId,
    } as const;

    const state = await this.getWorkflowState();
    const sources = await this.repo.listSources();

    const source = state.active?.source
      ? await this.repo.updateSource(state.active.source.id, {
          ...payload,
          name: buildUniqueSourceName(payload.name, payload.type, sources, state.active.source.id),
        })
      : await this.repo.createSource({
          ...payload,
          name: buildUniqueSourceName(payload.name, payload.type, sources),
        });

    if (!source) throw new InternalServerErrorException('Failed to save migration source');
    await this.repo.purgeRunState(source.id);
    return sanitizeSourceForApi(source);
  }

  listTargetUsers() {
    return this.repo.listTargetUsersForMapping();
  }

  async createProfile(dto: CreateMigrationProfileDto, userId: number) {
    await this.assertNoGlobalActiveRun();

    const source = await this.repo.findSourceById(dto.sourceId);
    if (!source) throw new NotFoundException(`Migration source not found: ${dto.sourceId}`);

    const targetUsers = await this.repo.listTargetUsersForMapping();
    const knownTargetUserIds = new Set(targetUsers.map((row) => row.id));
    const requestedTargetUserIds = [...new Set(dto.userMappings.map((row) => row.targetUserId))];
    const unknownTargetUserIds = requestedTargetUserIds.filter((targetUserId) => !knownTargetUserIds.has(targetUserId));
    if (unknownTargetUserIds.length > 0) {
      throw new BadRequestException(`Invalid target user IDs in mapping: ${unknownTargetUserIds.join(', ')}`);
    }

    const payload = {
      sourceId: dto.sourceId,
      name: dto.name.trim(),
      userMappings: dto.userMappings,
      pathMappings: dto.pathMappings ?? [],
      scope: dto.scope ?? {},
      createdByUserId: userId,
    } as const;

    const existingProfiles = await this.repo.listProfiles(dto.sourceId);
    const profile = await this.repo.createProfile({
      ...payload,
      version: (existingProfiles[0]?.version ?? 0) + 1,
    });
    if (!profile) throw new InternalServerErrorException('Failed to save migration profile');
    await this.repo.purgeRunState(dto.sourceId);
    return sanitizeProfileForApi(profile);
  }

  async suggestUserMappings(sourceId: number) {
    const source = await this.repo.findSourceById(sourceId);
    if (!source) throw new NotFoundException(`Migration source not found: ${sourceId}`);

    const adapter = this.adapterRegistry.get(source.type);
    const sourceData = await adapter.exportData(parseConnectionConfig(source.type, source.connectionConfig));
    const targetUsers = await this.repo.listTargetUsersForMapping();

    const suggestions = sourceData.users.map((sourceUser) => {
      const candidates = targetUsers
        .map((targetUser) => {
          const score = scoreUserMapping(sourceUser, targetUser);
          return {
            targetUserId: targetUser.id,
            username: targetUser.username,
            name: targetUser.name,
            email: targetUser.email,
            score,
            confidence: confidenceLabel(score),
          };
        })
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      return {
        sourceUserId: sourceUser.sourceUserId,
        username: sourceUser.username,
        name: sourceUser.name,
        email: sourceUser.email,
        suggestedTargetUserId: candidates[0]?.targetUserId ?? null,
        confidence: candidates[0]?.confidence ?? null,
        candidates,
      };
    });

    return {
      sourceId,
      generatedAt: new Date().toISOString(),
      suggestions,
    };
  }

  async getSourcePathPrefixes(sourceId: number): Promise<{ prefixes: string[] }> {
    const source = await this.repo.findSourceById(sourceId);
    if (!source) throw new NotFoundException(`Migration source not found: ${sourceId}`);
    const adapter = this.adapterRegistry.get(source.type);
    if (!adapter.fetchPathPrefixes) return { prefixes: [] };
    const prefixes = await adapter.fetchPathPrefixes(parseConnectionConfig(source.type, source.connectionConfig));
    return { prefixes };
  }

  async validatePathMappings(sourceId: number, dto: ValidatePathMappingsDto) {
    const source = await this.repo.findSourceById(sourceId);
    if (!source) throw new NotFoundException(`Migration source not found: ${sourceId}`);

    const adapter = this.adapterRegistry.get(source.type);
    const sourceData = await adapter.exportData(parseConnectionConfig(source.type, source.connectionConfig));

    const validation = await this.pathValidator.validate({
      sourceBooks: sourceData.books,
      pathMappings: dto.pathMappings,
      sampleLimit: dto.sampleLimit,
    });

    return {
      sourceId,
      validatedAt: new Date().toISOString(),
      ...validation,
    };
  }

  async createDryRunPlan(dto: CreateDryRunPlanDto, userId: number) {
    await this.assertNoGlobalActiveRun();

    const profile = await this.repo.findProfileById(dto.profileId);
    if (!profile) throw new NotFoundException(`Migration profile not found: ${dto.profileId}`);

    const source = await this.repo.findSourceById(profile.sourceId);
    if (!source) throw new NotFoundException(`Migration source not found: ${profile.sourceId}`);

    await this.repo.purgeRunState(source.id);

    const planned = await this.planner.buildPlan({
      source,
      profile,
      scopeOverride: dto.scopeOverride,
    });

    const sourceSnapshotHash = buildSourceSnapshotHash(planned.plan.snapshot);
    const profileHash = buildProfileHash(profile);
    const planHash = buildPlanHash({ sourceSnapshotHash, profileHash, plan: planned.plan });

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
    };

    const artifact = await this.repo.createPlanArtifact({
      sourceId: source.id,
      profileId: profile.id,
      sourceSnapshotHash,
      profileHash,
      planHash,
      plan: planned.plan,
      summary,
      createdByUserId: userId,
    });
    return sanitizePlanArtifactForApi(artifact);
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

    const profile = await this.repo.findProfileById(artifact.profileId);
    if (!profile) throw new NotFoundException(`Migration profile not found: ${artifact.profileId}`);
    if (profile.sourceId !== source.id) {
      throw new BadRequestException('Plan artifact profile does not match source.');
    }
    const profileMappings = Array.isArray(profile.userMappings) ? profile.userMappings : [];
    if (profileMappings.length === 0) {
      throw new BadRequestException('Save user mappings before starting migration.');
    }

    const scope = asRecord(profile.scope);
    const preflightScope = asRecord(scope.preflight);
    const pathValidatedAt = asString(preflightScope.pathValidatedAt);
    const pathMappings = Array.isArray(profile.pathMappings) ? profile.pathMappings : [];
    if (pathMappings.length > 0 && !pathValidatedAt) {
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
        `Another migration run is active for source=${artifact.sourceId} target=${targetKey} (runId=${activeRun.id}, state=${activeRun.state})`,
      );
    }
    if (!run) {
      throw new InternalServerErrorException('Failed to create migration run');
    }

    this.executor.start(run.id);
    return sanitizeRunForApi(run);
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
            source: sanitizeSourceForApi(activeBundle.source),
            profile: activeBundle.profile ? sanitizeProfileForApi(activeBundle.profile) : null,
            plan: activeBundle.plan ? sanitizePlanArtifactForApi(activeBundle.plan) : null,
            run: activeBundle.run ? sanitizeRunForApi(activeBundle.run) : null,
          }
        : null,
      hasActiveRun: activeRun != null,
    };
  }

  private resolveActiveBundle(
    source: MigrationSourceRow | null,
    profiles: Awaited<ReturnType<MigrationRepository['listProfiles']>>,
    plans: Awaited<ReturnType<MigrationRepository['listPlanArtifacts']>>,
    runs: Awaited<ReturnType<MigrationRepository['listRuns']>>,
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
}

function parseConnectionConfig(type: string, raw: unknown): unknown {
  if (type === 'booklore') {
    return parseBookloreConnectionConfig(raw);
  }
  return asRecord(raw);
}

function normalizeTargetKey(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : 'projectx';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function scoreUserMapping(
  sourceUser: { username: string; email: string | null; name: string | null },
  targetUser: { username: string; email: string | null; name: string },
): number {
  const sUsername = sourceUser.username.trim().toLowerCase();
  const tUsername = targetUser.username.trim().toLowerCase();
  const sEmail = sourceUser.email?.trim().toLowerCase() ?? null;
  const tEmail = targetUser.email?.trim().toLowerCase() ?? null;
  const sName = sourceUser.name?.trim().toLowerCase() ?? null;
  const tName = targetUser.name.trim().toLowerCase();

  if (sEmail && tEmail && sEmail === tEmail) return 100;
  if (sUsername && tUsername && sUsername === tUsername) return 95;
  if (sName && tName && sName === tName) return 85;
  if (sUsername && tUsername && (sUsername.includes(tUsername) || tUsername.includes(sUsername))) return 70;
  if (sName && tName && (sName.includes(tName) || tName.includes(sName))) return 60;
  return 0;
}

function confidenceLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 90) return 'high';
  if (score >= 70) return 'medium';
  return 'low';
}

function sanitizeSourceForApi(source: MigrationSourceRow): ApiMigrationSource {
  return {
    id: source.id,
    type: source.type,
    name: source.name,
    connectionConfig: redactConnectionConfig(source.type, source.connectionConfig),
    capabilities: source.capabilities,
    lastValidatedAt: source.lastValidatedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function sanitizeProfileForApi(profile: MigrationProfileRow): ApiMigrationProfile {
  return {
    id: profile.id,
    sourceId: profile.sourceId,
    name: profile.name,
    userMappings: profile.userMappings,
    pathMappings: profile.pathMappings,
    scope: profile.scope,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function sanitizePlanArtifactForApi(artifact: MigrationPlanArtifactRow): ApiMigrationPlanArtifact {
  return {
    id: artifact.id,
    sourceId: artifact.sourceId,
    profileId: artifact.profileId,
    plan: artifact.plan,
    summary: artifact.summary,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

function sanitizeRunForApi(run: MigrationRunRow): ApiMigrationRun {
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

function redactConnectionConfig(type: string, raw: unknown): unknown {
  const config = asRecord(raw);
  if (type !== 'booklore') return config;

  return {
    ...config,
    password: typeof config.password === 'string' && config.password.length > 0 ? '********' : '',
  };
}

function buildUniqueSourceName(
  desiredName: string,
  sourceType: string,
  sources: Array<{ id: number; type: string; name: string }>,
  ignoreId?: number,
): string {
  const trimmed = desiredName.trim();
  const safeBase = trimmed.length > 0 ? trimmed : 'Booklore Import';
  const names = new Set(sources.filter((row) => row.type === sourceType && row.id !== ignoreId).map((row) => row.name.toLowerCase()));

  if (!names.has(safeBase.toLowerCase())) return safeBase;

  let counter = 2;
  while (counter < 10_000) {
    const candidate = `${safeBase} ${counter}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
    counter += 1;
  }

  return `${safeBase} ${Date.now()}`;
}

function latestDate(...dates: Date[]): Date {
  const [first, ...rest] = dates;
  return rest.reduce((max, current) => (current > max ? current : max), first);
}
