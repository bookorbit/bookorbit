import { BadGatewayException, BadRequestException, ConflictException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DEFAULT_INDEXER_CATEGORIES } from '@bookorbit/types';
import type {
  IndexerManagerItem,
  IndexerManagerListResult,
  IndexerManagerSourceItem,
  IndexerManagerSyncResult,
  IndexerManagerTestResult,
} from '@bookorbit/types';

import { isUniqueViolation } from '../../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { PrivateAddressException, ensureSafeUrl } from '../../../common/utils/ssrf.utils';
import type { RequestIndexerManagerRow, RequestIndexerRow } from '../../../db/schema';
import { RequestCredentialService } from '../request-credential.service';
import type { CreateIndexerManagerDto, UpdateIndexerManagerDto, UpdateManagedIndexerSourceDto } from './dto/indexer-manager.dto';
import { IndexerManagerRepository, type IndexerManagerWithSources } from './indexer-manager.repository';
import { ProwlarrClient, type ProwlarrConnection } from './prowlarr.client';

@Injectable()
export class IndexerManagerService {
  private readonly logger = new Logger(IndexerManagerService.name);

  constructor(
    private readonly repo: IndexerManagerRepository,
    private readonly credentials: RequestCredentialService,
    private readonly prowlarr: ProwlarrClient,
  ) {}

  async findAll(): Promise<IndexerManagerListResult> {
    const rows = await this.repo.findAll();
    return { managers: rows.map(toItem), encryptionConfigured: this.credentials.isConfigured() };
  }

  async findOne(id: number): Promise<IndexerManagerItem> {
    return toItem(await this.requireManager(id));
  }

  async create(dto: CreateIndexerManagerDto): Promise<IndexerManagerItem> {
    if (!dto.credential.trim()) throw new BadRequestException('A Prowlarr API key is required');
    await this.assertReachableUrl(dto.baseUrl, dto.allowPrivateAddress ?? false);
    let created: RequestIndexerManagerRow;
    try {
      created = await this.repo.create({
        name: dto.name.trim(),
        color: dto.color ?? null,
        type: dto.type,
        enabled: dto.enabled ?? true,
        baseUrl: dto.baseUrl.trim(),
        credentialsEnc: this.credentials.encrypt(dto.credential),
        allowPrivateAddress: dto.allowPrivateAddress ?? false,
        syncNewIndexers: dto.syncNewIndexers ?? true,
        perIndexerTimeoutSeconds: dto.perIndexerTimeoutSeconds ?? 20,
        overallSearchBudgetSeconds: dto.overallSearchBudgetSeconds ?? 60,
        autoExpandCategories: dto.autoExpandCategories ?? false,
        inheritSeedLimits: dto.inheritSeedLimits ?? true,
        networkProfile: dto.networkProfile ?? null,
      });
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }

    this.logger.log(`[request_indexer_manager.create] [end] managerId=${created.id} type=${created.type} - indexer manager created`);
    try {
      return (await this.sync(created.id)).manager;
    } catch {
      return this.findOne(created.id);
    }
  }

  async update(id: number, dto: UpdateIndexerManagerDto): Promise<IndexerManagerItem> {
    const existing = (await this.requireManager(id)).manager;
    const baseUrl = dto.baseUrl?.trim() ?? existing.baseUrl;
    const allowPrivate = dto.allowPrivateAddress ?? existing.allowPrivateAddress;
    if (dto.baseUrl !== undefined || dto.allowPrivateAddress !== undefined) await this.assertReachableUrl(baseUrl, allowPrivate);

    const patch: Partial<RequestIndexerManagerRow> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.baseUrl !== undefined) patch.baseUrl = baseUrl;
    if (dto.credential !== undefined) {
      if (!dto.credential.trim()) throw new BadRequestException('A Prowlarr API key is required');
      patch.credentialsEnc = this.credentials.encrypt(dto.credential);
    }
    if (dto.allowPrivateAddress !== undefined) patch.allowPrivateAddress = dto.allowPrivateAddress;
    if (dto.syncNewIndexers !== undefined) patch.syncNewIndexers = dto.syncNewIndexers;
    if (dto.perIndexerTimeoutSeconds !== undefined) patch.perIndexerTimeoutSeconds = dto.perIndexerTimeoutSeconds;
    if (dto.overallSearchBudgetSeconds !== undefined) patch.overallSearchBudgetSeconds = dto.overallSearchBudgetSeconds;
    if (dto.autoExpandCategories !== undefined) patch.autoExpandCategories = dto.autoExpandCategories;
    if (dto.inheritSeedLimits !== undefined) patch.inheritSeedLimits = dto.inheritSeedLimits;
    if (dto.networkProfile !== undefined) patch.networkProfile = dto.networkProfile;

    try {
      if (Object.keys(patch).length > 0 && !(await this.repo.update(id, patch))) {
        throw new NotFoundException('Indexer manager not found');
      }
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }

