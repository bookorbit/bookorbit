import { BadRequestException, ConflictException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  BookRequestDownloadStatus,
  DownloadClientErrorCode,
  DownloadClientReconciliationAttempt,
  DownloadClientReconciliationResult,
} from '@bookorbit/types';

import { BookRequestGateway } from '../book-request.gateway';
import { BookRequestDownloadRepository, type ReconciliationAttemptRow } from '../fulfillment/book-request-download.repository';
import type { OwnedDownloadClientItem } from './download-client-adapter';
import { DownloadClientConfigService } from './download-client-config.service';
import { DownloadClientRegistry } from './download-client-registry';

const ADOPTABLE_STATES = new Set<OwnedDownloadClientItem['state']>(['queued', 'downloading', 'completed']);

@Injectable()
export class DownloadClientReconciliationService {
  private readonly logger = new Logger(DownloadClientReconciliationService.name);

  constructor(
    private readonly clients: DownloadClientConfigService,
    private readonly registry: DownloadClientRegistry,
    private readonly downloads: BookRequestDownloadRepository,
    private readonly gateway: BookRequestGateway,
  ) {}

  async reconcile(clientId: number): Promise<DownloadClientReconciliationResult> {
    const config = await this.clients.resolveConfig(clientId);
    const inventory = await this.registry.require(config.adapterType).listOwned(config);
    if (!inventory.supported) {
      return {
        clientId,
        supported: false,
        ownershipMarker: config.category,
        truncated: false,
        items: [],
        missingAttempts: [],
      };
    }

    const hashes = [...new Set(inventory.items.map((item) => item.infoHash.toLowerCase()))];
    const [tracked, adoptable, active] = await Promise.all([
      this.downloads.findTrackedForClientHashes(clientId, hashes),
      this.downloads.findAdoptableForHashes(hashes),
      inventory.truncated ? Promise.resolve([]) : this.downloads.findActiveForClient(clientId),
    ]);
    const trackedByHash = firstByHash(tracked);
    const adoptableByHash = groupByHash(adoptable);
    const inventoryHashes = new Set(hashes);

    return {
      clientId,
      supported: true,
      ownershipMarker: config.category,
      truncated: inventory.truncated,
      items: inventory.items.map((item) => ({
        infoHash: item.infoHash.toLowerCase(),
        name: item.name,
        state: item.state,
        progressPercent: item.progressPercent,
        trackedAttempt: toAttempt(trackedByHash.get(item.infoHash.toLowerCase()) ?? null),
        adoptableAttempts: ADOPTABLE_STATES.has(item.state)
          ? (adoptableByHash.get(item.infoHash.toLowerCase()) ?? []).map((row) => toAttempt(row))
          : [],
      })),
      missingAttempts: active
        .filter((row) => row.download.clientHash !== null && !inventoryHashes.has(row.download.clientHash.toLowerCase()))
        .map((row) => toAttempt(row)),
    };
  }

  async adopt(clientId: number, infoHash: string, downloadId: number): Promise<DownloadClientReconciliationAttempt> {
    const hash = normalizeHash(infoHash);
    const config = await this.clients.resolveConfig(clientId);
    const inventory = await this.registry.require(config.adapterType).listOwned(config);
    if (!inventory.supported) throw reconciliationError('DOWNLOAD_CLIENT_RECONCILIATION_UNSUPPORTED', 'This client cannot enumerate owned downloads');

    const item = inventory.items.find((entry) => entry.infoHash.toLowerCase() === hash);
    if (!item || !ADOPTABLE_STATES.has(item.state)) {
      throw reconciliationError('DOWNLOAD_CLIENT_RECONCILIATION_NOT_ADOPTABLE', 'That client item is no longer available to adopt');
    }

    const candidates = await this.downloads.findAdoptableForHashes([hash]);
    const candidate = candidates.find((entry) => entry.download.id === downloadId);
    if (!candidate) {
      throw reconciliationError('DOWNLOAD_CLIENT_RECONCILIATION_NOT_ADOPTABLE', 'That attempt can no longer adopt this client item');
    }

    const status = adoptionStatus(item.state);
    const adopted = await this.downloads.adoptFailedAttempt(downloadId, clientId, hash, {
      status,
      progressPercent: item.progressPercent,
      downloadedBytes: item.downloadedBytes,
      totalBytes: item.totalBytes,
      contentPath: item.contentPath,
    });
    if (!adopted) throw new ConflictException('That request changed before the client item could be adopted');

    this.gateway.emitChanged();
    this.logger.log(
      `[download_client.reconcile] [end] clientId=${clientId} downloadId=${downloadId} requestId=${adopted.requestId} hash=${hash} action=adopt - client item attached to its failed attempt`,
    );
    return toAttempt({ download: adopted, requestTitle: candidate.requestTitle });
  }

