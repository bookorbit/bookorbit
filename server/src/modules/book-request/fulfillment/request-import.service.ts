import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, AuditResource, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES, WORKER_WRITABLE_BOOK_REQUEST_STATUSES } from '@bookorbit/types';
import type { ReleaseUnitChoice } from '@bookorbit/types';
import { randomUUID } from 'crypto';
import { constants } from 'fs';
import { copyFile, link, mkdir, readdir, realpath, rmdir, stat, unlink } from 'fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'path';

import { isUniqueViolation } from '../../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { BookRequestDownloadRow, BookRequestRow } from '../../../db/schema';
import type { FileRole } from '../../scanner/lib/classify';
import { AuditService } from '../../audit/audit.service';
import { BookDockRepository } from '../../book-dock/book-dock.repository';
import { BookDockIngestService } from '../../book-dock/book-dock-ingest.service';
import {
  createArchiveBudget,
  extractReleaseArchive,
  extractionDirectoryFor,
  ReleaseArchiveError,
  removeExtractionDirectory,
  type ArchiveBudget,
} from '../../../common/archive/release-archive';
import {
  interpretRelease,
  selectReleaseUnit,
  unitRelativePath,
  type ReleaseFileInput,
  type ReleasePlan,
  type ReleaseUnit,
} from '../../scanner/lib/release-plan';
import { UploadValidatorService } from '../../upload/upload-validator.service';
import { BookRequestRepository } from '../book-request.repository';
import { BookRequestGateway } from '../book-request.gateway';
import { DownloadClientConfigService } from '../download-clients/download-client-config.service';
import { PathMappingService, type ResolvedDownloadPath } from '../download-clients/path-mapping.service';
import { directDownloadRoot } from './direct-download.service';
import { BookRequestDownloadRepository } from './book-request-download.repository';
import { DownloadRemovalService } from './download-removal.service';
import { RequestFulfillmentService } from './request-fulfillment.service';

/** A release folder is books plus artwork, not a filesystem. Depth and count stay bounded. */
const MAX_SCAN_DEPTH = 4;
const MAX_SCAN_ENTRIES = 2_000;
/** Enough attempts to get past a same-named retry without turning a collision into a loop. */
const MAX_UNIQUE_SUFFIX_ATTEMPTS = 100;
/**
 * Scene ebook packaging is a zip holding a rar holding the book, so one pass never reaches it.
 * Two does. Anything deeper is not packaging, it is a nested-archive bomb.
 */
const MAX_ARCHIVE_NESTING = 2;

/** What a bounded walk found, and whether the bounds stopped it before it was done. */
interface ReleaseWalk {
  files: ReleaseFileInput[];
  truncated: boolean;
}

interface PlacedFile {
  sourcePath: string;
  destPath: string;
  sizeBytes: number;
  format: string | null;
  role: FileRole;
  sortOrder: number | null;
}

/** Null `unitDirectory` is the loose single file the dock has always handled. */
interface UnitPlacement {
  unitDirectory: string | null;
  primaryDestPath: string;
  files: PlacedFile[];
}