    if (dto.enabled === false) await this.repo.setSourcesAvailable(id, false);
    if (
      dto.enabled === true ||
      dto.baseUrl !== undefined ||
      dto.credential !== undefined ||
      dto.allowPrivateAddress !== undefined ||
      dto.networkProfile !== undefined ||
      dto.inheritSeedLimits !== undefined
    ) {
      try {
        return (await this.sync(id)).manager;
      } catch {
        return this.findOne(id);
      }
    }
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.requireManager(id);
    await this.repo.delete(id);
    this.logger.log(`[request_indexer_manager.delete] [end] managerId=${id} - indexer manager removed`);
  }

  async test(id: number): Promise<IndexerManagerTestResult> {
    const row = (await this.requireManager(id)).manager;
    try {
      const connection = this.resolveConnection(row);
      const [{ version }, sources] = await Promise.all([this.prowlarr.status(connection), this.prowlarr.indexers(connection)]);
      await this.repo.recordTestResult(id, true, null, version);
      return { success: true, ...(version ? { version } : {}), sourceCount: sources.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repo.recordTestResult(id, false, message, null);
      throw new BadGatewayException({ message, errorCode: 'INDEXER_MANAGER_TEST_FAILED', statusCode: HttpStatus.BAD_GATEWAY });
    }
  }

  async sync(id: number): Promise<IndexerManagerSyncResult> {
    const current = await this.requireManager(id);
    const started = Date.now();
    try {
      const discovered = await this.prowlarr.indexers(this.resolveConnection(current.manager));
      const outcome = await this.repo.syncProwlarrSources(current.manager, discovered, {
        torrent: DEFAULT_INDEXER_CATEGORIES.torznab,
        usenet: DEFAULT_INDEXER_CATEGORIES.newznab,
      });
      this.logger.log(
        `[request_indexer_manager.sync] [end] managerId=${id} discovered=${discovered.length} created=${outcome.created} updated=${outcome.updated} unavailable=${outcome.unavailable} durationMs=${Date.now() - started} - synchronized Prowlarr indexers`,
      );
      return { manager: await this.findOne(id), discovered: discovered.length, ...outcome };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repo.recordSyncFailure(id, message);
      this.logger.warn(
        `[request_indexer_manager.sync] [fail] managerId=${id} durationMs=${Date.now() - started} errorClass=${error instanceof Error ? error.constructor.name : typeof error} error="${sanitizeLogValue(message)}" - Prowlarr synchronization failed`,
      );
      throw error;
    }
  }

  async updateSource(managerId: number, sourceId: number, dto: UpdateManagedIndexerSourceDto): Promise<IndexerManagerItem> {
    await this.requireManager(managerId);
    const patch: Pick<UpdateManagedIndexerSourceDto, 'enabled' | 'color'> = {};
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.color !== undefined) patch.color = dto.color;
    if (Object.keys(patch).length === 0) throw new BadRequestException('Set enabled or color for the managed indexer');
    if (!(await this.repo.updateSource(managerId, sourceId, patch))) {
      throw new NotFoundException('Managed indexer not found');
    }
    return this.findOne(managerId);
  }

  private resolveConnection(row: RequestIndexerManagerRow): ProwlarrConnection {
    return {
      baseUrl: row.baseUrl,
      apiKey: this.credentials.decrypt(row.credentialsEnc),
      allowPrivateAddress: row.allowPrivateAddress,
      networkProfile: row.networkProfile ?? null,
    };
  }

  private async requireManager(id: number): Promise<IndexerManagerWithSources> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Indexer manager not found');
    return row;
  }

  private async assertReachableUrl(baseUrl: string, allowPrivate: boolean): Promise<void> {
    try {
      await ensureSafeUrl(baseUrl, { allowPrivate });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException({
        message,
        errorCode: error instanceof PrivateAddressException ? 'INDEXER_MANAGER_URL_PRIVATE' : 'INDEXER_MANAGER_URL_UNSAFE',
      });
    }
  }

  private translateUniqueViolation(error: unknown): unknown {
    return isUniqueViolation(error)
      ? new ConflictException({ message: 'An indexer manager with this name already exists', errorCode: 'INDEXER_MANAGER_NAME_TAKEN' })
      : error;
  }
}

function toItem({ manager, sources }: IndexerManagerWithSources): IndexerManagerItem {
  return {
    id: manager.id,
    name: manager.name,
    color: manager.color ?? null,
    type: manager.type,
    enabled: manager.enabled,
    baseUrl: manager.baseUrl,
    hasCredential: Boolean(manager.credentialsEnc),
    allowPrivateAddress: manager.allowPrivateAddress,
    syncNewIndexers: manager.syncNewIndexers,
    perIndexerTimeoutSeconds: manager.perIndexerTimeoutSeconds,
    overallSearchBudgetSeconds: manager.overallSearchBudgetSeconds,
    autoExpandCategories: manager.autoExpandCategories,
    inheritSeedLimits: manager.inheritSeedLimits,
    networkProfile: manager.networkProfile ?? null,
    lastTestedAt: manager.lastTestedAt?.toISOString() ?? null,
    lastTestOk: manager.lastTestOk,
    lastErrorMessage: manager.lastErrorMessage,
    lastSyncedAt: manager.lastSyncedAt?.toISOString() ?? null,
    lastSyncOk: manager.lastSyncOk,
    lastSyncError: manager.lastSyncError,
    version: manager.version,
    sources: sources.map(toSourceItem),
    createdAt: manager.createdAt.toISOString(),
    updatedAt: manager.updatedAt.toISOString(),
  };
}

function toSourceItem(source: RequestIndexerRow): IndexerManagerSourceItem {
  const metadata = source.managerMetadata;
  const protocol = metadata?.protocol ?? (source.adapterType === 'newznab' ? 'usenet' : 'torrent');
  return {
    id: source.id,
    externalId: source.managerExternalId ?? String(source.id),
    name: metadata?.displayName ?? source.name,
    color: source.color ?? null,
    implementation: metadata?.implementation ?? null,
    protocol,
    adapterType: source.adapterType as 'torznab' | 'newznab',
    enabled: source.enabled,
    available: source.managerAvailable,
    priority: metadata?.priority ?? null,
    lastSeenAt: source.managerLastSeenAt?.toISOString() ?? null,
    lastSearchAt: source.lastSearchAt?.toISOString() ?? null,
    lastSearchOk: source.lastSearchOk,
    lastSearchError: source.lastSearchError,
  };
}
