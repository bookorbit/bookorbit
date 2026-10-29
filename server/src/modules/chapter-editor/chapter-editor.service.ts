import { basename } from 'node:path';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AUDIOBOOK_CHAPTER_LIMITS,
  Permission,
  BOOK_CHAPTERS_ERROR_CODES,
  CHAPTER_PAUSE_LIMITS,
  type AnalyzeBookChaptersResult,
  type AudiobookChapter,
  type ChapterPauseWindow,
  type ChapterWaveform,
  type ChapterLookupQueueStatus,
  type ChapterLookupReviewReason,
  type ChapterLookupReviewSummary,
  type WriteBookChaptersResult,
  type BookChapterSources,
  type ChapterLookupResult,
  type EbookBookChapters,
  type EbookChapterSource,
  type EpubTocItem,
  type BookChapterEditor,
  type BookChaptersErrorCode,
  type BookChaptersState,
  type BookChapterTrack,
  type BookChapterVersion,
  type BookChapterVersionSummary,
  type EmbeddedBookChapters,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import {
  computeChapterEditorRevision,
  normalizeAudiobookChapters,
  orderAudiobookTracks,
  resolveStoredAudiobookChapters,
} from '../../common/utils/audiobook-chapters.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AudiobookChaptersService } from '../audiobook-chapters/audiobook-chapters.service';
import { BookMetadataLockService } from '../book-metadata-lock/book-metadata-lock.service';
import { BookService } from '../book/book.service';
import { ChapterWriteUnavailableError, FileWriteService } from '../file-write/file-write.service';
import { MetadataService } from '../metadata/metadata.service';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';
import { UserService } from '../user/user.service';
import { EpubService } from '../reader/epub/epub.service';
import type { AnalyzeBookChaptersDto } from './dto/analyze-book-chapters.dto';
import type { LookupBookChaptersDto } from './dto/lookup-book-chapters.dto';
import { audibleRegionForDomain, ChapterLookupService } from './chapter-lookup.service';
import { AudioToolMissingError, ChapterPauseService, type PauseSegment } from './chapter-pause.service';
import type { SaveBookChaptersDto } from './dto/save-book-chapters.dto';
import type { WaveformBookChaptersDto } from './dto/waveform-book-chapters.dto';
import { flattenLookupTree, planAutoApply } from './chapter-auto-apply';
import type { WriteBookChaptersDto } from './dto/write-book-chapters.dto';
import type { RevertBookChaptersDto } from './dto/revert-book-chapters.dto';
import { ChapterEditorRepository } from './chapter-editor.repository';

type ChapterRow = NonNullable<Awaited<ReturnType<ChapterEditorRepository['findChapterRow']>>>;
type TrackRow = Awaited<ReturnType<ChapterEditorRepository['findTrackRows']>>[number];
type VersionRow = Awaited<ReturnType<ChapterEditorRepository['listVersions']>>[number];
type EbookFileRow = Awaited<ReturnType<ChapterEditorRepository['findEbookFiles']>>[number];

const DEFAULT_PAUSE_WINDOW_MS = 10_000;
const DEFAULT_WAVEFORM_WINDOW_MS = 16_000;
const DEFAULT_WAVEFORM_BUCKETS = 320;

/** Table-of-contents entries that never name a chapter of the narration. */
const FRONT_MATTER_LABEL = /^(cover|title page|copyright( page)?|contents|table of contents|about the book|also by .+|praise for .+|praise)$/i;

/** How one book's bulk lookup ended. A thrown error means it may be tried again. */
export interface BulkLookupOutcome {
  status: Extract<ChapterLookupQueueStatus, 'applied' | 'review' | 'not_found' | 'skipped'>;
  reason: ChapterLookupReviewReason | 'no_asin' | 'no_audio' | 'access_changed' | null;
  result: ChapterLookupReviewSummary | null;
}

interface PauseWindowPlan {
  pointMs: number;
  fromMs: number;
  toMs: number;
  /** Null when the files under the window cannot be placed on the timeline. */
  segments: PauseSegment[] | null;
}