@Injectable()
export class RequestImportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RequestImportService.name);
  private bookDockPath: string;
  /** Beside the dock rather than under it, so an extraction in flight is never a dock entry. */
  private readonly stagingPath: string;

  constructor(
    private readonly config: ConfigService,
    private readonly downloads: BookRequestDownloadRepository,
    private readonly requests: BookRequestRepository,
    private readonly gateway: BookRequestGateway,
    private readonly clients: DownloadClientConfigService,
    private readonly pathMappings: PathMappingService,
    private readonly dockRepo: BookDockRepository,
    private readonly dockIngest: BookDockIngestService,
    private readonly validator: UploadValidatorService,
    private readonly fulfillment: RequestFulfillmentService,
    private readonly removal: DownloadRemovalService,
    private readonly audit: AuditService,
  ) {
    this.bookDockPath = this.config.getOrThrow<string>('storage.bookDockPath');
    this.stagingPath = join(this.config.getOrThrow<string>('storage.appDataPath'), 'tmp', 'release-extract');
  }

  async onApplicationBootstrap(): Promise<void> {
    await mkdir(this.bookDockPath, { recursive: true });
    await mkdir(this.stagingPath, { recursive: true });
    // The watcher compares events against the realpath of the dock, so the destination has to be
    // resolved the same way or a symlinked dock would produce two different spellings of one file.
    this.bookDockPath = await realpath(this.bookDockPath);
  }

  /**
   * Links a finished download into the Book Dock and hands the rest to the existing dock
   * pipeline. Returns false when the attempt was failed; the caller does not need to do anything
   * further, because `failDownload` has already recorded and announced it.
   */
  async importDownload(download: BookRequestDownloadRow): Promise<boolean> {
    const joined = await this.requests.findById(download.requestId);
    if (!joined) {
      await this.fulfillment.failDownload(download, 'The request this download belongs to no longer exists');
      return false;
    }

    try {
      await this.runImport(download, joined.request);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.fulfillment.failDownload(download, message);
      return false;
    }
  }

  /**
   * Imports the book an approver picked out of a release that held several. The download is still
   * on disk and still where it was, so this is the same import as before with the ambiguity
   * resolved rather than a fresh attempt.
   */
  async importChosenUnit(requestId: number, downloadId: number, unitIndex: number): Promise<void> {
    const joined = await this.requests.findById(requestId);
    if (!joined) throw new NotFoundException('Book request not found');

    const found = await this.downloads.findById(downloadId);
    if (!found || found.requestId !== requestId) throw new NotFoundException('That download attempt does not belong to this request');
    if (found.status !== 'needs_review' || !found.releaseUnits?.length) {
      throw new BadRequestException('This download is not waiting for a book to be chosen');
    }

    const choice = found.releaseUnits[unitIndex];
    if (!choice) throw new BadRequestException('That is not one of the books this release contains');

    // Claimed rather than merely checked. Extracting a release takes long enough for a second
    // click to arrive inside it, and two passes over one attempt place the book twice under two
    // dock rows - or the faster one's cleanup takes the staging the slower one is still reading.
    const download = await this.downloads.updateIf(downloadId, ['needs_review'], { status: 'importing' });
    if (!download) throw new BadRequestException('This download is not waiting for a book to be chosen');

    try {
      await this.runImport(download, joined.request, choice.primaryPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.fulfillment.failDownload(download, message);
      throw new BadRequestException(message);
    }
  }

  private async runImport(download: BookRequestDownloadRow, request: BookRequestRow, chosenPrimaryPath?: string): Promise<void> {
    const extractionDirectory = extractionDirectoryFor(this.stagingPath, download.id, randomUUID().slice(0, 8));
    try {
      await this.runImportFromDisk(download, request, extractionDirectory, chosenPrimaryPath);
    } finally {
      // The files are hardlinked into the dock by now, so dropping the staging copy costs nothing
      // and leaves the dock's inodes alone. On failure it drops a half-extracted tree instead.
      await removeExtractionDirectory(extractionDirectory);
    }
  }

  /**
   * A direct file was staged by BookOrbit itself, so what it reported is already a path we can
   * open, bounded by the staging root it was written into. Anything a download client reported is
   * in that client's own filesystem namespace and has to be translated through the mappings
   * configured for it, which is also what declares the directory the import may read out of.
   */
  private async resolveLocalPath(download: BookRequestDownloadRow, contentPath: string): Promise<ResolvedDownloadPath> {
    if (download.source === 'direct_url') {
      const containmentRoot = directDownloadRoot(this.config.getOrThrow<string>('storage.appDataPath'));
      await this.pathMappings.assertWithinRoot(containmentRoot, contentPath);
      return { localPath: contentPath, containmentRoot };
    }
    if (download.downloadClientId === null) throw new Error('The download client for this attempt has been removed');

    return this.pathMappings.toLocalPath(download.downloadClientId, contentPath);
  }

  private async runImportFromDisk(
    download: BookRequestDownloadRow,
    request: BookRequestRow,
    extractionDirectory: string,
    chosenPrimaryPath?: string,
  ): Promise<void> {
    const started = Date.now();
    if (!download.contentPath) throw new Error('The download did not report where the finished files are');

    const { localPath, containmentRoot } = await this.resolveLocalPath(download, download.contentPath);
    const { root, plan, containmentRoot: contentContainmentRoot } = await this.resolveReleasePlan(localPath, containmentRoot, extractionDirectory);

    // Part of the release was never read, so what looks like a whole book may be the half of one
    // that fitted inside the bounds. Importing it would mark the request available on a book with
    // tracks missing, which is worse than asking a human to look.
    if (plan.truncated) {
      await this.holdForTruncatedRelease(download, request);
      return;
    }

    const selection = selectReleaseUnit(plan, { mediaKind: request.mediaKind, primaryPath: chosenPrimaryPath ?? null });

    if (selection.kind === 'none') {
      throw new Error(chosenPrimaryPath ? 'The chosen book is no longer in this download' : 'The download contains no supported book file');
    }
    if (selection.kind === 'ambiguous') {
      await this.holdForChoice(download, request, selection.units);
      return;
    }

    const unit = selection.unit;
    if (selection.ignored.length > 0) {
      this.logger.log(
        `[book_request.select_unit] [end] requestId=${request.id} downloadId=${download.id} ignoredUnits=${selection.ignored.length} - the release held other books that did not match the request`,
      );
    }

    const sourceFile = join(root, unit.primaryPath);
    let { placement, dockRow, format, size, suffix } = await this.claimDestination(request, root, unit);

    // Claimed before the file is placed, not after: the claim is what stops a later resume sweep
    // from linking the same download a second time, and it has to outlive a crash mid-link.
    //
    // Conditional, and this is the last moment it can be. Downloading and extracting a release
    // takes minutes, and a cancellation or a manual fulfilment landing inside them is a decision a
    // person made; importing anyway would file a book against a request nobody wants and hand the
    // dock a row with no owner. The dock row goes back with it, so nothing is left pointing at a
    // file that was never placed, and the attempt is settled too - otherwise the resume sweep
    // would pick this same download up again every fifteen seconds.
    const claimed = await this.requests.updateIf(request.id, WORKER_WRITABLE_BOOK_REQUEST_STATUSES, {
      status: 'importing',
      bookDockFileId: dockRow.id,
    });
    if (!claimed) {
      await this.dockRepo.deleteById(dockRow.id).catch(() => {});
      await this.downloads.updateIf(download.id, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES, {
        status: 'failed',
        errorMessage: 'The request was settled while this download was finishing, so nothing was imported',
      });
      this.logger.log(
        `[book_request.import] [end] requestId=${request.id} downloadId=${download.id} durationMs=${Date.now() - started} - the request was settled while the download finished, so nothing was imported`,
      );
      this.gateway.emitChanged();
      return;
    }

    await this.downloads.update(download.id, { status: 'importing', localPath: sourceFile, bookDockFileId: dockRow.id });
    this.gateway.emitProgress(
      {
        requestId: request.id,
        downloadId: download.id,
        status: 'importing',
        progressPercent: download.progressPercent,
        downloadedBytes: download.downloadedBytes,
        totalBytes: download.totalBytes,
      },
      (await this.requests.findRequestViewerIds([request.id])).get(request.id) ?? [],
    );
    this.gateway.emitChanged();

    for (;;) {
      try {
        await this.placeUnit(placement, contentContainmentRoot, download);
        break;
      } catch (error) {
        // The row only exists to reserve the destination; links that never happened must not leave
        // a dock entry pointing at nothing. `placeUnit` already removed only the paths it created.
        await this.dockRepo.deleteById(dockRow.id).catch(() => {});
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || suffix >= MAX_UNIQUE_SUFFIX_ATTEMPTS - 1) throw error;

        ({ placement, dockRow, format, size, suffix } = await this.claimDestination(request, root, unit, suffix + 1));
        // The request can be cancelled while a colliding name is being retried. The new dock row is
        // not entitled to replace that decision merely because the first one held the claim.
        if (!(await this.requests.updateIf(request.id, ['importing'], { bookDockFileId: dockRow.id }))) {
          await this.dockRepo.deleteById(dockRow.id).catch(() => {});
          await this.downloads.updateIf(download.id, UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES, {
            status: 'failed',
            errorMessage: 'The request was settled while this download was finishing, so nothing was imported',
          });
          this.gateway.emitChanged();
          return;
        }
        await this.downloads.update(download.id, { bookDockFileId: dockRow.id });
      }
    }

    // The watcher will also see the new file. `ingestFromWatchedFolder` short-circuits on the row
    // we just created and simply requeues it, so calling both is idempotent - and it means a
    // failed watcher startup does not silently strand every import at "importing".
    await this.dockIngest.ingestFromWatchedFolder(placement.primaryDestPath).catch((err: unknown) => {
      this.logger.warn(
        `[book_request.import] [fail] requestId=${request.id} dockFileId=${dockRow.id} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - could not queue the dock row, leaving it to the watcher`,
      );
    });

    this.logger.log(
      `[book_request.import] [end] requestId=${request.id} downloadId=${download.id} dockFileId=${dockRow.id} format=${format} fileCount=${placement.files.length} sizeBytes=${size} durationMs=${Date.now() - started} - linked into the Book Dock`,
    );

    // Nobody clicked anything here, so the actor is the instance. A file arriving from a torrent
    // and being placed where the library can see it is worth a trail even though it is automatic.
    await this.audit
      .record({
        userId: null,
        actorUsername: 'system',
        action: AuditAction.BookRequestImport,
        resource: AuditResource.BookRequest,
        resourceId: request.id,
        description: `Imported a download for book request #${request.id}`,
        meta: { downloadId: download.id, bookDockFileId: dockRow.id, format, sizeBytes: size },
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `[book_request.import] [fail] requestId=${request.id} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - audit write failed`,
        );
      });

    await this.removal.cleanupStagedDirectDownload(download);
  }

  /**
   * What the finished download actually is, read by the same interpreter that ran on the
   * `.torrent` manifest before the grab, so a release accepted at grab time cannot be refused here
   * for a different reason. A magnet reaches this point never having been inspected at all, and an
   * archive's contents are unknowable until it is open, so this is where both are judged.
   */
  private async resolveReleasePlan(
    localPath: string,
    containmentRoot: string,
    extractionDirectory: string,
  ): Promise<{ root: string; plan: ReleasePlan; containmentRoot: string }> {
    const info = await stat(localPath).catch(() => null);
    if (!info) throw new Error(`The downloaded content is not readable at ${localPath}`);

    const root = info.isDirectory() ? localPath : dirname(localPath);
    const rootName = info.isDirectory() ? basename(localPath) : null;
    // Shared across every extraction pass, so unwrapping twice cannot cost twice the ceiling.
    const budget = createArchiveBudget();
    const walked: ReleaseWalk = info.isDirectory()
      ? await collectReleaseFiles(localPath)
      : { files: [{ path: basename(localPath), sizeBytes: info.size }], truncated: false };
    let plan = interpretRelease(walked.files, { rootName, truncated: walked.truncated });
    let contentRoot = root;
    // What every file the plan names must stay inside. Once a release has been unwrapped that is
    // staging, which BookOrbit wrote itself, rather than the directory the client reported.
    let contentContainmentRoot = containmentRoot;

    /**
     * A packaged release only becomes interpretable once it is open, so the archive is expanded
     * into staging and read again. Never into the download's own directory: writing there would
     * corrupt exactly the bytes the torrent is still seeding.
     *
     * Twice, because scene ebook packaging is a zip holding a rar holding the book, and one pass
     * stops on the rar. Every bound is re-applied on each pass and the byte budget is shared
     * across them, so the depth ceiling is the only thing that moves.
     */
    for (let pass = 0; plan.units.length === 0 && plan.containers.length > 0; pass++) {
      if (pass >= MAX_ARCHIVE_NESTING) {
        throw new Error('The download is an archive nested deeper than BookOrbit will unwrap');
      }
      const target = pass === 0 ? extractionDirectory : join(extractionDirectory, `pass-${pass + 1}`);
      await this.extractContainers(contentRoot, contentContainmentRoot, plan.containers, target, budget);
      contentRoot = target;
      contentContainmentRoot = extractionDirectory;
      const extracted = await collectReleaseFiles(target);
      plan = interpretRelease(extracted.files, { rootName, truncated: extracted.truncated });
    }

    return { root: contentRoot, plan, containmentRoot: contentContainmentRoot };
  }

  /**
   * The release turned out to hold several distinct books and nothing narrows it to one. The bytes
   * are already downloaded, so failing here would throw away a finished torrent over a question an
   * approver answers in seconds; the attempt waits in the dock with the list instead.
   */
  private async holdForChoice(download: BookRequestDownloadRow, request: BookRequestRow, units: ReleaseUnit[]): Promise<void> {
    const choices: ReleaseUnitChoice[] = units.map((unit, index) => ({
      index,
      mediaKind: unit.mediaKind,
      title: unit.title,
      contentFileCount: unit.contentFileCount,
      totalFileCount: unit.files.length,
      sizeBytes: unit.sizeBytes,
      primaryPath: unit.primaryPath,
    }));

    this.logger.log(
      `[book_request.import] [end] requestId=${request.id} downloadId=${download.id} units=${choices.length} - the release holds several books, waiting for a choice`,
    );

    await this.fulfillment.holdForReview(download, request, `this release contains ${choices.length} separate books, so one has to be chosen`, {
      releaseUnits: choices,
    });
  }

  private async holdForTruncatedRelease(download: BookRequestDownloadRow, request: BookRequestRow): Promise<void> {
    this.logger.warn(
      `[book_request.import] [end] requestId=${request.id} downloadId=${download.id} maxDepth=${MAX_SCAN_DEPTH} maxEntries=${MAX_SCAN_ENTRIES} - the release is larger than BookOrbit reads, holding rather than importing part of it`,
    );
    await this.fulfillment.holdForReview(
      download,
      request,
      `this release is deeper or larger than BookOrbit reads (${MAX_SCAN_DEPTH} levels, ${MAX_SCAN_ENTRIES} entries), so importing it could take only part of the book`,
    );
  }

  /**
   * Expands the release's archives. A multi-volume RAR is one archive with many parts, so only the
   * first volume of each set is opened; the reader pulls in the rest itself.
   */
  private async extractContainers(
    root: string,
    containmentRoot: string,
    containers: ReleasePlan['containers'],
    extractionDirectory: string,
    budget: ArchiveBudget,
  ): Promise<void> {
    const primary = containers.filter((container) => !isContinuationVolume(container.path));
    if (primary.length === 0) throw new Error('The download is a split archive with no first volume to open');
    if (primary.length > 1) {
      throw new Error(`The download contains ${primary.length} separate archives, which is not supported`);
    }

    const container = primary[0]!;
    const started = Date.now();
    const archivePath = join(root, container.path);
    await this.pathMappings.assertWithinRoot(containmentRoot, archivePath);
    try {
      await extractReleaseArchive(archivePath, container.kind, extractionDirectory, budget);
    } catch (error) {
      // Re-thrown as a plain Error because the message is what `failDownload` records and what
      // the requester eventually reads; the original stays attached for the log.
      if (error instanceof ReleaseArchiveError) throw new Error(error.message, { cause: error });
      throw error;
    }

    this.logger.log(
      `[book_request.extract] [end] kind=${container.kind} durationMs=${Date.now() - started} path="${sanitizeLogValue(container.path)}" - release archive extracted into staging`,
    );
  }

  /**
   * The destination, claimed rather than merely chosen.
   *
   * The dock row comes before the files, deliberately. If the file were linked first the watcher
   * could win the race and create the row itself with no target library and no uploader, which
   * lands the book in the default library and broadcasts "auto-finalized" to every user on the
   * instance. For a unit that also means the directory is claimed before it exists on disk, so the
   * watcher's claim check can never lose the race to chokidar.
   *
   * Naming a free path and then inserting it is check-then-act: two imports finishing together -
   * an operator's manual import beside the queue's own, or two downloads of the same book - both
   * read the same name as free and the loser's insert hits the dock's unique `absolute_path`. The
   * insert is the only atomic claim there is, so a lost race retries from the next suffix instead
   * of failing an import that a different file name would have satisfied.
   */
  private async claimDestination(
    request: BookRequestRow,
    root: string,
    unit: ReleaseUnit,
    from = 0,
  ): Promise<{ placement: UnitPlacement; dockRow: { id: number }; format: string; size: number; suffix: number }> {
    for (let suffix = from; ; suffix++) {
      const placement = await this.planPlacement(request.id, root, unit, suffix);
      const format = extname(placement.primaryDestPath).toLowerCase().slice(1);
      const size = placement.files.find((file) => file.destPath === placement.primaryDestPath)?.sizeBytes ?? 0;

      try {
        const dockRow = await this.dockRepo.createUnit(
          {
            fileName: basename(placement.primaryDestPath),
            absolutePath: placement.primaryDestPath,
            fileSize: size,
            format,
            unitDirectory: placement.unitDirectory,
            status: 'pending',
            targetLibraryId: request.targetLibraryId,
            targetFolderId: request.targetFolderId,
            uploadedBy: request.userId,
            autoFinalizeSuppressed: true,
          },
          placement.unitDirectory === null
            ? []
            : placement.files.map((file) => ({
                absolutePath: file.destPath,
                fileName: basename(file.destPath),
                fileSize: file.sizeBytes,
                format: file.format,
                role: file.role,
                sortOrder: file.sortOrder,
              })),
        );
        return { placement, dockRow, format, size, suffix };
      } catch (error: unknown) {
        if (!isUniqueViolation(error) || suffix >= MAX_UNIQUE_SUFFIX_ATTEMPTS - 1) throw error;
        this.logger.warn(
          `[book_request.dock_claim] [fail] requestId=${request.id} attempt=${suffix + 1} path="${sanitizeLogValue(placement.primaryDestPath)}" - the Book Dock destination was claimed by another import, trying the next name`,
        );
      }
    }
  }

  /**
   * Where every file of the unit is going. A unit of one file keeps the flat
   * `request-<id>-<name>.epub` shape it has always had, so nothing about the ordinary single-book
   * import changes; anything larger gets a directory of its own and keeps the original file names
   * inside it, because the scanner recovers track order from those names.
   *
   * `taken` is how many names the caller has already lost a race for, which is where the search
   * for a free one resumes.
   */
  private async planPlacement(requestId: number, root: string, unit: ReleaseUnit, taken = 0): Promise<UnitPlacement> {
    if (unit.files.length === 1) {
      const file = unit.files[0]!;
      const destPath = await this.resolveFreeName(requestId, basename(file.path), { directory: false }, taken);
      return {
        unitDirectory: null,
        primaryDestPath: destPath,
        files: [{ sourcePath: join(root, file.path), destPath, sizeBytes: file.sizeBytes ?? 0, format: file.format, role: file.role, sortOrder: 0 }],
      };
    }

    const unitDirectory = await this.resolveFreeName(requestId, unit.title ?? basename(unit.primaryPath), { directory: true }, taken);
    const files = unit.files.map((file) => ({
      sourcePath: join(root, file.path),
      destPath: join(unitDirectory, this.unitDestinationName(unit, file.path)),
      sizeBytes: file.sizeBytes ?? 0,
      format: file.format,
      role: file.role,
      sortOrder: file.sortOrder,
    }));

    return { unitDirectory, primaryDestPath: join(unitDirectory, this.unitDestinationName(unit, unit.primaryPath)), files };
  }

  /**
   * The file's path *within* the unit, each segment sanitized on its own so the disc folder
   * survives rather than the separator. Flattening to the file name collides the moment a release
   * folds `CD 1` and `CD 2` into one book: both hold a `track01.mp3`, and the dock's unique
   * `absolute_path` rejects the second before a single file has been placed.
   */
  private unitDestinationName(unit: ReleaseUnit, path: string): string {
    const segments = unitRelativePath(unit, path)
      .split('/')
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
      .map((segment) => this.validator.sanitizeFilename(segment));
    return segments.length > 0 ? join(...segments) : this.validator.sanitizeFilename(basename(path));
  }

  /**
   * Places a claimed unit, rolling back only paths this invocation actually created.
   *
   * That distinction matters on EEXIST: the path that caused the failure belongs to the winner of
   * the race. Unlinking every planned destination during cleanup would delete that winner's file,
   * turning a harmless name collision into data loss.
   */
  private async placeUnit(placement: UnitPlacement, containmentRoot: string, download: BookRequestDownloadRow): Promise<void> {
    const placed: string[] = [];
    const createdDirectories: string[] = [];

    try {
      if (placement.unitDirectory !== null) {
        await mkdir(placement.unitDirectory);
        createdDirectories.push(placement.unitDirectory);
      }

      for (const file of placement.files) {
        // Checked here rather than when the plan was built: this is the last moment before the
        // file is opened, so nothing swapped underneath it in between can be linked into the dock.
        await this.pathMappings.assertWithinRoot(containmentRoot, file.sourcePath);
        if (placement.unitDirectory !== null) {
          await this.createDestinationDirectories(placement.unitDirectory, dirname(file.destPath), createdDirectories);
        }
        await this.placeFile(file.sourcePath, file.destPath, download);
        placed.push(file.destPath);
      }
    } catch (error) {
      for (const path of placed.reverse()) await unlink(path).catch(() => {});
      for (const path of createdDirectories.reverse()) await rmdir(path).catch(() => {});
      throw error;
    }
  }

  /** Creates nested unit directories one at a time so cleanup knows which ones belong to it. */
  private async createDestinationDirectories(root: string, target: string, created: string[]): Promise<void> {
    const nested = relative(root, target);
    if (!nested) return;

    let current = root;
    for (const segment of nested.split(sep).filter(Boolean)) {
      current = join(current, segment);
      try {
        await mkdir(current);
        created.push(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!(await stat(current)).isDirectory()) throw error;
      }
    }
  }

  /**
   * `book_dock_files.absolutePath` and `unit_directory` are both unique and `fs.link()` throws
   * EEXIST, so two releases both called `book.epub`, or a second attempt at the same request,
   * would otherwise collide.
   *
   * A free name here is a snapshot, not a reservation: `claimDestination` is what holds one, and
   * `from` is how it asks for the next candidate after losing a race for this one.
   */
  private async resolveFreeName(requestId: number, sourceName: string, options: { directory: boolean }, from = 0): Promise<string> {
    const safeName = this.validator.sanitizeFilename(sourceName);
    const ext = options.directory ? '' : extname(safeName);
    const stem = ext ? safeName.slice(0, -ext.length) : safeName;
    const base = `request-${requestId}-${stem}`;

    for (let attempt = from; attempt < MAX_UNIQUE_SUFFIX_ATTEMPTS; attempt++) {
      const candidate = join(this.bookDockPath, attempt === 0 ? `${base}${ext}` : `${base}-${attempt + 1}${ext}`);
      const [onDisk, claimed] = await Promise.all([
        exists(candidate),
        options.directory ? this.dockRepo.findByUnitDirectory(candidate) : this.dockRepo.findByAbsolutePath(candidate),
      ]);
      if (!onDisk && !claimed) return candidate;
    }

    throw new Error('Could not find a free destination filename in the Book Dock');
  }

  /**
   * Hardlink first so the torrent keeps seeding from the same bytes and the disk is not doubled.
   * Radarr and Sonarr fall back to a copy silently; for book-sized files a copy is a perfectly
   * workable steady state, so this says so rather than raising an alarm.
   */
  private async placeFile(sourceFile: string, destPath: string, download: BookRequestDownloadRow): Promise<void> {
    const wantsHardlink =
      download.source === 'direct_url' || (download.downloadClientId !== null && (await this.clients.useHardlinks(download.downloadClientId)));

    if (wantsHardlink) {
      try {
        await link(sourceFile, destPath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOSYS') throw error;
        this.logger.warn(
          `[book_request.hardlink] [fail] requestId=${download.requestId} downloadId=${download.id} errorClass=${(error as Error)?.constructor?.name ?? 'Error'} error="${sanitizeLogValue(code ?? '')}" - hardlink unavailable, copying instead; the file now uses disk space twice`,
        );
      }
    }

    // Exclusive, like the hardlink above it: a plain copy overwrites, so a destination that was
    // free when it was named and taken by the time it is written would be silently clobbered.
    await copyFile(sourceFile, destPath, constants.COPYFILE_EXCL);
  }
}

/**
 * `.r00`, `.r01` and `.002` are parts of the archive their first volume opens, not archives in
 * their own right. Feeding them in separately would extract the same release several times over.
 */
function isContinuationVolume(path: string): boolean {
  return /\.(?:r\d{2,3}|\d{3})$/i.test(path) && !/\.(?:rar|7z|zip)$/i.test(path);
}

/**
 * Every file, not only the ones with a book extension: the interpreter needs the artwork and the
 * padding files too, because what a release *is* depends on what is beside the content as much as
 * on the content itself.
 */
async function collectReleaseFiles(root: string): Promise<ReleaseWalk> {
  const found: ReleaseFileInput[] = [];
  let visited = 0;
  let truncated = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH || visited >= MAX_SCAN_ENTRIES) {
      truncated = true;
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++visited > MAX_SCAN_ENTRIES) {
        truncated = true;
        return;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        const size = await stat(full).then(
          (info) => info.size,
          () => null,
        );
        found.push({ path: relative(root, full).split(sep).join('/'), sizeBytes: size });
      }
    }
  };

  await walk(root, 0);
  return { files: found, truncated };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
