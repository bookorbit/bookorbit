import { Injectable, NotFoundException } from '@nestjs/common';
import { WORKER_WRITABLE_BOOK_REQUEST_STATUSES } from '@bookorbit/types';
import type { BookRequestItem, BookRequestSeedStatus } from '@bookorbit/types';

import type { RequestUser } from '../../../common/types/request-user';
import { BookRequestGateway } from '../book-request.gateway';
import { BookRequestRepository } from '../book-request.repository';
import { BookRequestService } from '../book-request.service';
import { DownloadClientConfigService } from '../download-clients/download-client-config.service';
import { DownloadClientRegistry } from '../download-clients/download-client-registry';
import { BookRequestDownloadRepository } from './book-request-download.repository';
import { DownloadRemovalService } from './download-removal.service';

/**
 * What the download client is doing with a request's torrent after the bytes are down, and the
 * operator-facing half of removing one.
 *
 * Seed state is read live rather than stored. A seed outlives its import by weeks, and keeping
 * every finished download in the poll loop would mean an ever-growing number of client calls to
 * maintain a number nobody is looking at.
 */
@Injectable()
export class RequestSeedService {
  constructor(
    private readonly downloads: BookRequestDownloadRepository,
    private readonly requests: BookRequestRepository,
    private readonly clients: DownloadClientConfigService,
    private readonly registry: DownloadClientRegistry,
    private readonly bookRequests: BookRequestService,
    private readonly removal: DownloadRemovalService,
    private readonly gateway: BookRequestGateway,
  ) {}

  /** Null when there is no attempt to ask about, or when the client no longer holds the torrent. */
  async getSeedStatus(requestId: number): Promise<BookRequestSeedStatus | null> {
    const latest = (await this.downloads.findLatestForRequests([requestId])).get(requestId);
    if (!latest) {
      if (!(await this.requests.findById(requestId))) throw new NotFoundException('Book request not found');
      return null;
    }

    const { download, downloadClientName } = latest;
    if (download.source === 'direct_url' || download.downloadClientId === null) return null;
    // A refused attempt never reached a client, so there is no torrent to report a seed for.
    const clientHash = download.clientHash;
    if (clientHash === null) return null;

    const config = await this.clients.resolveConfig(download.downloadClientId);
    const adapter = this.registry.require(config.adapterType);
    const [status] = await adapter.status([clientHash], config);
    if (!status) return null;

    return {
      downloadId: download.id,
      downloadClientId: download.downloadClientId,
      downloadClientName,
      clientHash,
      seeding: status.seed?.seeding ?? false,
      ratio: status.seed?.ratio ?? null,
      ratioGoal: status.seed?.ratioGoal ?? null,
      seedingTimeSeconds: status.seed?.seedingTimeSeconds ?? null,
      seedingTimeGoalMinutes: status.seed?.seedingTimeGoalMinutes ?? null,
      uploadedBytes: status.seed?.uploadedBytes ?? null,
    };
  }

  /**
   * Removing a torrent that is still working takes the request with it, because nothing else is
   * going to finish it. The row is failed directly rather than through the retry path, so the
   * automation does not immediately undo a removal an approver asked for.
   */
  async removeFromClient(requestId: number, downloadId: number, deleteFiles: boolean, user: RequestUser): Promise<BookRequestItem> {
    const wasInFlight = await this.removal.removeAttempt(requestId, downloadId, deleteFiles, user.username);

    if (wasInFlight) {
      // Conditional, so removing the transfer under a request somebody has already cancelled or
      // filed does not reopen it as a failure.
      await this.requests.updateIf(requestId, WORKER_WRITABLE_BOOK_REQUEST_STATUSES, {
        status: 'failed',
        statusReason: `Removed from the download client by ${user.username}`,
      });
      this.gateway.emitChanged();
    }

    return this.bookRequests.getOne(requestId, user);
  }
}