interface EditorContext {
  bookId: number;
  row: ChapterRow | null;
  rows: TrackRow[];
  tracks: TrackRow[];
  revision: string;
}

@Injectable()
export class ChapterEditorService {
  private readonly logger = new Logger(ChapterEditorService.name);

  constructor(
    private readonly repo: ChapterEditorRepository,
    private readonly bookService: BookService,
    private readonly audiobookChapters: AudiobookChaptersService,
    private readonly metadataService: MetadataService,
    private readonly lockService: BookMetadataLockService,
    private readonly lookupService: ChapterLookupService,
    private readonly epubService: EpubService,
    private readonly providerConfig: ProviderConfigService,
    private readonly pauseService: ChapterPauseService,
    private readonly fileWriteService: FileWriteService,
    private readonly userService: UserService,
  ) {}

  async getState(bookId: number, user: RequestUser): Promise<BookChaptersState> {
    await this.bookService.verifyBookAccess(bookId, user);
    return this.buildState(bookId, await this.loadContext(bookId));
  }

  async save(bookId: number, dto: SaveBookChaptersDto, user: RequestUser): Promise<BookChaptersState> {
    const event = 'chapter_editor.save';
    const startedAt = Date.now();
    const lock = dto.lock ?? true;
    this.logger.log(`[${event}] [start] bookId=${bookId} userId=${user.id} chapters=${dto.chapters.length} lock=${lock} - chapter save started`);
    try {
      await this.bookService.verifyBookAccess(bookId, user, 'editor');
      const context = await this.loadContext(bookId);
      this.assertCurrent(context, dto.baseRevision);
      const chapters = this.validate(dto.chapters, this.timeline(context).totalDurationMs);

      await this.audiobookChapters.saveEditedChapters(bookId, chapters, user.id, { expectedRevision: dto.baseRevision, locked: lock });

      this.logger.log(`[${event}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} chapters=${chapters.length} - chapters saved`);
      return this.buildState(bookId, await this.loadContext(bookId));
    } catch (error) {
      this.logFailure(event, bookId, startedAt, error);
      throw error;
    }
  }

