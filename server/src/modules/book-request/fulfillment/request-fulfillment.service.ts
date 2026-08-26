import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BOOK_FORMATS,
  canonicalizeBookRequestIsbn,
  DELIVERY_BY_DOWNLOAD_SOURCE,
  DOWNLOAD_CLIENT_DELIVERY,
  DOWNLOAD_CLIENT_TYPES,
  GRABBABLE_BOOK_REQUEST_STATUSES,
  GRAB_FAILURE_CODES,
  isGrabbableBookRequestStatus,
  NotificationType,
  normalizeBookRequestIsbn,
  releaseInspectionBlocksGrab,
  toRequestLanguage,
  UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES,
  WORKER_WRITABLE_BOOK_REQUEST_STATUSES,
} from '@bookorbit/types';
import type {
  BookRequestDownloadItem,
  BookRequestDownloadSource,
  BookRequestFailureMeta,
  BookRequestHandbackCode,
  BookRequestItem,
  BookRequestStatus,
  GrabFailureCode,
  IndexerSearchFailure,
  ReleaseFileInspection,
  ReleaseFileInspectionStatus,
  ReleaseManifestFile,
  ReleaseSearchOverrides,
  ReleaseSearchResult,
  ReleaseUnitChoice,
  ReleaseUnitSummary,
} from '@bookorbit/types';

import { isUniqueViolation } from '../../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../../common/types/request-user';
import type { BookRequestDownloadRow, BookRequestRow } from '../../../db/schema';
import { BOOK_REQUEST_DOWNLOAD_FAILED, BookRequestEventsService } from '../book-request-events.service';
import { BookRequestGateway } from '../book-request.gateway';
import { BookRequestNotifier } from '../book-request-notifier.service';
import { mapBookRequestDownload, mapBookRequestRow } from '../book-request.mapper';
import { BookRequestRepository } from '../book-request.repository';
import { DownloadClientConfigService } from '../download-clients/download-client-config.service';
import { DownloadClientRegistry } from '../download-clients/download-client-registry';
import { ADD_PATH_MAPPING_HINT } from '../download-clients/path-mapping.service';
import {
  IndexerSearchException,
  type IndexerAdapter,
  type ReleaseCandidate,
  type ReleaseFile,
  type ResolvedIndexerConfig,
} from '../indexers/indexer-adapter';
import { IndexerConfigService } from '../indexers/indexer-config.service';
import { IndexerRegistry } from '../indexers/indexer-registry';
import { IndexerSearchService } from '../indexers/indexer-search.service';
import { interpretRelease, type ReleaseFileInput, type ReleasePlan } from '../../scanner/lib/release-plan';
import { resolveFormat } from '../indexers/release-scoring';
import { BookRequestDownloadRepository } from './book-request-download.repository';
import { DirectDownloadService, stagedDirectFileName } from './direct-download.service';
import { infoHashFromMagnet, magnetDisplayName, MAX_TORRENT_FILE_BYTES, torrentMetadataFromFile, type TorrentFileMetadata } from './torrent.utils';
import type { InspectBookRequestReleaseDto } from '../dto/inspect-book-request-release.dto';
import type { GrabBookRequestDto } from '../dto/grab-book-request.dto';
import type { SearchBookRequestReleasesDto } from '../dto/search-book-request-releases.dto';

/** One metadata lookup against the source, spent only on the release an approver actually picked. */
const RESOLVE_FILE_TIMEOUT_MS = 20_000;
const RESOLVED_RELEASE_TTL_MS = 60_000;
const MAX_RESOLVED_RELEASES = 25;
const MAX_DISPLAYED_MANIFEST_FILES = 200;
/** A chooser is a list a human reads, and a release with more books than this is not one. */
const MAX_DISPLAYED_UNITS = 25;
const SUPPORTED_BOOK_FORMATS = new Set<string>(BOOK_FORMATS);

/** Searching costs a hit on every configured tracker, so a refused request does not get one. */
const UNSEARCHABLE: BookRequestStatus[] = ['rejected', 'cancelled'];

/** Tracker conditions that pass on their own, so the same release is worth another attempt later. */
const RETRYABLE_INDEXER_FAILURES: IndexerSearchFailure[] = ['timeout', 'unreachable', 'throttled'];

function normalizeReleaseSearchOverrides(dto: SearchBookRequestReleasesDto): ReleaseSearchOverrides {
  const overrides: ReleaseSearchOverrides = {};

  if (dto.title !== undefined) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('A search title cannot be blank');
    overrides.title = title;
  }

  if (dto.authors !== undefined) {
    overrides.authors = [...new Set(dto.authors.map((author) => author.trim()).filter(Boolean))];
  }

  if (dto.isbn !== undefined) {
    if (dto.isbn === null) {
      overrides.isbn = null;
    } else {
      const normalized = normalizeBookRequestIsbn(dto.isbn);
      const canonical = normalized?.length === 10 ? canonicalizeBookRequestIsbn(normalized, null) : canonicalizeBookRequestIsbn(null, normalized);
      if (!canonical) throw new BadRequestException(`"${dto.isbn}" is not a valid ISBN-10 or ISBN-13`);
      overrides.isbn = canonical;
    }
  }

  if (dto.language !== undefined) {
    const language = dto.language?.trim() || null;
    overrides.language = language === null ? null : toRequestLanguage(language);
  }

  if (dto.preferredFormats !== undefined) {
    overrides.preferredFormats = [...new Set(dto.preferredFormats.map((format) => format.trim().toLowerCase()).filter(Boolean))];
  }

  return overrides;
}