  async removeOrphan(clientId: number, infoHash: string, deleteFiles: boolean): Promise<void> {
    const hash = normalizeHash(infoHash);
    const config = await this.clients.resolveConfig(clientId);
    const adapter = this.registry.require(config.adapterType);
    const inventory = await adapter.listOwned(config);
    if (!inventory.supported) throw reconciliationError('DOWNLOAD_CLIENT_RECONCILIATION_UNSUPPORTED', 'This client cannot enumerate owned downloads');
    if (!inventory.items.some((entry) => entry.infoHash.toLowerCase() === hash)) throw new NotFoundException('That client item no longer exists');

    const tracked = await this.downloads.findTrackedForClientHashes(clientId, [hash]);
    if (tracked.length > 0) {
      throw reconciliationError('DOWNLOAD_CLIENT_RECONCILIATION_NOT_ORPHAN', 'That client item is still attached to a download attempt');
    }

    await adapter.remove(hash, config, { deleteFiles });
    this.logger.log(
      `[download_client.reconcile] [end] clientId=${clientId} hash=${hash} action=remove deleteFiles=${deleteFiles} - orphaned client item removed`,
    );
  }
}

function normalizeHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(normalized)) throw new BadRequestException('Invalid client hash');
  return normalized;
}

function adoptionStatus(state: OwnedDownloadClientItem['state']): Extract<BookRequestDownloadStatus, 'queued' | 'downloading' | 'completed'> {
  if (state === 'queued') return 'queued';
  if (state === 'completed') return 'completed';
  return 'downloading';
}

function firstByHash(rows: ReconciliationAttemptRow[]): Map<string, ReconciliationAttemptRow> {
  const result = new Map<string, ReconciliationAttemptRow>();
  for (const row of rows) {
    const hash = row.download.clientHash?.toLowerCase();
    if (hash && !result.has(hash)) result.set(hash, row);
  }
  return result;
}

function groupByHash(rows: ReconciliationAttemptRow[]): Map<string, ReconciliationAttemptRow[]> {
  const result = new Map<string, ReconciliationAttemptRow[]>();
  for (const row of rows) {
    const hash = row.download.clientHash?.toLowerCase();
    if (!hash) continue;
    const bucket = result.get(hash) ?? [];
    bucket.push(row);
    result.set(hash, bucket);
  }
  return result;
}

function toAttempt(row: ReconciliationAttemptRow): DownloadClientReconciliationAttempt;
function toAttempt(row: null): null;
function toAttempt(row: ReconciliationAttemptRow | null): DownloadClientReconciliationAttempt | null;
function toAttempt(row: ReconciliationAttemptRow | null): DownloadClientReconciliationAttempt | null {
  if (!row) return null;
  return {
    downloadId: row.download.id,
    requestId: row.download.requestId,
    requestTitle: row.requestTitle,
    status: row.download.status as BookRequestDownloadStatus,
  };
}

function reconciliationError(errorCode: DownloadClientErrorCode, message: string): BadRequestException {
  return new BadRequestException({ message, errorCode, statusCode: HttpStatus.BAD_REQUEST });
}