  async revert(
    bookId: number,
    dto: RevertBookChaptersDto,
    user: RequestUser,
    onProgress?: (done: number, total: number) => Promise<void>,
  ): Promise<BookChaptersState> {
    const event = 'chapter_editor.revert';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] bookId=${bookId} userId=${user.id} - chapter revert started`);
    try {
      await this.bookService.verifyBookAccess(bookId, user, 'editor');
      const context = await this.loadContext(bookId);
      this.assertCurrent(context, dto.baseRevision);
      const embedded = await this.readFileChapters(context, onProgress);

      await this.audiobookChapters.restoreFileChapters(bookId, embedded, user.id, { expectedRevision: dto.baseRevision, locked: false });

      this.logger.log(
        `[${event}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} chapters=${embedded.length} - chapters reverted to the files`,
      );
      return this.buildState(bookId, await this.loadContext(bookId));
    } catch (error) {
      this.logFailure(event, bookId, startedAt, error);
      throw error;
    }
  }

  /** Writes the saved chapters into the audio files. The list must be the one the caller last saw. */
  async writeToFiles(
    bookId: number,
    dto: WriteBookChaptersDto,
    user: RequestUser,
    onProgress?: (written: number, total: number) => Promise<void>,
  ): Promise<WriteBookChaptersResult> {
    await this.bookService.verifyBookAccess(bookId, user, 'editor');
    const context = await this.loadContext(bookId);
    this.assertCurrent(context, dto.baseRevision);
    const chapters = this.editorChapters(context);
    if (chapters.length === 0) throw this.coded(ConflictException, BOOK_CHAPTERS_ERROR_CODES.nothingToWrite, 'There are no chapters to write');
    const { tracks } = this.timeline(context);
    if (tracks.some((track) => track.startMs === null)) {
      throw this.coded(ConflictException, BOOK_CHAPTERS_ERROR_CODES.filesUnreadable, 'An audio file length is unknown');
    }
    try {
      return await this.fileWriteService.writeChapters(
        bookId,
        tracks.map((track) => ({ id: track.fileId, timelineStartMs: track.startMs! })),
        chapters,
        user.id,
        async () => {
          await this.bookService.verifyBookAccess(bookId, user, 'editor');
          const fresh = await this.loadContext(bookId);
          this.assertCurrent(fresh, dto.baseRevision);
          return {
            files: this.timeline(fresh).tracks.map((track) => ({ id: track.fileId, timelineStartMs: track.startMs! })),
            chapters: this.editorChapters(fresh),
          };
        },
        onProgress,
      );
    } catch (error) {
      if (error instanceof ChapterWriteUnavailableError) {
        throw new ConflictException({
          message: error.message,
          errorCode: BOOK_CHAPTERS_ERROR_CODES.writeUnavailable,
          errorMeta: { reason: error.reason },
        });
      }
      throw error;
    }
  }

  async readEmbedded(bookId: number, user: RequestUser, onProgress?: (done: number, total: number) => Promise<void>): Promise<EmbeddedBookChapters> {
    await this.bookService.verifyBookAccess(bookId, user, 'editor');
    const chapters = await this.readFileChapters(await this.loadContext(bookId), onProgress);
    return { chapters: normalizeAudiobookChapters(chapters) };
  }

  async lookup(bookId: number, dto: LookupBookChaptersDto, user: RequestUser): Promise<ChapterLookupResult> {
    await this.bookService.verifyBookAccess(bookId, user, 'editor');
    return this.lookupService.lookup(dto.asin, dto.region ?? (await this.defaultAudibleRegion()));
  }

  async readEbook(bookId: number, source: EbookChapterSource, user: RequestUser): Promise<EbookBookChapters> {
    await this.bookService.verifyBookAccess(bookId, user, 'editor');
    const sources = this.ebookSources(await this.repo.findEbookFiles(bookId));
    const fileId = source === 'toc' ? sources.ebookFileId : sources.readAlongFileId;
    if (fileId === null) {
      throw this.coded(ConflictException, BOOK_CHAPTERS_ERROR_CODES.ebookUnavailable, 'This book has no matching EPUB');
    }

    if (source === 'toc') {
      const info = await this.epubService.getBookInfo(bookId, fileId, user);
      const chapters = tocTitles(info.toc).map((title) => ({ title, startMs: 0 }));
      if (chapters.length === 0) throw this.coded(ConflictException, BOOK_CHAPTERS_ERROR_CODES.ebookUnavailable, 'The EPUB has no table of contents');
      return { source, fileId, chapters, titlesOnly: true, runtimeMs: null };
    }

    const playlist = await this.epubService.getMediaOverlayPlaylist(bookId, fileId, user);
    const chapters = normalizeAudiobookChapters(
      playlist.sections
        .filter((section) => section.label?.trim())
        .map((section) => ({ title: section.label!.trim(), startMs: Math.round(section.startSeconds * 1000) })),
    );
    if (chapters.length === 0)
      throw this.coded(ConflictException, BOOK_CHAPTERS_ERROR_CODES.ebookUnavailable, 'The read-along EPUB names no sections');
    return {
      source,
      fileId,
      chapters,
      titlesOnly: false,
      runtimeMs: playlist.durationSeconds === null ? null : Math.round(playlist.durationSeconds * 1000),
    };
  }

  /** Pauses near each point, for snapping chapter starts. A window whose audio will not decode is marked failed. */
  async analyze(bookId: number, dto: AnalyzeBookChaptersDto, user: RequestUser, signal?: AbortSignal): Promise<AnalyzeBookChaptersResult> {
    const event = 'chapter_editor.analyze';
    const startedAt = Date.now();
    const windowMs = dto.windowMs ?? DEFAULT_PAUSE_WINDOW_MS;
    this.logger.log(
      `[${event}] [start] bookId=${bookId} userId=${user.id} points=${dto.points.length} windowMs=${windowMs} - pause analysis started`,
    );
    try {
      await this.bookService.verifyBookAccess(bookId, user, 'editor');
      const plans = this.pauseWindows(await this.loadContext(bookId), dto.points, windowMs);
      const audioMs = plans.reduce((sum, plan) => sum + (plan.toMs - plan.fromMs), 0);
      if (audioMs > CHAPTER_PAUSE_LIMITS.maxAudioMs) {
        throw this.coded(BadRequestException, BOOK_CHAPTERS_ERROR_CODES.analysisTooLarge, 'Too much audio for one analysis');
      }
      const windows = await mapWithConcurrency(plans, 2, (plan) => this.listen(plan, signal));
      const failed = windows.filter((window) => window.failed).length;
      this.logger.log(
        `[${event}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} windows=${windows.length} failed=${failed} audioMs=${audioMs} - pause analysis finished`,
      );
      return { windows };
    } catch (error) {
      this.logFailure(event, bookId, startedAt, error);
      if (error instanceof AudioToolMissingError) {
        throw this.coded(ServiceUnavailableException, BOOK_CHAPTERS_ERROR_CODES.analysisUnavailable, 'ffmpeg is not available on the server');
      }
      throw error;
    }
  }

  /** Peak levels around one point, for the boundary view. A window that will not decode comes back failed. */
  async waveform(bookId: number, dto: WaveformBookChaptersDto, user: RequestUser, signal?: AbortSignal): Promise<ChapterWaveform> {
    await this.bookService.verifyBookAccess(bookId, user, 'editor');
    const [plan] = this.pauseWindows(await this.loadContext(bookId), [dto.atMs], dto.windowMs ?? DEFAULT_WAVEFORM_WINDOW_MS);
    const buckets = dto.buckets ?? DEFAULT_WAVEFORM_BUCKETS;
    const window = { fromMs: plan!.fromMs, toMs: plan!.toMs };
    if (!plan!.segments) return { ...window, peaks: [], failed: true };
    try {
      return { ...window, peaks: await this.pauseService.readPeaks(plan!.segments, buckets, signal), failed: false };
    } catch (error) {
      if (signal?.aborted || error instanceof ServiceUnavailableException) throw error;
      if (error instanceof AudioToolMissingError) {
        throw this.coded(ServiceUnavailableException, BOOK_CHAPTERS_ERROR_CODES.analysisUnavailable, 'ffmpeg is not available on the server');
      }
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[chapter_editor.waveform] [fail] bookId=${bookId} fromMs=${window.fromMs} toMs=${window.toMs} error="${message}" - waveform could not be decoded`,
      );
      return { ...window, peaks: [], failed: true };
    }
  }

  /**
   * One step of a bulk "find chapters on Audible": look the book up and apply the result when it is
   * certain enough to need nobody, otherwise say why it waits for a person. A list someone protected
   * is never replaced here. Access was checked when the book was queued.
   */
  async bulkLookup(bookId: number, userId: number | null): Promise<BulkLookupOutcome> {
    if (!(await this.canRunLookup(bookId, userId))) return { status: 'skipped', reason: 'access_changed', result: null };
    let context: EditorContext;
    try {
      context = await this.loadContext(bookId);
    } catch (error) {
      if (error instanceof NotFoundException) return { status: 'skipped', reason: 'no_audio', result: null };
      throw error;
    }
    const asin = context.row?.audibleId?.trim();
    if (!asin) return { status: 'skipped', reason: 'no_asin', result: null };

    let lookup: ChapterLookupResult;
    try {
      lookup = await this.lookupService.lookup(asin.toUpperCase(), await this.defaultAudibleRegion());
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404) return { status: 'not_found', reason: null, result: null };
      throw error;
    }

    const { totalDurationMs } = this.timeline(context);
    const result: ChapterLookupReviewSummary = {
      provider: lookup.provider,
      chapterCount: flattenLookupTree(lookup.chapters).length,
      runtimeMs: lookup.runtimeMs,
      totalDurationMs,
      isAccurate: lookup.isAccurate,
    };
    if (await this.lockService.isFieldLocked(bookId, 'chapters')) return { status: 'review', reason: 'locked', result };

    if (!(await this.canRunLookup(bookId, userId))) return { status: 'skipped', reason: 'access_changed', result: null };
    const plan = planAutoApply(lookup, totalDurationMs);
    if (plan.kind === 'review') return { status: 'review', reason: plan.reason, result };
    try {
      await this.audiobookChapters.saveLookedUpChapters(bookId, plan.chapters, userId, {
        expectedRevision: context.revision,
        requireUnlocked: true,
        locked: true,
      });
    } catch (error) {
      if (error instanceof ConflictException) return { status: 'review', reason: 'locked', result };
      throw error;
    }
    return { status: 'applied', reason: null, result: { ...result, chapterCount: plan.chapters.length } };
  }

  private async canRunLookup(bookId: number, userId: number | null): Promise<boolean> {
    if (userId === null) return false;
    const user = await this.userService.findByIdWithPermissions(userId);
    if (!user?.active || (!user.isSuperuser && !user.permissions.includes(Permission.LibraryEditMetadata))) return false;
    try {
      await this.bookService.verifyBookAccess(bookId, user, 'editor');
      return true;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  async listVersions(bookId: number, user: RequestUser): Promise<BookChapterVersionSummary[]> {
    await this.bookService.verifyBookAccess(bookId, user, 'editor');
    return (await this.repo.listVersions(bookId)).map((row) => this.mapVersion(row));
  }

  async getVersion(bookId: number, versionId: number, user: RequestUser): Promise<BookChapterVersion> {
    await this.bookService.verifyBookAccess(bookId, user, 'editor');
    const row = await this.repo.findVersion(bookId, versionId);
    if (!row) throw new NotFoundException('Chapter version not found');
    return { ...this.mapVersion(row), chapters: row.chapters };
  }

  private async loadContext(bookId: number): Promise<EditorContext> {
    const [row, rows] = await Promise.all([this.repo.findChapterRow(bookId), this.repo.findTrackRows(bookId)]);
    const tracks = orderAudiobookTracks(rows);
    if (tracks.length === 0) throw new NotFoundException('Book has no audio tracks');
    const revision = computeChapterEditorRevision(row, rows);
    return { bookId, row, rows, tracks, revision };
  }

  private async buildState(bookId: number, context: EditorContext): Promise<BookChaptersState> {
    const [locked, versionCount, ebookFiles, audibleRegion, writeBack] = await Promise.all([
      this.lockService.isFieldLocked(bookId, 'chapters'),
      this.repo.countVersions(bookId),
      this.repo.findEbookFiles(bookId),
      this.defaultAudibleRegion(),
      this.fileWriteService.resolveChapterWriteStatus(
        bookId,
        context.tracks.map((track) => track.id),
      ),
    ]);
    const { row } = context;
    const stored = row?.chapters?.length ? row.chapters : null;
    const chapters = this.editorChapters(context);
    const { tracks, totalDurationMs } = this.timeline(context);
    return {
      chapters,
      source: stored ? (row?.source ?? null) : chapters.length > 0 ? 'tracks' : null,
      derived: stored === null && chapters.length > 0,
      locked,
      revision: context.revision,
      updatedAt: stored ? (row?.updatedAt?.toISOString() ?? null) : null,
      updatedBy: stored ? this.editor(row?.updatedById ?? null, row?.updatedByName ?? null) : null,
      totalDurationMs,
      tracks,
      audibleId: row?.audibleId ?? null,
      versionCount,
      audibleRegion,
      sources: this.ebookSources(ebookFiles),
      writeBack,
    };
  }

  /** The list the editor shows: what is stored, or one chapter per file when nothing is. */
  private editorChapters(context: EditorContext): AudiobookChapter[] {
    const stored = context.row?.chapters?.length ? context.row.chapters : null;
    const resolved = resolveStoredAudiobookChapters(stored, context.rows);
    return resolved ? normalizeAudiobookChapters(resolved) : [];
  }

  private async defaultAudibleRegion() {
    return audibleRegionForDomain((await this.providerConfig.getConfig()).audible.domain);
  }

  /** The plain EPUB names chapters better than a read-along copy, which may add narration-only sections. */
  private ebookSources(files: readonly EbookFileRow[]): BookChapterSources {
    const content = files.filter((file) => file.role === 'content' || file.role === 'primary');
    const readAlong = content.find((file) => file.mediaOverlayAvailable) ?? null;
    const plain = content.find((file) => !file.mediaOverlayAvailable) ?? readAlong;
    return { ebookFileId: plain?.id ?? null, readAlongFileId: readAlong?.id ?? null };
  }

  private timeline(context: EditorContext): { tracks: BookChapterTrack[]; totalDurationMs: number | null } {
    let cursor: number | null = 0;
    const tracks = context.tracks.map<BookChapterTrack>((row) => {
      const durationMs = row.durationSeconds !== null && row.durationSeconds > 0 ? Math.round(row.durationSeconds * 1000) : null;
      const track = { fileId: row.id, name: basename(row.absolutePath), startMs: cursor, durationMs };
      cursor = cursor !== null && durationMs !== null ? cursor + durationMs : null;
      return track;
    });
    const declared = context.row?.durationSeconds ? context.row.durationSeconds * 1000 : null;
    return { tracks, totalDurationMs: cursor ?? declared };
  }

  private pauseWindows(context: EditorContext, points: readonly number[], windowMs: number): PauseWindowPlan[] {
    const { tracks, totalDurationMs } = this.timeline(context);
    const half = Math.floor(windowMs / 2);
    return points.map((raw) => {
      const pointMs = totalDurationMs !== null ? Math.min(raw, totalDurationMs) : raw;
      const fromMs = Math.max(0, pointMs - half);
      const toMs = totalDurationMs !== null ? Math.min(totalDurationMs, pointMs + half) : pointMs + half;
      return { pointMs, fromMs, toMs, segments: this.segmentsFor(context, tracks, fromMs, toMs) };
    });
  }

  /** The stretches of each file a window covers, on the same timeline the editor and the player use. */
  private segmentsFor(context: EditorContext, tracks: readonly BookChapterTrack[], fromMs: number, toMs: number): PauseSegment[] | null {
    const segments: PauseSegment[] = [];
    for (const [index, track] of tracks.entries()) {
      if (track.startMs === null) return null;
      // A file of unknown length cannot be told apart from the ones after it, so a window reaching
      // into it is unreadable, unless it is the last file and nothing follows.
      if (track.durationMs === null && index < tracks.length - 1 && toMs > track.startMs) return null;
      const endMs = track.durationMs !== null ? track.startMs + track.durationMs : Number.POSITIVE_INFINITY;
      const overlapFrom = Math.max(fromMs, track.startMs);
      const overlapTo = Math.min(toMs, endMs);
      if (overlapTo > overlapFrom) {
        segments.push({
          absolutePath: context.tracks[index]!.absolutePath,
          offsetMs: overlapFrom - track.startMs,
          durationMs: overlapTo - overlapFrom,
        });
      }
      if (endMs >= toMs) break;
    }
    return segments.length > 0 ? segments : null;
  }

  private async listen(plan: PauseWindowPlan, signal?: AbortSignal): Promise<ChapterPauseWindow> {
    const window = { pointMs: plan.pointMs, fromMs: plan.fromMs, toMs: plan.toMs };
    if (!plan.segments) return { ...window, pauses: [], failed: true };
    try {
      const pauses = await this.pauseService.findPauses(plan.segments, signal);
      return {
        ...window,
        pauses: pauses.map((pause) => ({ startMs: plan.fromMs + pause.startMs, endMs: plan.fromMs + pause.endMs })),
        failed: false,
      };
    } catch (error) {
      if (signal?.aborted || error instanceof ServiceUnavailableException || error instanceof AudioToolMissingError) throw error;
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[chapter_editor.analyze_window] [fail] fromMs=${plan.fromMs} toMs=${plan.toMs} error="${message}" - window could not be decoded`,
      );
      return { ...window, pauses: [], failed: true };
    }
  }

  private async readFileChapters(context: EditorContext, onProgress?: (done: number, total: number) => Promise<void>): Promise<AudiobookChapter[]> {
    const paths = context.tracks.map((track) => track.absolutePath);
    const chapters = onProgress
      ? await this.metadataService.readEmbeddedChapters(paths, context.bookId, onProgress)
      : await this.metadataService.readEmbeddedChapters(paths, context.bookId);
    if (chapters === null) {
      throw this.coded(ConflictException, BOOK_CHAPTERS_ERROR_CODES.filesUnreadable, 'An audio file could not be read');
    }
    return chapters;
  }

  private assertCurrent(context: EditorContext, baseRevision: string): void {
    if (context.revision !== baseRevision) {
      throw this.coded(ConflictException, BOOK_CHAPTERS_ERROR_CODES.stale, 'Chapters changed since they were loaded');
    }
  }

  /** The client checks all of this first; this is the contract for any other caller. */
  private validate(input: readonly AudiobookChapter[], totalDurationMs: number | null): AudiobookChapter[] {
    const chapters = input.map((chapter) => ({ title: chapter.title.trim(), startMs: chapter.startMs }));
    chapters.forEach((chapter, index) => {
      if (!chapter.title) throw this.coded(BadRequestException, BOOK_CHAPTERS_ERROR_CODES.emptyTitle, 'Every chapter needs a title', index);
      if (index === 0 && chapter.startMs !== 0) {
        throw this.coded(BadRequestException, BOOK_CHAPTERS_ERROR_CODES.firstNotZero, 'The first chapter must start at 0', index);
      }
      if (index > 0 && chapter.startMs <= chapters[index - 1]!.startMs) {
        throw this.coded(BadRequestException, BOOK_CHAPTERS_ERROR_CODES.notAscending, 'Chapters must start in order', index);
      }
      if (totalDurationMs !== null && chapter.startMs >= totalDurationMs) {
        throw this.coded(BadRequestException, BOOK_CHAPTERS_ERROR_CODES.pastEnd, 'A chapter starts after the audiobook ends', index);
      }
    });
    return chapters;
  }

  private mapVersion(row: VersionRow): BookChapterVersionSummary {
    return {
      id: row.id,
      source: row.source,
      chapterCount: row.chapterCount,
      createdAt: row.createdAt.toISOString(),
      createdBy: this.editor(row.createdById, row.createdByName),
    };
  }

  private editor(id: number | null, name: string | null): BookChapterEditor | null {
    return id !== null && name !== null ? { id, name } : null;
  }

  private coded(Exception: new (body: object) => HttpException, errorCode: BookChaptersErrorCode, message: string, index?: number): HttpException {
    return new Exception({ message, errorCode, ...(index !== undefined ? { errorMeta: { index } } : {}) });
  }

  private logFailure(event: string, bookId: number, startedAt: number, error: unknown): void {
    const errorClass = error instanceof Error ? error.name : 'Error';
    const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
    this.logger.warn(
      `[${event}] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - chapter change failed`,
    );
  }
}

/** Every named entry of a table of contents in reading order, without the wrapper root and front matter. */
function tocTitles(root: EpubTocItem | null): string[] {
  const titles: string[] = [];
  const walk = (items: readonly EpubTocItem[] | undefined) => {
    for (const item of items ?? []) {
      if (titles.length >= AUDIOBOOK_CHAPTER_LIMITS.maxChapters) return;
      const label = item.label?.trim();
      if (label && !FRONT_MATTER_LABEL.test(label)) titles.push(label.slice(0, AUDIOBOOK_CHAPTER_LIMITS.maxTitleLength));
      walk(item.children);
    }
  };
  if (root) walk(root.children?.length ? root.children : [root]);
  return titles;
}
