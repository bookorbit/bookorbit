import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IN_FLIGHT_BOOK_REQUEST_DOWNLOAD_STATUSES } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { BookRequestDownloadRow } from '../../../db/schema';
import { DownloadClientConfigService } from '../download-clients/download-client-config.service';
import { DownloadClientRegistry } from '../download-clients/download-client-registry';
import { BookRequestDownloadRepository } from './book-request-download.repository';
import { DirectDownloadService } from './direct-download.service';

export interface DownloadRemovalOutcome {
  /** True when a download was actually handed to the client. False when there was nothing to remove. */
  removed: boolean;
  /** The client's refusal, when it had one. Best-effort callers report it; strict callers throw. */
  error: string | null;
}

/**
 * The one action BookOrbit takes against a download it grabbed. It lives on its own because both
 * ends of the request lifecycle need it: an operator removing a seed, a request being cancelled
 * under a live transfer, and direct-download staging being cleaned after it reaches the Book Dock.
 */
@Injectable()
export class DownloadRemovalService {
  private readonly logger = new Logger(DownloadRemovalService.name);

  constructor(
    private readonly downloads: BookRequestDownloadRepository,
    private readonly clients: DownloadClientConfigService,
    private readonly registry: DownloadClientRegistry,
    private readonly direct: DirectDownloadService,
  ) {}

  /**
   * Strict: an operator who pressed Remove wants the client's own refusal, not a shrug. Resolves
   * to whether the attempt was still working, which is what decides the request's own fate.
   */
  async removeAttempt(requestId: number, downloadId: number, deleteFiles: boolean, actor: string): Promise<boolean> {
    const download = await this.downloads.findById(downloadId);
    if (!download || download.requestId !== requestId) throw new NotFoundException('That download attempt does not belong to this request');
    if (download.source !== 'direct_url' && download.downloadClientId === null) {
      throw new BadRequestException('That attempt is no longer attached to a download client');
    }

    await this.detach(download, deleteFiles);
    return this.failIfInFlight(download, `Removed from the download client by ${actor}`);
  }

  /**
   * Best-effort: the caller is stopping or deleting the request itself, and a download client that
   * is down must not be what keeps a stuck request stuck. The outcome carries the failure so the
   * caller can record that a transfer may still be sitting in the client.
   */
  async removeLatestForRequest(requestId: number, deleteFiles: boolean, actor: string): Promise<DownloadRemovalOutcome> {
    const latest = (await this.downloads.findLatestForRequests([requestId])).get(requestId);
    const download = latest?.download;
    if (!download || (download.source !== 'direct_url' && download.downloadClientId === null)) return { removed: false, error: null };

    let error: string | null = null;
    try {
      await this.detach(download, deleteFiles);
    } catch (caught: unknown) {
      error = caught instanceof Error ? caught.message : String(caught);
      this.logger.warn(
        `[book_request.remove_download] [fail] requestId=${requestId} downloadId=${download.id} clientId=${download.downloadClientId ?? 'direct'} source=${download.source} errorClass=${(caught as Error)?.constructor?.name ?? 'Error'} error="${sanitizeLogValue(error)}" - download could not be detached from the client`,
      );
    }

    // The attempt leaves the in-flight set either way. A client that refused the detach is worth
    // telling the caller about, but it is not a reason to leave a live attempt behind a request
    // somebody is settling: the next poll would write its progress straight back onto the settled
    // row, and the monitor would go on asking the client about it forever.
    await this.failIfInFlight(
      download,
      error ? `Removed by ${actor}, but the download client refused: ${error}` : `Removed from the download client by ${actor}`,
    );
    return { removed: error === null, error };
  }

  /**
   * Best-effort detach of one attempt, for a caller that is about to lose the row it belongs to.
   *
   * Unlike the two above it leaves the attempt's status alone: the row is on its way out with the
   * request it hangs off, and writing a status onto something that is about to be deleted only
   * risks failing before the detach that actually mattered. Resolves to the client's refusal, or
   * null when there was nothing to detach or the detach worked.
   */
  async detachAttempt(download: BookRequestDownloadRow, deleteFiles: boolean): Promise<string | null> {
    try {
      await this.detach(download, deleteFiles);
      return null;
    } catch (caught: unknown) {
      const error = caught instanceof Error ? caught.message : String(caught);
      this.logger.warn(
        `[book_request.remove_download] [fail] requestId=${download.requestId} downloadId=${download.id} clientId=${download.downloadClientId ?? 'direct'} source=${download.source} errorClass=${(caught as Error)?.constructor?.name ?? 'Error'} error="${sanitizeLogValue(error)}" - download could not be detached from the client`,
      );
      return error;
    }
  }

  /** A direct file has no seed to preserve once its Book Dock copy exists. Cleanup is best-effort. */
  async cleanupStagedDirectDownload(download: BookRequestDownloadRow): Promise<void> {
    if (download.source !== 'direct_url') return;

    try {
      await this.detach(download, true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[book_request.staging_cleanup] [fail] requestId=${download.requestId} downloadId=${download.id} errorClass=${(error as Error)?.constructor?.name ?? 'Error'} error="${sanitizeLogValue(message)}" - direct-download staging was left on disk`,
      );
    }
  }

  /** A direct file is ours to drop; a torrent is detached from the client that holds it. */
  private async detach(download: BookRequestDownloadRow, deleteFiles: boolean): Promise<void> {
    // An attempt a source refused was never handed to anything, so there is nothing holding it.
    if (download.clientHash === null) return;

    const isDirect = download.source === 'direct_url';
    // There is no swarm to preserve on a staged file, so its bytes always go with the attempt.
    const shouldDeleteFiles = isDirect || deleteFiles;

    if (isDirect) {
      await this.direct.remove(download.clientHash, { deleteFiles: shouldDeleteFiles });
    } else {
      const config = await this.clients.resolveConfig(download.downloadClientId as number);
      const adapter = this.registry.require(config.adapterType);
      await adapter.remove(download.clientHash, config, { deleteFiles: shouldDeleteFiles });
    }

    this.logger.log(
      `[book_request.remove_download] [end] requestId=${download.requestId} downloadId=${download.id} clientId=${download.downloadClientId ?? 'direct'} source=${download.source} deleteFiles=${shouldDeleteFiles} - download removed`,
    );
  }

  /**
   * Removing a transfer that is still working takes the attempt with it, because nothing else is
   * going to finish it. The row is failed here directly rather than through the retry path, so
   * automation does not immediately undo a removal a person asked for.
   *
   * Conditional on the row as it stands rather than as it was read: an attempt the poll loop
   * finished or failed in the meantime keeps the outcome it reached.
   */
  private async failIfInFlight(download: BookRequestDownloadRow, reason: string): Promise<boolean> {
    const failed = await this.downloads.updateIf(download.id, IN_FLIGHT_BOOK_REQUEST_DOWNLOAD_STATUSES, {
      status: 'failed',
      errorMessage: reason,
    });
    return failed !== undefined;
  }
}
