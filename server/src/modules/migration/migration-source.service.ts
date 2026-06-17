import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';

import type { MigrationSource } from '../../db/schema';
import { CreateMigrationSourceDto } from './dto/create-migration-source.dto';
import { TestMigrationSourceDto } from './dto/test-migration-source.dto';
import { parseConnectionConfig, PASSWORD_REDACTED_SENTINEL } from './core/connection-config';
import { sanitizeSourceForApi } from './core/api-sanitizers';
import { MigrationEncryptionService } from './core/migration-encryption.service';
import { MigrationRepository } from './migration.repository';
import { SourceAdapterRegistry } from './adapters/source-adapter.registry';

const ACTIVE_LIVE_STATES = new Set(['running']);

@Injectable()
export class MigrationSourceService {
  constructor(
    private readonly repo: MigrationRepository,
    private readonly adapterRegistry: SourceAdapterRegistry,
    private readonly encryption: MigrationEncryptionService,
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
    const decryptedConfig = this.encryption.decryptConfig(source.connectionConfig);
    const result = await adapter.validate(parseConnectionConfig(source.type, decryptedConfig));

    await this.repo.updateSourceValidation(source.id, {
      capabilities: {
        ok: result.ok,
        sourceType: result.sourceType,
        sourceVersion: result.sourceVersion,
        warnings: result.warnings,
        counts: result.counts,
        missingTables: result.missingTables,
      },
      lastValidatedAt: result.ok ? new Date() : null,
    });
    await this.repo.purgeRunState(source.id);

    return result;
  }

  async createSource(dto: CreateMigrationSourceDto, userId: number) {
    await this.assertNoGlobalActiveRun();

    const adapter = this.adapterRegistry.get(dto.type);

    const sources = await this.repo.listSources();
    const existingSource = sources[0] ?? null;
    const connectionConfig = resolveConnectionConfig(dto.connectionConfig, existingSource, this.encryption);

    const validation = await adapter.validate(parseConnectionConfig(dto.type, connectionConfig));
    if (!validation.ok) {
      throw new BadRequestException(
        `Migration source validation failed. Missing required tables: ${validation.missingTables.join(', ') || 'unknown'}`,
      );
    }
    const encryptedConfig = this.encryption.encryptConfig(connectionConfig);
    const payload = {
      type: dto.type.trim().toLowerCase(),
      name: dto.name.trim(),
      connectionConfig: encryptedConfig,
      capabilities: {
        ok: validation.ok,
        sourceType: validation.sourceType,
        sourceVersion: validation.sourceVersion,
        warnings: validation.warnings,
        counts: validation.counts,
        missingTables: validation.missingTables,
      },
      createdByUserId: userId,
    } as const;

    const source = existingSource
      ? await this.repo.updateSource(existingSource.id, {
          ...payload,
          name: buildUniqueSourceName(payload.name, payload.type, sources, existingSource.id),
        })
      : await this.repo.createSource({
          ...payload,
          name: buildUniqueSourceName(payload.name, payload.type, sources),
        });

    if (!source) throw new InternalServerErrorException('Failed to save migration source');
    await this.repo.purgeRunState(source.id);
    return sanitizeSourceForApi({
      ...source,
      connectionConfig: this.encryption.decryptConfig(source.connectionConfig),
    });
  }

  async resetSource(sourceId: number): Promise<void> {
    await this.assertNoGlobalActiveRun();

    const source = await this.repo.findSourceById(sourceId);
    if (!source) throw new NotFoundException(`Migration source not found: ${sourceId}`);

    const runs = await this.repo.listRuns(sourceId);
    if (runs.length > 0) {
      throw new BadRequestException('Cannot reset migration setup after a migration run has been created');
    }

    const deleted = await this.repo.deleteSource(sourceId);
    if (!deleted) throw new InternalServerErrorException('Failed to reset migration setup');
  }

  async getSourcePathPrefixes(sourceId: number): Promise<{ prefixes: string[] }> {
    const source = await this.repo.findSourceById(sourceId);
    if (!source) throw new NotFoundException(`Migration source not found: ${sourceId}`);
    const adapter = this.adapterRegistry.get(source.type);
    if (!adapter.fetchPathPrefixes) return { prefixes: [] };
    const decryptedConfig = this.encryption.decryptConfig(source.connectionConfig);
    const prefixes = await adapter.fetchPathPrefixes(parseConnectionConfig(source.type, decryptedConfig));
    return { prefixes };
  }

  private async assertNoGlobalActiveRun() {
    const runs = await this.repo.listRuns();
    const active = runs.find((row) => ACTIVE_LIVE_STATES.has(row.state));
    if (!active) return;
    throw new ConflictException(`Another migration run is active (runId=${active.id}, state=${active.state}).`);
  }
}

export function resolveConnectionConfig(
  incoming: Record<string, unknown>,
  existingSource: MigrationSource | null,
  encryption: MigrationEncryptionService,
): Record<string, unknown> {
  if (!existingSource) return incoming;

  const existingConfig = encryption.decryptConfig(existingSource.connectionConfig);
  const resolved = { ...incoming };

  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string' && value === PASSWORD_REDACTED_SENTINEL) {
      resolved[key] = existingConfig[key] ?? '';
    }
  }

  return resolved;
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