@Injectable()
export class RequestFulfillmentService {
  private readonly logger = new Logger(RequestFulfillmentService.name);
  private readonly resolvedReleases = new Map<string, CachedResolvedRelease>();

  constructor(
    private readonly requests: BookRequestRepository,
    private readonly downloads: BookRequestDownloadRepository,
    private readonly clients: DownloadClientConfigService,
    private readonly registry: DownloadClientRegistry,
    private readonly direct: DirectDownloadService,
    private readonly indexers: IndexerConfigService,
    private readonly indexerRegistry: IndexerRegistry,
    private readonly releases: IndexerSearchService,
    private readonly notifier: BookRequestNotifier,
    private readonly gateway: BookRequestGateway,
    private readonly events: BookRequestEventsService,
  ) {}

  /**
   * The ranked, cross-indexer release list for one request. Read-only, cached briefly, and the
   * only place a release is turned into something a grab can name.
   */
  async listReleases(requestId: number, options: { refresh?: boolean; overrides?: SearchBookRequestReleasesDto } = {}): Promise<ReleaseSearchResult> {
    const joined = await this.requests.findById(requestId);
    if (!joined) throw new NotFoundException('Book request not found');
    if (UNSEARCHABLE.includes(joined.request.status as BookRequestStatus)) {
      throw new BadRequestException(`A request that is ${joined.request.status} is not searched for releases`);
    }

    return this.releases.search(joined.request, {
      refresh: options.refresh,
      overrides: options.overrides ? normalizeReleaseSearchOverrides(options.overrides) : undefined,
    });
  }

  /**
   * Every attempt this request has made, newest first, including the ones a source refused before
   * anything was downloaded. A request that ended up downloading from the second source looks
   * unremarkable from its own row; the first source having been asked and having said no is only
   * visible here.
   */
  async listAttempts(requestId: number): Promise<BookRequestDownloadItem[]> {
    if (!(await this.requests.findById(requestId))) throw new NotFoundException('Book request not found');
    return (await this.downloads.findForRequest(requestId)).map(mapBookRequestDownload);
  }

  async inspectRelease(requestId: number, dto: InspectBookRequestReleaseDto): Promise<ReleaseFileInspection> {
    const joined = await this.requests.findById(requestId);
    if (!joined) throw new NotFoundException('Book request not found');
    if (UNSEARCHABLE.includes(joined.request.status as BookRequestStatus)) {
      throw new BadRequestException(`A request that is ${joined.request.status} cannot inspect releases`);
    }

    return (await this.resolvePickedRelease(requestId, dto.indexerId, dto.releaseGuid.trim())).inspection;
  }

  /**
   * Hands a picked release, a magnet or a .torrent to the download client and starts watching it.
   * The row is written before the client is called: an add that succeeds against a row we failed
   * to persist would leave a torrent nobody owns.
   *
   * A null `user` is the automation grabbing unattended, which is recorded on the attempt: it is
   * what makes that attempt eligible to be retried with the next-best release.
   */
  async grab(requestId: number, dto: GrabBookRequestDto, user: RequestUser | null): Promise<BookRequestItem> {
    const joined = await this.requests.findById(requestId);
    if (!joined) throw new NotFoundException('Book request not found');
    const request = joined.request;

    if (!isGrabbableBookRequestStatus(request.status as BookRequestStatus)) {
      throw new BadRequestException(`A request that is ${request.status} cannot be sent to a download client`);
    }
    // Finalize resolves a destination from the row, and a request with no library would stop at
    // "missing_destination" after the whole download had already run.
    if (request.targetLibraryId === null) {
      throw new BadRequestException('Set a destination library on this request before grabbing a release');
    }

    // Claimed before anything external happens, and conditionally, so two callers cannot both read
    // a grabbable status and go on to start two different releases for one request. The duplicate
    // index catches the same release twice; nothing else catches two different ones.
    const previousStatus = request.status as BookRequestStatus;
    const claim = await this.requests.claimForGrab(requestId, GRABBABLE_BOOK_REQUEST_STATUSES);
    if (claim !== 'claimed') {
      throw new RequestAlreadyClaimedException(
        claim === 'duplicate'
          ? 'Somebody has already requested this book again, and that request now holds the claim on it. Work from that one instead.'
          : 'Another release is already being sent for this request',
      );
    }

    try {
      return await this.startGrab(requestId, dto, user);
    } catch (error) {
      // The claim is only good while this attempt is live. Anything that stops it hands the request
      // back in the state it was found in, so the picker still offers another release - but only if
      // the claim is still ours, because a cancellation that landed mid-grab is not something to
      // roll back over.
      await this.requests.updateIf(requestId, ['grabbed'], { status: previousStatus });
      throw error;
    }
  }

  private async startGrab(requestId: number, dto: GrabBookRequestDto, user: RequestUser | null): Promise<BookRequestItem> {
    // Asking the source is the part worth recording when it refuses, because a refusal nobody
    // recorded is exactly the one that gets asked about later: "it downloaded from the second
    // source, but was the first one even tried?"
    let grab: ResolvedGrab;
    try {
      grab = await this.resolveGrab(requestId, dto);
      assertReleaseCanImport(grab.inspection);
    } catch (error) {
      await this.recordRefusedAttempt(requestId, dto, user, error);
      throw error;
    }

    // Deliberately outside it: this refuses on the routing alone, before anything is asked of a
    // client, and an attempt nothing was ever asked to take is not an attempt.
    const client = await this.resolveClient(dto.downloadClientId ?? null, grab.source);

    let download: BookRequestDownloadRow;
    try {
      download = await this.downloads.create({
        requestId,
        downloadClientId: client?.id ?? null,
        indexerId: grab.indexerId ?? null,
        source: grab.source,
        automated: user === null,
        releaseTitle: grab.releaseTitle,
        releaseGuid: grab.releaseGuid ?? null,
        releaseSizeBytes: grab.releaseSizeBytes,
        releaseSeeders: grab.releaseSeeders ?? null,
        releaseFormat: grab.releaseFormat ?? null,
        freeleech: grab.freeleech ?? false,
        clientHash: grab.infoHash,
        status: 'queued',
        grabbedAt: new Date(),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw grabConflict('GRAB_RELEASE_REFUSED', 'That release is already downloading, or waiting for a review, on another request');
      }
      throw error;
    }

    try {
      if (client === null) {
        await this.direct.add({ fileUrl: requireFileUrl(grab), fileName: grab.fileName, format: grab.releaseFormat, infoHash: grab.infoHash });
      } else {
        const config = await this.clients.resolveConfig(client.id);
        const adapter = this.registry.require(config.adapterType);
        await adapter.add(
          {
            magnet: grab.magnet,
            torrentFile: grab.torrentFile,
            torrentFileName: grab.torrentFileName ?? dto.torrentFileName,
            infoHash: grab.infoHash,
            // The indexer's goals, enforced by the client: BookOrbit never stops a seed itself.
            ...(grab.seedRatioGoal !== null && grab.seedRatioGoal !== undefined ? { seedRatioGoal: grab.seedRatioGoal } : {}),
            ...(grab.seedTimeMinutes !== null && grab.seedTimeMinutes !== undefined ? { seedTimeMinutes: grab.seedTimeMinutes } : {}),
          },
          config,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.downloads.update(download.id, { status: 'failed', errorMessage: message });
      this.logger.warn(
        `[book_request.grab] [fail] requestId=${requestId} downloadId=${download.id} clientId=${client?.id ?? 'direct'} error="${sanitizeLogValue(message)}" - the download could not be started`,
      );
      // Which half refused decides what another attempt should do: a client that is down refuses
      // every torrent alike, while a file BookOrbit fetches itself was refused by the source.
      throw withGrabCode(error, client === null ? 'GRAB_SOURCE_REFUSED' : 'GRAB_CLIENT_REFUSED');
    }

    // Still conditional on the claim this grab took, so a cancellation that landed while the client
    // was being asked is not overwritten by the answer.
    await this.requests.updateIf(requestId, ['grabbed'], { status: 'grabbed', statusReason: null });
    // A retry is the one way out of a settled status, and someone who hid the failure still wants
    // the book when it lands. Leaving the dismissal on would hide the arrival too.
    await this.requests.clearDismissals(requestId);
    this.logger.log(
      `[book_request.grab] [end] requestId=${requestId} downloadId=${download.id} clientId=${client?.id ?? 'direct'} indexerId=${grab.indexerId ?? 'none'} indexer="${sanitizeLogValue(grab.indexerName ?? 'pasted by hand')}" userId=${user?.id ?? 'automation'} source=${grab.source} hash=${grab.infoHash} - release grab started`,
    );
    this.gateway.emitChanged();

    return this.toItem(requestId, user?.id ?? null);
  }

  /**
   * Keeps a source's refusal as an attempt in its own right, since nothing else records it: the
   * request moves on to the next release and its own row ends up describing whichever one worked.
   *
   * Only for a release picked out of the list, and only for a refusal that was classified: a
   * hand-pasted magnet has no source to attribute, and an unclassified error is a fault on our
   * side rather than an answer about the release. A failure to write the record must never be
   * what stops the refusal itself being reported, so it is logged and swallowed.
   */
  private async recordRefusedAttempt(requestId: number, dto: GrabBookRequestDto, user: RequestUser | null, error: unknown): Promise<void> {
    const code = grabFailureCode(error);
    const releaseGuid = dto.releaseGuid?.trim();
    if (code === null || !releaseGuid || !dto.indexerId) return;

    const release = this.releases.find(requestId, dto.indexerId, releaseGuid);
    if (!release) return;

    try {
      await this.downloads.create({
        requestId,
        downloadClientId: null,
        indexerId: dto.indexerId,
        source: await this.attemptedSource(release),
        automated: user === null,
        releaseTitle: release.title.slice(0, 500),
        releaseGuid: releaseGuid.slice(0, 500),
        releaseSizeBytes: release.sizeBytes,
        releaseSeeders: release.seeders,
        releaseFormat: resolveFormat(release)?.slice(0, 20) ?? null,
        freeleech: release.freeleech ?? false,
        clientHash: null,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        grabbedAt: new Date(),
      });
    } catch (writeError: unknown) {
      const message = writeError instanceof Error ? writeError.message : String(writeError);
      this.logger.warn(
        `[book_request.grab] [fail] requestId=${requestId} indexerId=${dto.indexerId} error="${sanitizeLogValue(message)}" - could not record the refused attempt`,
      );
    }
  }

  /**
   * What the attempt would have become, read off the adapter the same way `resolveRelease` reads
   * it. Recorded rather than left blank because "a torrent we never got" and "a file the source
   * would not serve" are different stories about the same refusal.
   */
  private async attemptedSource(release: ReleaseCandidate): Promise<BookRequestDownloadSource> {
    if (release.magnet) return 'magnet';
    try {
      const indexer = await this.indexers.resolveConfig(release.indexerId);
      return this.indexerRegistry.require(indexer.adapterType).resolveFile ? 'direct_url' : 'torrent_file';
    } catch {
      return 'torrent_file';
    }
  }

  /**
   * The classified fields move with the prose rather than separately: a reason cleared without its
   * code would leave a stale code translating a failure that is no longer there.
   *
   * `from` is what the caller believes the request is in and is worth narrowing. The default set
   * includes `grabbed` and `downloading`, so a background pass writing a terminal status against
   * it will happily stamp `failed` over a healthy download somebody started by hand in the
   * meantime - and the UI then invites a retry that would grab the same book twice.
   */
  async setRequestStatus(
    requestId: number,
    status: BookRequestStatus,
    statusReason?: string | null,
    failure?: { code: BookRequestHandbackCode; meta?: BookRequestFailureMeta } | null,
    from: readonly BookRequestStatus[] = WORKER_WRITABLE_BOOK_REQUEST_STATUSES,
  ): Promise<boolean> {
    const updated = await this.requests.updateIf(requestId, from, {
      status,
      ...(statusReason !== undefined ? { statusReason, failureCode: failure?.code ?? null, failureMeta: failure?.meta ?? null } : {}),
    });
    if (!updated) return false;
    this.gateway.emitChanged();
    return true;
  }

  /**
   * The single way an attempt ends badly, so every caller produces the same request state, the
   * same audit trail and the same approver notification.
   */
  async failDownload(download: BookRequestDownloadRow, reason: string): Promise<void> {
    // Both writes are conditional, and both callers are sweeps over rows read some time ago: the
    // poll loop and the watchdog. An attempt somebody already settled keeps the reason it settled
    // for, and a request somebody already cancelled, rejected or filed stays that way rather than
    // being reopened as a failure - which would also announce a failure nobody is waiting on.
    if (!(await this.downloads.updateIf(download.id, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES, { status: 'failed', errorMessage: reason }))) {
      return;
    }
    if (!(await this.requests.updateIf(download.requestId, WORKER_WRITABLE_BOOK_REQUEST_STATUSES, { status: 'failed', statusReason: reason }))) {
      this.logger.log(
        `[book_request.download] [end] requestId=${download.requestId} downloadId=${download.id} - the attempt failed after the request was settled, so the request was left alone`,
      );
      this.gateway.emitChanged();
      return;
    }

    const joined = await this.requests.findById(download.requestId);
    const title = joined?.request.title ?? `request #${download.requestId}`;

    this.logger.warn(
      `[book_request.download] [fail] requestId=${download.requestId} downloadId=${download.id} error="${sanitizeLogValue(reason)}" - download attempt failed`,
    );

    await this.notifier.notifyResponsible(
      { id: download.requestId, selfServe: joined?.request.selfServe ?? false },
      NotificationType.BookRequestFailed,
      {
        title: 'Book request download failed',
        message: `"${title}": ${reason}`,
        actionUrl: '/requests',
        meta: { requestId: download.requestId, downloadId: download.id },
      },
    );
    this.gateway.emitChanged();
    // Last, so a retry policy listening here sees a request already marked failed and a
    // notification already sent, whatever it decides to do next.
    this.events.emit(BOOK_REQUEST_DOWNLOAD_FAILED, download.id);
  }

  /**
   * The attempt stays in the dock for a human instead of failing. The difference from
   * `failDownload` is what happens to the bytes: a failed attempt is over, while a held one is a
   * finished download waiting on a question, and throwing it away would mean downloading it twice.
   */
  async holdForReview(
    download: BookRequestDownloadRow,
    request: Pick<BookRequestRow, 'id' | 'title' | 'selfServe'>,
    reason: string,
    extra: { releaseUnits?: ReleaseUnitChoice[] } = {},
  ): Promise<void> {
    const message = `Held for review: ${reason}`;
    // Same conditional shape as `failDownload`: the download that reached this point started well
    // before it, and a request settled in the meantime must not be reopened to ask a question
    // nobody needs answered any more.
    const held = await this.downloads.updateIf(download.id, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES, {
      status: 'needs_review',
      errorMessage: message,
      releaseUnits: extra.releaseUnits ?? null,
    });
    if (!held) return;
    if (!(await this.requests.updateIf(request.id, WORKER_WRITABLE_BOOK_REQUEST_STATUSES, { status: 'needs_review', statusReason: message }))) {
      this.gateway.emitChanged();
      return;
    }

    await this.notifier.notifyResponsible(request, NotificationType.BookRequestNeedsReview, {
      title: 'Book request needs review',
      message: `"${request.title}": ${reason}`,
      actionUrl: '/requests',
      meta: { requestId: request.id, dockFileId: download.bookDockFileId },
    });
    this.gateway.emitChanged();
  }

  /** Reads back through the repository so the caller gets the row exactly as the lists serve it. */
  private async toItem(requestId: number, viewerId: number | null): Promise<BookRequestItem> {
    const joined = await this.requests.findById(requestId);
    if (!joined) throw new NotFoundException('Book request not found');
    const [subscribers, downloads, dismissed] = await Promise.all([
      this.requests.findSubscribers([requestId]),
      this.downloads.findLatestForRequests([requestId]),
      viewerId === null ? Promise.resolve(new Set<number>()) : this.requests.findDismissedRequestIds(viewerId, [requestId]),
    ]);
    return mapBookRequestRow(joined, subscribers.get(requestId) ?? [], downloads.get(requestId) ?? null, dismissed.has(requestId));
  }

  /**
   * Turns whichever of the three grab shapes the approver used into one payload. A picked release
   * is resolved from this server's own search results rather than from anything the client sent,
   * so the download URL, the tracker credential and the seed goals never round-trip through a
   * browser.
   */
  private async resolveGrab(requestId: number, dto: GrabBookRequestDto): Promise<ResolvedGrab> {
    const named = [Boolean(dto.releaseGuid?.trim() && dto.indexerId), Boolean(dto.magnet?.trim()), Boolean(dto.torrentFileBase64?.trim())];
    if (named.filter(Boolean).length !== 1) {
      throw new BadRequestException('Provide exactly one of a picked release, a magnet link or a .torrent file');
    }

    if (!named[0]) return parseGrabPayload(dto);

    return this.resolvePickedRelease(requestId, dto.indexerId!, dto.releaseGuid!.trim());
  }

  private async resolvePickedRelease(requestId: number, indexerId: number, releaseGuid: string): Promise<ResolvedGrab> {
    const release = this.releases.find(requestId, indexerId, releaseGuid);
    if (!release) {
      throw grabError('GRAB_RELEASE_REFUSED', 'That release is no longer in the search results. Search again and pick one.');
    }

    const key = `${requestId}:${indexerId}:${releaseGuid}`;
    const cached = this.resolvedReleases.get(key);
    if (cached && cached.candidate === release && cached.expiresAt > Date.now()) return cached.grab;

    const grab = await this.resolveRelease(requestId, release);
    this.rememberResolvedRelease(key, release, grab);
    return grab;
  }

  private async resolveRelease(requestId: number, release: ReleaseCandidate): Promise<ResolvedGrab> {
    const indexer = await this.indexers.resolveConfig(release.indexerId);
    try {
      return await this.resolveReleaseFor(indexer, release);
    } catch (error) {
      // The refusal travels to the caller as a 4xx, and the filter deliberately logs no client
      // error, so without this line a source that searches fine and only fails on download leaves
      // nothing behind but a route and a status. Searching already logs its own failures; this is
      // the other half, and it is the half that names which source refused.
      this.logger.warn(
        `[book_request.release_resolve] [fail] requestId=${requestId} indexerId=${indexer.id} indexerName="${sanitizeLogValue(indexer.name)}" errorCode=${errorCodeOf(error)} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - could not resolve the picked release`,
      );
      throw error;
    }
  }

  private async resolveReleaseFor(indexer: ResolvedIndexerConfig, release: ReleaseCandidate): Promise<ResolvedGrab> {
    const snapshot = {
      indexerId: release.indexerId,
      indexerName: indexer.name,
      releaseGuid: release.guid,
      releaseTitle: release.title.slice(0, 500),
      releaseSizeBytes: release.sizeBytes,
      releaseSeeders: release.seeders,
      // The resolved format, not the raw field: most indexers state none and it is read off the
      // release name, which is what the picker showed the approver.
      releaseFormat: resolveFormat(release)?.slice(0, 20) ?? null,
      freeleech: release.freeleech ?? false,
      // Both come from the tracker itself, via torznab's `minimumratio` and `minimumseedtime`.
      // There is no per-source override for either: the download client's own defaults are the
      // fallback where a feed states nothing.
      seedRatioGoal: release.seedRatioGoal ?? null,
      seedTimeMinutes: release.seedTimeMinutes ?? null,
    };

    if (release.magnet) {
      return {
        ...snapshot,
        source: 'magnet',
        magnet: release.magnet,
        infoHash: infoHashFromMagnet(release.magnet),
        inspection: metadataUnavailableInspection('magnet'),
      };
    }

    const adapter = this.indexerRegistry.require(indexer.adapterType);

    // A source that serves the file itself. Resolved here rather than at search time because it
    // costs a request per release, and only the one the approver picked is worth spending on.
    if (adapter.resolveFile) {
      const file = await resolveReleaseFile(adapter, release, indexer);
      // The name this will be staged under, resolved once and used for both answers. Inspection
      // has to speak about the name the importer will classify rather than the one the source
      // happened to state, or it can call a release ready that the importer finds no book in.
      const fileName = stagedDirectFileName(file.fileName, file.format);
      return {
        ...snapshot,
        source: 'direct_url',
        fileUrl: file.url,
        fileName,
        // A digest of the URL, because there is no infohash and the poll loop still needs a key.
        infoHash: createHash('sha1').update(file.url).digest('hex'),
        releaseFormat: file.format.slice(0, 20),
        // The one figure the search could not state: an item's size is not the book's size.
        releaseSizeBytes: file.sizeBytes ?? snapshot.releaseSizeBytes,
        // Nothing is seeded back, so a seed goal would only mislead the client.
        seedRatioGoal: null,
        seedTimeMinutes: null,
        inspection: directFileInspection(fileName, file.sizeBytes),
      };
    }

    // A private tracker's download link is credentialed, so the .torrent is fetched here with the
    // indexer's own session rather than handed to the download client as a URL it cannot open.
    if (!adapter.fetchTorrentFile) {
      throw grabError('GRAB_SOURCE_REFUSED', `${indexer.name} released no magnet link, and its adapter cannot fetch a .torrent file`);
    }

    const torrentFile = await fetchTorrentFile(adapter, release, indexer);
    const metadata = torrentMetadataFromFile(torrentFile);
    return {
      ...snapshot,
      source: 'torrent_file',
      torrentFile,
      // Named after the hash rather than the guid, which on torznab is a URL and would put path
      // separators into a multipart filename.
      torrentFileName: `${metadata.infoHash}.torrent`,
      infoHash: metadata.infoHash,
      releaseSizeBytes: snapshot.releaseSizeBytes ?? metadata.totalLength,
      inspection: torrentInspection(metadata),
    };
  }

  private rememberResolvedRelease(key: string, candidate: ReleaseCandidate, grab: ResolvedGrab): void {
    const now = Date.now();
    for (const [cachedKey, cached] of this.resolvedReleases) {
      if (cached.expiresAt <= now) this.resolvedReleases.delete(cachedKey);
    }
    if (this.resolvedReleases.size >= MAX_RESOLVED_RELEASES) {
      const oldest = this.resolvedReleases.keys().next().value as string | undefined;
      if (oldest) this.resolvedReleases.delete(oldest);
    }
    this.resolvedReleases.set(key, { candidate, grab, expiresAt: now + RESOLVED_RELEASE_TTL_MS });
  }

  /**
   * Which downloader takes this release, where null is BookOrbit fetching the file itself. A
   * direct file never has a client: there is nothing to configure and nothing to choose, so a
   * fresh install grabs one without a download client existing at all.
   *
   * For a torrent it is capability first, priority second. A torrent client cannot fetch a URL,
   * so taking the highest-priority enabled row regardless would hand a release to a client that
   * has to reject it.
   */
  private async resolveClient(requestedId: number | null, source: BookRequestDownloadSource) {
    if (requestedId === null) {
      if (DELIVERY_BY_DOWNLOAD_SOURCE[source] === 'file') return null;

      const types = DOWNLOAD_CLIENT_TYPES.filter((type) => DOWNLOAD_CLIENT_DELIVERY[type] === 'torrent');
      const preferred = await this.clients.findPreferredEnabled(types);
      if (!preferred) {
        throw grabError('GRAB_CLIENT_REFUSED', 'No torrent download client is configured. Add one under Settings > System > Requests.');
      }
      const preferredClient = await this.clients.findOne(preferred.id);
      this.assertClientCanImport(preferredClient);
      return preferredClient;
    }

    const client = await this.clients.findOne(requestedId);
    if (!client.enabled) throw grabError('GRAB_CLIENT_REFUSED', `Download client "${client.name}" is disabled`);
    this.assertClientCanDeliver(client, source);
    this.assertClientCanImport(client);
    return client;
  }

  /**
   * A client with no path mapping declares no directory the import is allowed to read out of, so
   * the attempt would seed for hours and then be refused the moment it finished. Rows that predate
   * mappings being mandatory are what reaches this; refusing now says so while somebody is looking.
   */
  private assertClientCanImport(client: { name: string; pathMappings: readonly unknown[] }): void {
    if (client.pathMappings.length > 0) return;
    throw grabError(
      'GRAB_CLIENT_REFUSED',
      `Download client "${client.name}" has no path mapping, so nothing it downloads could be imported. ${ADD_PATH_MAPPING_HINT}`,
    );
  }

  private assertClientCanDeliver(client: { name: string; adapterType: keyof typeof DOWNLOAD_CLIENT_DELIVERY }, source: BookRequestDownloadSource) {
    const expected = DELIVERY_BY_DOWNLOAD_SOURCE[source];
    if (DOWNLOAD_CLIENT_DELIVERY[client.adapterType] === expected) return;

    throw grabError(
      'GRAB_CLIENT_REFUSED',
      expected === 'file'
        ? `Download client "${client.name}" cannot fetch a direct file`
        : `Download client "${client.name}" cannot accept a magnet link or .torrent file`,
    );
  }
}

/**
 * A tracker refusing one release ("VIP torrent and you are not VIP or higher") is an answer, and
 * the reason is the tracker's own sentence. Letting the adapter's error through unmapped reports
 * it as a 500 with a stack trace, which loses the sentence and reads as a fault on our side.
 */
async function fetchTorrentFile(adapter: IndexerAdapter, release: ReleaseCandidate, indexer: ResolvedIndexerConfig): Promise<Buffer> {
  try {
    return await adapter.fetchTorrentFile!(release, indexer);
  } catch (error) {
    if (!(error instanceof IndexerSearchException)) throw error;
    throw indexerRefusal(error, release);
  }
}

/** The same mapping for a source that serves the file itself, which refuses in the same ways. */
async function resolveReleaseFile(adapter: IndexerAdapter, release: ReleaseCandidate, indexer: ResolvedIndexerConfig): Promise<ReleaseFile> {
  try {
    return await adapter.resolveFile!(release, indexer, AbortSignal.timeout(RESOLVE_FILE_TIMEOUT_MS));
  } catch (error) {
    if (!(error instanceof IndexerSearchException)) throw error;
    throw indexerRefusal(error, release);
  }
}

/**
 * How far a source's refusal reaches. A tracker that will not serve a VIP-only release to a
 * non-VIP account still serves its ordinary ones, so that refusal is marked as being about the
 * VIP releases rather than about the tracker: skipping the whole source would throw away every
 * release it holds over a restriction that applies to a handful of them.
 */
function indexerRefusal(error: IndexerSearchException, release: ReleaseCandidate): HttpException {
  if (RETRYABLE_INDEXER_FAILURES.includes(error.failure)) {
    return grabUnavailable('GRAB_SOURCE_UNAVAILABLE', error.message);
  }
  return grabError(release.vipOnly === true ? 'GRAB_VIP_REQUIRED' : 'GRAB_SOURCE_REFUSED', error.message);
}

/**
 * A refusal an automatic attempt can route around. The code travels to the picker as `errorCode`
 * and to the failover as a scope, while the message stays the source's own sentence.
 */
/** The stable code off an HttpException body, so the log line says which refusal this was. */
function errorCodeOf(error: unknown): string {
  const response = error instanceof HttpException ? error.getResponse() : null;
  const code = typeof response === 'object' && response !== null ? (response as { errorCode?: unknown }).errorCode : null;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

function grabError(errorCode: GrabFailureCode, message: string): BadRequestException {
  return new BadRequestException({ message, errorCode, statusCode: HttpStatus.BAD_REQUEST });
}

function grabUnavailable(errorCode: GrabFailureCode, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ message, errorCode, statusCode: HttpStatus.SERVICE_UNAVAILABLE });
}

function grabConflict(errorCode: GrabFailureCode, message: string): ConflictException {
  return new ConflictException({ message, errorCode, statusCode: HttpStatus.CONFLICT });
}

/**
 * The refusal that means somebody else is driving this request: the grab claim was taken between
 * reading a grabbable status and holding it.
 *
 * Its own class so the automation failover can stop on it rather than work down the rest of its
 * ranked list, every entry of which would be refused for the same reason. The body is an ordinary
 * `GRAB_RELEASE_REFUSED` conflict, so nothing over HTTP sees a new shape.
 */
export class RequestAlreadyClaimedException extends ConflictException {
  constructor(message: string) {
    super({ message, errorCode: 'GRAB_RELEASE_REFUSED' satisfies GrabFailureCode, statusCode: HttpStatus.CONFLICT });
  }
}

/**
 * Adds the code to a refusal another layer already shaped, keeping its status and its sentence.
 * Anything that is not an HTTP failure is handed back untouched: an unexpected error is a fault
 * on our side, and dressing it as a refusal would let the failover route around a real bug.
 */
function withGrabCode(error: unknown, errorCode: GrabFailureCode): unknown {
  if (!(error instanceof HttpException)) return error;

  const status = error.getStatus();
  if (status === (HttpStatus.SERVICE_UNAVAILABLE as number)) return grabUnavailable(errorCode, error.message);
  if (status === (HttpStatus.CONFLICT as number)) return grabConflict(errorCode, error.message);
  if (status === (HttpStatus.BAD_REQUEST as number)) return grabError(errorCode, error.message);
  return new HttpException({ message: error.message, errorCode, statusCode: status }, status);
}

/** The code an attempt failed with, where it carried one. Null is "we do not know", never a guess. */
export function grabFailureCode(error: unknown): GrabFailureCode | null {
  if (!(error instanceof HttpException)) return null;
  const body = error.getResponse();
  const code = typeof body === 'object' && body !== null ? (body as { errorCode?: unknown }).errorCode : undefined;
  return typeof code === 'string' && (GRAB_FAILURE_CODES as readonly string[]).includes(code) ? (code as GrabFailureCode) : null;
}

interface ParsedGrab {
  source: BookRequestDownloadSource;
  infoHash: string;
  magnet?: string;
  torrentFile?: Buffer;
  torrentFileName?: string;
  fileUrl?: string;
  fileName?: string;
  releaseTitle: string;
  /** The size of what the release carries, which a magnet does not state. */
  releaseSizeBytes: number | null;
  inspection: ReleaseFileInspection;
}

/** A parsed grab plus what an indexer knows about it, which a hand-pasted link cannot supply. */
interface ResolvedGrab extends ParsedGrab {
  indexerId?: number;
  indexerName?: string;
  releaseGuid?: string;
  releaseSeeders?: number | null;
  releaseFormat?: string | null;
  freeleech?: boolean;
  seedRatioGoal?: number | null;
  seedTimeMinutes?: number | null;
}

interface CachedResolvedRelease {
  candidate: ReleaseCandidate;
  grab: ResolvedGrab;
  expiresAt: number;
}

function parseGrabPayload(dto: GrabBookRequestDto): ParsedGrab {
  if (dto.magnet?.trim()) {
    const magnet = dto.magnet!.trim();
    const infoHash = infoHashFromMagnet(magnet);
    return {
      source: 'magnet',
      infoHash,
      magnet,
      releaseTitle: magnetDisplayName(magnet, infoHash).slice(0, 500),
      releaseSizeBytes: null,
      inspection: metadataUnavailableInspection('magnet'),
    };
  }

  const torrentFile = Buffer.from(dto.torrentFileBase64!, 'base64');
  if (torrentFile.byteLength === 0) throw new BadRequestException('That .torrent file is empty');
  if (torrentFile.byteLength > MAX_TORRENT_FILE_BYTES) throw new BadRequestException('That .torrent file is too large');

  const metadata = torrentMetadataFromFile(torrentFile);
  const releaseTitle = (metadata.name ?? dto.torrentFileName ?? metadata.infoHash).slice(0, 500);
  return {
    source: 'torrent_file',
    infoHash: metadata.infoHash,
    torrentFile,
    releaseTitle,
    releaseSizeBytes: metadata.totalLength,
    inspection: torrentInspection(metadata),
  };
}

function torrentInspection(metadata: TorrentFileMetadata): ReleaseFileInspection {
  const allFiles: ReleaseManifestFile[] = metadata.files.map((file) => ({
    path: file.path,
    sizeBytes: file.length,
    bookFile: isSupportedBookFile(file.path),
  }));
  const primaryFiles = allFiles.filter((file) => file.bookFile);
  const displayedPrimaryFiles = primaryFiles.slice(0, MAX_DISPLAYED_MANIFEST_FILES);
  const displayed = [
    ...displayedPrimaryFiles,
    ...allFiles.filter((file) => !file.bookFile).slice(0, MAX_DISPLAYED_MANIFEST_FILES - displayedPrimaryFiles.length),
  ];

  const plan = interpretRelease(releaseInputsFromManifest(metadata), { rootName: metadata.name });

  return {
    source: 'torrent_file',
    status: inspectionStatus(plan),
    files: displayed,
    totalFiles: allFiles.length,
    primaryFileCount: primaryFiles.length,
    truncated: displayed.length < allFiles.length,
    ...unitFields(plan),
  };
}

/**
 * A .torrent prefixes every entry with the torrent's own name, which is a delivery detail rather
 * than part of the layout. Stripping it here is what makes the manifest and the finished directory
 * the same shape, so the interpreter cannot answer differently before and after the download.
 */
function releaseInputsFromManifest(metadata: TorrentFileMetadata): ReleaseFileInput[] {
  const root = metadata.name;
  const prefix = root ? `${root}/` : null;
  const stripRoot = prefix !== null && metadata.files.every((file) => file.path.startsWith(prefix));

  return metadata.files.map((file) => ({
    path: stripRoot ? file.path.slice(prefix!.length) : file.path,
    sizeBytes: file.length,
  }));
}

/**
 * What one directly served file is, read from the name it will be staged under.
 *
 * The declared format is spent before this point, on `stagedDirectFileName`: a source states its
 * format out of band and is the more reliable of the two, so the name is corrected to agree with
 * it rather than the answer being corrected to ignore the name. Trusting the format here as well
 * is what let a nameless file be reported ready and then fail at import, since import has only
 * the extension to classify by.
 */
function directFileInspection(fileName: string, sizeBytes: number | null | undefined): ReleaseFileInspection {
  const plan = interpretRelease([{ path: fileName, sizeBytes: sizeBytes ?? null }]);
  const bookFile = plan.units.length === 1;

  return {
    source: 'direct_url',
    status: inspectionStatus(plan),
    files: [{ path: fileName, sizeBytes: sizeBytes ?? null, bookFile }],
    totalFiles: 1,
    primaryFileCount: bookFile ? 1 : 0,
    truncated: false,
    ...unitFields(plan),
  };
}

function metadataUnavailableInspection(source: 'magnet'): ReleaseFileInspection {
  return {
    source,
    status: 'metadata_unavailable',
    files: [],
    totalFiles: null,
    primaryFileCount: null,
    truncated: false,
    units: [],
    unitCount: 0,
    ignoredFileCount: 0,
    containerCount: 0,
  };
}

/**
 * What the release becomes, in the terms the picker shows. One unit is importable however many
 * files it is made of; several units are importable too, but only after someone says which book
 * they wanted, so the picker names the count rather than promising a clean import.
 */
function inspectionStatus(plan: ReleasePlan): ReleaseFileInspectionStatus {
  if (plan.units.length === 0) return plan.containers.length > 0 ? 'contents_unknown' : 'no_supported_file';
  return plan.units.length === 1 ? 'ready' : 'multiple_supported_files';
}

function unitFields(plan: ReleasePlan): Pick<ReleaseFileInspection, 'units' | 'unitCount' | 'ignoredFileCount' | 'containerCount'> {
  return {
    units: plan.units.slice(0, MAX_DISPLAYED_UNITS).map(toUnitSummary),
    unitCount: plan.units.length,
    ignoredFileCount: plan.ignored.length,
    containerCount: plan.containers.length,
  };
}

function toUnitSummary(unit: ReleasePlan['units'][number]): ReleaseUnitSummary {
  return {
    mediaKind: unit.mediaKind,
    title: unit.title,
    contentFileCount: unit.contentFileCount,
    totalFileCount: unit.files.length,
    sizeBytes: unit.sizeBytes,
  };
}

function isSupportedBookFile(fileName: string): boolean {
  return SUPPORTED_BOOK_FORMATS.has(extname(fileName).toLowerCase().slice(1));
}

/**
 * The grab is refused only for a release the importer could never finish. Everything else is sent:
 * a release holding several books is resolved by an approver once it has landed, which is far
 * better than refusing on a guess and downloading it again later.
 */
function assertReleaseCanImport(inspection: ReleaseFileInspection): void {
  if (!releaseInspectionBlocksGrab(inspection.status)) return;
  throw grabError('GRAB_RELEASE_REFUSED', 'The release contains no directly supported book file');
}

/**
 * A `direct_url` grab is resolved from a URL, so this only fires if a source reported that shape
 * without one. Better a stated refusal on the attempt than a fetch of `undefined`.
 */
function requireFileUrl(grab: { fileUrl?: string }): string {
  if (!grab.fileUrl) throw grabError('GRAB_RELEASE_REFUSED', 'That release did not resolve to a file to download');
  return grab.fileUrl;
}
