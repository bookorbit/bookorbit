import { Injectable, Logger } from '@nestjs/common';
import { stat } from 'fs/promises';

import type { EpubMediaOverlayPlaylist, EpubMediaOverlayPlaylistItem } from '@bookorbit/types';
import { isAudioFormat } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { PositionConverterService } from '../position-converter/position-converter.service';
import { buildEpubMediaOverlayPlaylistFromFile } from '../reader/epub/epub-media-overlay';
import { BookRepository } from './book.repository';

const EVENT = 'book.audio_ebook_progress_sync';
const REVERSE_EVENT = 'book.ebook_audio_progress_sync';
const NARRATION_EVENT = 'book.narration_marker_advance';
// About a page of narration at normal speed: a page on a phone or an e-reader reads aloud in one to
// one and a half minutes, so a page start further back than this is a page the reader went back to.
const NARRATION_PAGE_SECONDS = 120;
const PLAYLIST_CACHE_MAX = 12;
const MAX_DURATION_DIFF_RATIO = 0.05;
const MAX_DURATION_DIFF_SECONDS = 300;

type SyncFilesResult = NonNullable<Awaited<ReturnType<BookRepository['findAudioEbookProgressSyncFiles']>>>;
type SyncFile = SyncFilesResult['files'][number];

type PlaylistCacheEntry = {
  absolutePath: string;
  mtimeMs: number;
  playlist: EpubMediaOverlayPlaylist;
  lastAccessed: number;
};

type SyncResolution = {
  targets: EpubProgressResolution[];
};

type EpubProgressResolution = {
  targetFile: SyncFile;
  cfi: string;
  koreaderProgress: string | null;
  percentage: number;
  positionSeconds: number | null;
  mediaOverlayFragment: string | null;
  mediaOverlaySectionIndex: number | null;
};

/** An EPUB position placed on the read-along file's narration timeline. */
type EbookOverlayPosition = {
  ebookFile: SyncFile;
  overlaySourceFile: SyncFile;
  playlist: EpubMediaOverlayPlaylist;
  overlayDurationSeconds: number;
  overlaySeconds: number;
  audioFiles: SyncFile[];
  audioTotalSeconds: number | null;
  siblingEpubFiles: SyncFile[];
};

type AudioPosition = {
  currentFileId: number;
  positionSeconds: number;
  percentage: number;
};

@Injectable()
export class AudiobookEbookProgressSyncService {
  private readonly logger = new Logger(AudiobookEbookProgressSyncService.name);
  private readonly playlistCache = new Map<number, PlaylistCacheEntry>();

  constructor(
    private readonly bookRepo: BookRepository,
    private readonly positionConverter: PositionConverterService,
  ) {}

  async syncFromAudioProgress(params: {
    userId: number;
    bookId: number;
    currentFileId: number;
    positionSeconds: number;
    percentage: number;
    syncKobo: boolean;
    sourceUpdatedAt?: Date;
  }): Promise<boolean> {
    const startedAt = Date.now();
    try {
      if ((await this.bookRepo.findReadAloudSyncMode(params.userId, params.bookId)) === 'disabled') return false;

      const resolution = await this.resolveProgress(params);
      if (!resolution) return false;

      const sourceUpdatedAt = params.sourceUpdatedAt ?? new Date();
      const acceptedTargets: EpubProgressResolution[] = [];
      for (const target of resolution.targets) {
        if (
          await this.bookRepo.upsertSyncedEpubProgressIfNewer({
            userId: params.userId,
            fileId: target.targetFile.id,
            cfi: target.cfi,
            percentage: target.percentage,
            positionSeconds: target.positionSeconds,
            mediaOverlayFragment: target.mediaOverlayFragment,
            mediaOverlaySectionIndex: target.mediaOverlaySectionIndex,
            koreaderProgress: target.koreaderProgress,
            sourceUpdatedAt,
          })
        ) {
          acceptedTargets.push(target);
        }
      }

      if (acceptedTargets.length === 0) return false;

      if (params.syncKobo) {
        const target = acceptedTargets[0]!;
        await this.bookRepo.syncKoboReadingStateFromProgress(params.userId, target.targetFile.id, target.percentage, null, null, null, null);
      }

      return true;
    } catch (error: unknown) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${EVENT}] [fail] userId=${params.userId} bookId=${params.bookId} currentFileId=${params.currentFileId} durationMs=${
          Date.now() - startedAt
        } errorClass=${errorClass} error="${errorMessage}" - audiobook to ebook progress sync failed`,
      );
      return false;
    }
  }

  async syncFromEbookProgress(params: {
    userId: number;
    bookId: number;
    bookFileId: number;
    percentage: number;
    cfi?: string | null;
    koreaderProgress?: string | null;
    positionSeconds?: number | null;
    mediaOverlayFragment?: string | null;
    mediaOverlaySectionIndex?: number | null;
    sourceUpdatedAt?: Date;
    syncSiblingEpubs?: boolean;
  }): Promise<boolean> {
    const startedAt = Date.now();
    try {
      if ((await this.bookRepo.findReadAloudSyncMode(params.userId, params.bookId)) === 'disabled') return false;

      const syncSiblingEpubs = params.syncSiblingEpubs !== false;
      const position = await this.resolveEbookOverlayPosition(params, syncSiblingEpubs);
      if (!position) return false;

      const sourceUpdatedAt = params.sourceUpdatedAt ?? new Date();
      const audio = this.mapOverlayPositionToAudio(position);
      if (audio) {
        const saved = await this.bookRepo.upsertAudioProgress(
          params.userId,
          params.bookId,
          audio.currentFileId,
          audio.positionSeconds,
          audio.percentage,
          sourceUpdatedAt,
        );
        if (!saved) return false;
      }
      if (!syncSiblingEpubs) return audio !== null;

      let siblingSynced = false;
      const textPercentage = audio ? null : this.clampPercentage(params.percentage);
      for (const target of await this.resolveSiblingEpubTargets(position, textPercentage)) {
        const accepted = await this.bookRepo.upsertSyncedEpubProgressIfNewer({
          userId: params.userId,
          fileId: target.targetFile.id,
          cfi: target.cfi,
          percentage: target.percentage,
          positionSeconds: target.positionSeconds,
          mediaOverlayFragment: target.mediaOverlayFragment,
          mediaOverlaySectionIndex: target.mediaOverlaySectionIndex,
          koreaderProgress: target.koreaderProgress,
          sourceUpdatedAt,
        });
        siblingSynced ||= accepted;
      }
      return audio !== null || siblingSynced;
    } catch (error: unknown) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${REVERSE_EVENT}] [fail] userId=${params.userId} bookId=${params.bookId} bookFileId=${params.bookFileId} durationMs=${
          Date.now() - startedAt
        } errorClass=${errorClass} error="${errorMessage}" - ebook to audiobook progress sync failed`,
      );
      return false;
    }
  }

  /**
   * Moves a read-along file's narration marker to a newer text position, so listening resumes on
   * the page a reader last reached on any device. Forward always. Back only to a page well behind
   * it: a page usually starts behind the sentence being narrated on it, and turning to that page
   * must not replay what was already heard, but a reader who went back chapters or pages takes the
   * narration along. A file never narrated has no marker to protect, so its first one is the
   * sentence the reader reached.
   */
  async advanceNarrationToText(params: {
    userId: number;
    bookId: number;
    bookFileId: number;
    percentage: number;
    cfi?: string | null;
    koreaderProgress?: string | null;
    sourceUpdatedAt?: Date;
  }): Promise<boolean> {
    if (!params.cfi && !params.koreaderProgress) return false;
    const startedAt = Date.now();
    try {
      const syncFiles = await this.bookRepo.findAudioEbookProgressSyncFiles(params.bookId);
      const file = syncFiles?.files.find((candidate) => candidate.id === params.bookFileId);
      if (!file || file.format?.toLowerCase() !== 'epub' || file.mediaOverlayAvailable !== true) return false;

      const sourceUpdatedAt = params.sourceUpdatedAt ?? new Date();
      const progress = await this.bookRepo.findProgress(params.userId, params.bookFileId);
      if (!progress || (progress.narrationUpdatedAt && progress.narrationUpdatedAt.getTime() >= sourceUpdatedAt.getTime())) return false;

      const playlist = await this.getPlaylist(file, params.bookId);
      const nearest = await this.nearestNarratedFragment(file.id, file.id, playlist, params.cfi ?? null, params.koreaderProgress ?? null);
      if (!nearest) return false;
      const reached = playlist.items.findIndex(
        (item) => item.textFragment === nearest.fragment && (nearest.chapterIndex == null || item.sectionIndex === nearest.chapterIndex),
      );
      const item = playlist.items[reached];
      if (!item) return false;
      const marker = this.markerItemIndex(playlist, progress);
      if (marker !== null && reached <= marker && !this.isWellBehind(playlist, reached, marker)) return false;

      return await this.bookRepo.advanceNarrationMarker({
        userId: params.userId,
        fileId: file.id,
        mediaOverlayFragment: this.itemFragment(item),
        mediaOverlaySectionIndex: item.sectionIndex,
        percentage: params.percentage,
        sourceUpdatedAt,
      });
    } catch (error: unknown) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${NARRATION_EVENT}] [fail] userId=${params.userId} bookId=${params.bookId} bookFileId=${params.bookFileId} durationMs=${
          Date.now() - startedAt
        } errorClass=${errorClass} error="${errorMessage}" - narration marker advance failed`,
      );
      return false;
    }
  }

  /**
   * Leaves each read-along file's narration marker on its first sentence after a reset, stamped
   * with the reset. A player paused before the reset still holds its old place, and with no marker
   * on the server it had nothing newer to weigh that against: it resumed there and wrote it back,
   * undoing the reset on every device. A newer marker makes it ask first, released builds included.
   */
  async startNarrationAfterReset(params: { userId: number; bookId: number; fileIds?: number[]; resetAt: Date }): Promise<void> {
    const startedAt = Date.now();
    try {
      const syncFiles = await this.bookRepo.findAudioEbookProgressSyncFiles(params.bookId);
      const readAlongs = (syncFiles?.files ?? []).filter(
        (file) =>
          file.format?.toLowerCase() === 'epub' && file.mediaOverlayAvailable === true && (!params.fileIds || params.fileIds.includes(file.id)),
      );
      for (const file of readAlongs) {
        const playlist = await this.getPlaylist(file, params.bookId);
        const first = playlist.items.find((item) => item.textFragment);
        if (!first) continue;
        await this.bookRepo.startNarrationAfterReset({
          userId: params.userId,
          fileId: file.id,
          mediaOverlayFragment: this.itemFragment(first),
          mediaOverlaySectionIndex: first.sectionIndex,
          resetAt: params.resetAt,
        });
      }
    } catch (error: unknown) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${NARRATION_EVENT}] [fail] userId=${params.userId} bookId=${params.bookId} durationMs=${
          Date.now() - startedAt
        } errorClass=${errorClass} error="${errorMessage}" - narration marker not placed after reset`,
      );
    }
  }

  private async resolveProgress(params: {
    bookId: number;
    currentFileId: number;
    positionSeconds: number;
    percentage: number;
  }): Promise<SyncResolution | null> {
    const syncFiles = await this.bookRepo.findAudioEbookProgressSyncFiles(params.bookId);
    if (!syncFiles) return null;

    const audioFiles = syncFiles.files.filter((file) => typeof file.format === 'string' && isAudioFormat(file.format));
    const currentAudioIndex = audioFiles.findIndex((file) => file.id === params.currentFileId);
    if (currentAudioIndex < 0) return null;

    const overlaySourceFile = this.selectOverlaySourceFile(syncFiles.files, syncFiles.primaryFileId);
    if (!overlaySourceFile) return null;

    const audioAbsoluteSeconds = this.computeAudioAbsoluteSeconds(audioFiles, currentAudioIndex, params.positionSeconds);
    const audioTotalSeconds = this.computeAudioTotalSeconds(audioFiles);
    if (audioAbsoluteSeconds === null || audioTotalSeconds === null) return null;

    const playlist = await this.getPlaylist(overlaySourceFile, params.bookId);
    if (playlist.items.length === 0 || playlist.durationSeconds == null || playlist.durationSeconds <= 0) return null;

    const overlaySeconds = this.mapAudioSecondsToOverlaySeconds(audioAbsoluteSeconds, audioTotalSeconds, playlist.durationSeconds);
    if (overlaySeconds === null) return null;

    const item = this.findItemBySeconds(playlist, overlaySeconds);
    if (!item?.textFragment) return null;

    const targetFile = this.selectTargetFile(syncFiles.files, syncFiles.primaryFileId, overlaySourceFile);
    const epubFiles = syncFiles.files.filter((file) => file.format?.toLowerCase() === 'epub');
    const orderedTargets = [targetFile, ...epubFiles.filter((file) => file.id !== targetFile.id)];
    const percentage = this.clampPercentage((overlaySeconds / playlist.durationSeconds) * 100);
    const targets: EpubProgressResolution[] = [];
    for (const candidate of orderedTargets) {
      const resolved = await this.resolveFragmentPositions(candidate, item, overlaySourceFile.id);
      if (resolved) targets.push(this.toEpubTarget(resolved, item, overlaySourceFile, overlaySeconds, percentage));
    }
    if (targets.length === 0) return null;

    return {
      targets,
    };
  }

  /**
   * Places an EPUB position on the read-along file's narration, which is what every other copy
   * of the book is found through. Returns null before any file is parsed when there is nothing
   * to carry the position to, which is every sync of a read-along EPUB that sits on its own.
   */
  private async resolveEbookOverlayPosition(
    params: {
      bookId: number;
      bookFileId: number;
      cfi?: string | null;
      koreaderProgress?: string | null;
      positionSeconds?: number | null;
      mediaOverlayFragment?: string | null;
      mediaOverlaySectionIndex?: number | null;
    },
    syncSiblingEpubs: boolean,
  ): Promise<EbookOverlayPosition | null> {
    const syncFiles = await this.bookRepo.findAudioEbookProgressSyncFiles(params.bookId);
    if (!syncFiles) return null;

    const ebookFile = syncFiles.files.find((file) => file.id === params.bookFileId && file.format?.toLowerCase() === 'epub');
    if (!ebookFile) return null;

    const overlaySourceFile = this.selectOverlaySourceFile(syncFiles.files, syncFiles.primaryFileId);
    if (!overlaySourceFile) return null;

    const audioFiles = syncFiles.files.filter((file) => typeof file.format === 'string' && isAudioFormat(file.format));
    const audioTotalSeconds = this.computeAudioTotalSeconds(audioFiles);
    const siblingEpubFiles = syncSiblingEpubs
      ? syncFiles.files.filter((file) => file.id !== ebookFile.id && file.format?.toLowerCase() === 'epub')
      : [];
    if (audioTotalSeconds === null && siblingEpubFiles.length === 0) return null;

    const playlist = await this.getPlaylist(overlaySourceFile, params.bookId);
    if (playlist.items.length === 0 || playlist.durationSeconds == null || playlist.durationSeconds <= 0) return null;

    const overlaySeconds = await this.resolveOverlaySecondsFromEbookPosition(ebookFile, overlaySourceFile.id, playlist, params);
    if (overlaySeconds === null) return null;

    return {
      ebookFile,
      overlaySourceFile,
      playlist,
      overlayDurationSeconds: playlist.durationSeconds,
      overlaySeconds,
      audioFiles,
      audioTotalSeconds,
      siblingEpubFiles,
    };
  }

  private mapOverlayPositionToAudio(position: EbookOverlayPosition): AudioPosition | null {
    if (position.audioTotalSeconds === null) return null;

    const audioSeconds = this.mapOverlaySecondsToAudioSeconds(position.overlaySeconds, position.overlayDurationSeconds, position.audioTotalSeconds);
    if (audioSeconds === null) return null;

    const filePosition = this.audioFilePositionForSeconds(position.audioFiles, audioSeconds);
    if (!filePosition) return null;

    return {
      currentFileId: filePosition.file.id,
      positionSeconds: filePosition.positionSeconds,
      percentage: this.clampPercentage((audioSeconds / position.audioTotalSeconds) * 100),
    };
  }

  /**
   * Where the position lands in every other EPUB of the book: the nearest narrated sentence,
   * located in each copy whose chapter text is identical.
   *
   * Behind an audiobook the copies follow its timeline percentage. Without one, `textPercentage`
   * is the source's own figure and is used as is: narration time drifts from text wherever the
   * pace changes or a section goes unnarrated, and KOReader decides by percentage whether a
   * pulled position is ahead of its own.
   */
  private async resolveSiblingEpubTargets(position: EbookOverlayPosition, textPercentage: number | null): Promise<EpubProgressResolution[]> {
    const item = this.findItemBySeconds(position.playlist, position.overlaySeconds);
    if (!item?.textFragment) return [];

    const percentage = textPercentage ?? this.clampPercentage((position.overlaySeconds / position.overlayDurationSeconds) * 100);
    const targets: EpubProgressResolution[] = [];
    for (const candidate of position.siblingEpubFiles) {
      const resolved = await this.resolveFragmentPositions(candidate, item, position.overlaySourceFile.id);
      if (resolved) targets.push(this.toEpubTarget(resolved, item, position.overlaySourceFile, position.overlaySeconds, percentage));
    }
    return targets;
  }

  /**
   * A copy's synced position. The narration marker goes only to the read-along file: it names one
   * of that file's sentences, and the web reader opens a file at its stored marker before its cfi,
   * so a copy without media overlays given one would open at the start of the chapter.
   */
  private toEpubTarget(
    resolved: { targetFile: SyncFile; cfi: string; koreaderProgress: string | null },
    item: EpubMediaOverlayPlaylistItem,
    overlaySourceFile: SyncFile,
    overlaySeconds: number,
    percentage: number,
  ): EpubProgressResolution {
    const narration = resolved.targetFile.id === overlaySourceFile.id;
    return {
      ...resolved,
      percentage,
      positionSeconds: narration ? overlaySeconds : null,
      mediaOverlayFragment: narration ? this.itemFragment(item) : null,
      mediaOverlaySectionIndex: narration ? item.sectionIndex : null,
    };
  }

  private selectOverlaySourceFile(files: SyncFile[], primaryFileId: number | null): SyncFile | null {
    const overlayFiles = files.filter((file) => file.format?.toLowerCase() === 'epub' && file.mediaOverlayAvailable);
    return overlayFiles.find((file) => file.id === primaryFileId) ?? overlayFiles[0] ?? null;
  }

  private selectTargetFile(files: SyncFile[], primaryFileId: number | null, overlaySourceFile: SyncFile): SyncFile {
    const primaryFile = files.find((file) => file.id === primaryFileId && file.format?.toLowerCase() === 'epub');
    return primaryFile ?? overlaySourceFile;
  }

  private computeAudioAbsoluteSeconds(audioFiles: SyncFile[], currentAudioIndex: number, positionSeconds: number): number | null {
    let offset = 0;
    for (let i = 0; i < currentAudioIndex; i += 1) {
      const duration = audioFiles[i]?.durationSeconds;
      if (!this.isPositiveFinite(duration)) return null;
      offset += duration;
    }

    const currentDuration = audioFiles[currentAudioIndex]?.durationSeconds;
    const clampedPosition = this.isPositiveFinite(currentDuration) ? Math.min(positionSeconds, currentDuration) : positionSeconds;
    return offset + Math.max(0, clampedPosition);
  }

  private computeAudioTotalSeconds(audioFiles: SyncFile[]): number | null {
    let total = 0;
    for (const file of audioFiles) {
      if (!this.isPositiveFinite(file.durationSeconds)) return null;
      total += file.durationSeconds;
    }
    return total > 0 ? total : null;
  }

  private mapAudioSecondsToOverlaySeconds(audioSeconds: number, audioTotalSeconds: number, overlayTotalSeconds: number): number | null {
    const diff = Math.abs(audioTotalSeconds - overlayTotalSeconds);
    const tolerance = Math.min(MAX_DURATION_DIFF_SECONDS, overlayTotalSeconds * MAX_DURATION_DIFF_RATIO);
    if (diff > tolerance) return null;

    return Math.max(0, Math.min(overlayTotalSeconds, audioSeconds * (overlayTotalSeconds / audioTotalSeconds)));
  }

  private mapOverlaySecondsToAudioSeconds(overlaySeconds: number, overlayTotalSeconds: number, audioTotalSeconds: number): number | null {
    const diff = Math.abs(audioTotalSeconds - overlayTotalSeconds);
    const tolerance = Math.min(MAX_DURATION_DIFF_SECONDS, overlayTotalSeconds * MAX_DURATION_DIFF_RATIO);
    if (diff > tolerance) return null;

    return Math.max(0, Math.min(audioTotalSeconds, overlaySeconds * (audioTotalSeconds / overlayTotalSeconds)));
  }

  private async resolveOverlaySecondsFromEbookPosition(
    ebookFile: SyncFile,
    overlaySourceFileId: number,
    playlist: EpubMediaOverlayPlaylist,
    params: {
      cfi?: string | null;
      koreaderProgress?: string | null;
      positionSeconds?: number | null;
      mediaOverlayFragment?: string | null;
      mediaOverlaySectionIndex?: number | null;
    },
  ): Promise<number | null> {
    // A copy without media overlays has no narration of its own. A marker it sends back is one an
    // earlier sync left on it, and its text position is the only one it can speak for.
    const hasNarration = ebookFile.mediaOverlayAvailable === true;
    if (
      hasNarration &&
      this.isNonNegativeFinite(params.positionSeconds) &&
      (params.mediaOverlayFragment || params.mediaOverlaySectionIndex != null) &&
      playlist.durationSeconds != null
    ) {
      return Math.max(0, Math.min(playlist.durationSeconds, params.positionSeconds));
    }

    if (hasNarration && params.mediaOverlayFragment) {
      const match = this.findItemStartByFragment(playlist, params.mediaOverlayFragment, params.mediaOverlaySectionIndex ?? null);
      if (match) return match.startSeconds;
    }

    const nearest = await this.nearestNarratedFragment(
      ebookFile.id,
      overlaySourceFileId,
      playlist,
      params.cfi ?? null,
      params.koreaderProgress ?? null,
    );
    if (nearest) {
      const match = this.findItemStartByFragmentId(playlist, nearest.fragment, nearest.chapterIndex);
      if (match) return match.startSeconds;
    }

    return null;
  }

  /**
   * The narrated sentence a text position falls in: the last one that starts at or before it. A
   * position in a section nobody narrates, such as the cover or the front matter, takes the first
   * sentence after it, or the last one before it when nothing after is narrated. Without that, a
   * reader back on the cover left the narration wherever it had been, however far ahead.
   */
  private async nearestNarratedFragment(
    ebookFileId: number,
    overlaySourceFileId: number,
    playlist: EpubMediaOverlayPlaylist,
    cfi: string | null,
    xpointer: string | null,
  ): Promise<{ fragment: string; chapterIndex: number | null } | null> {
    if (!cfi && !xpointer) return null;
    const candidates = playlist.items
      .filter((item): item is EpubMediaOverlayPlaylistItem & { textFragment: string } => !!item.textFragment)
      .map((item) => ({ chapterIndex: item.sectionIndex, fragment: item.textFragment }));
    const nearest = await this.positionConverter.nearestFragmentForPosition({
      bookFileId: ebookFileId,
      cfi,
      xpointer,
      candidates,
      sourceBookFileId: overlaySourceFileId,
    });
    if (nearest.status !== 'failed' && nearest.fragment) return { fragment: nearest.fragment, chapterIndex: nearest.chapterIndex ?? null };
    if (nearest.reason !== 'no_candidate_fragments' || nearest.chapterIndex == null) return null;
    const section = nearest.chapterIndex;
    const adjacent =
      candidates.find((candidate) => candidate.chapterIndex > section) ?? candidates.findLast((candidate) => candidate.chapterIndex < section);
    return adjacent ? { fragment: adjacent.fragment, chapterIndex: adjacent.chapterIndex } : null;
  }

  /**
   * Whether a sentence lies further behind another than a page reaches: in an earlier section,
   * which a page never spans, or more narration back than a page holds on a phone or an e-reader.
   */
  private isWellBehind(playlist: EpubMediaOverlayPlaylist, sentence: number, from: number): boolean {
    const behind = playlist.items[sentence];
    const ahead = playlist.items[from];
    if (!behind || !ahead || sentence >= from) return false;
    if (behind.sectionIndex !== ahead.sectionIndex) return true;
    let between = 0;
    for (let index = sentence; index < from; index += 1) {
      const duration = playlist.items[index]?.durationSeconds;
      if (this.isPositiveFinite(duration)) between += duration;
    }
    return between > NARRATION_PAGE_SECONDS;
  }

  /** Where in the playlist a stored marker sits, by its sentence first and its seconds after. */
  private markerItemIndex(
    playlist: EpubMediaOverlayPlaylist,
    marker: { positionSeconds: number | null; mediaOverlayFragment: string | null; mediaOverlaySectionIndex: number | null },
  ): number | null {
    const fragment = marker.mediaOverlayFragment;
    if (fragment) {
      const index = playlist.items.findIndex((item) => this.itemMatchesFragment(item, fragment, marker.mediaOverlaySectionIndex));
      if (index >= 0) return index;
    }
    if (this.isNonNegativeFinite(marker.positionSeconds)) {
      const item = this.findItemBySeconds(playlist, marker.positionSeconds);
      if (item) return playlist.items.indexOf(item);
    }
    return null;
  }

  private findItemBySeconds(playlist: EpubMediaOverlayPlaylist, positionSeconds: number): EpubMediaOverlayPlaylistItem | null {
    let elapsed = 0;
    let lastKnown: EpubMediaOverlayPlaylistItem | null = null;

    for (const item of playlist.items) {
      const duration = item.durationSeconds;
      const start = elapsed;
      if (typeof duration === 'number' && Number.isFinite(duration) && duration <= 0) continue;
      const end = this.isPositiveFinite(duration) ? start + duration : null;

      if (positionSeconds <= start) return item;
      if (end == null || positionSeconds < end) return item;

      lastKnown = item;
      elapsed = end;
    }

    return lastKnown;
  }

  private findItemStartByFragment(
    playlist: EpubMediaOverlayPlaylist,
    fragment: string,
    sectionIndex: number | null,
  ): { item: EpubMediaOverlayPlaylistItem; startSeconds: number } | null {
    let elapsed = 0;
    for (const item of playlist.items) {
      const startSeconds = elapsed;
      if (this.itemMatchesFragment(item, fragment, sectionIndex)) return { item, startSeconds };
      if (this.isPositiveFinite(item.durationSeconds)) elapsed += item.durationSeconds;
    }
    return null;
  }

  private findItemStartByFragmentId(
    playlist: EpubMediaOverlayPlaylist,
    fragment: string,
    sectionIndex: number | null,
  ): { item: EpubMediaOverlayPlaylistItem; startSeconds: number } | null {
    let elapsed = 0;
    for (const item of playlist.items) {
      const startSeconds = elapsed;
      if (item.textFragment === fragment && (sectionIndex == null || item.sectionIndex === sectionIndex)) return { item, startSeconds };
      if (this.isPositiveFinite(item.durationSeconds)) elapsed += item.durationSeconds;
    }
    return null;
  }

  private audioFilePositionForSeconds(audioFiles: SyncFile[], audioSeconds: number): { file: SyncFile; positionSeconds: number } | null {
    let elapsed = 0;
    for (let index = 0; index < audioFiles.length; index += 1) {
      const file = audioFiles[index];
      if (!file || !this.isPositiveFinite(file.durationSeconds)) return null;
      const isLast = index === audioFiles.length - 1;
      if (isLast || elapsed + file.durationSeconds > audioSeconds) {
        return {
          file,
          positionSeconds: Math.max(0, Math.min(file.durationSeconds, audioSeconds - elapsed)),
        };
      }
      elapsed += file.durationSeconds;
    }
    return null;
  }

  private async resolveFragmentPositions(
    targetFile: SyncFile,
    item: EpubMediaOverlayPlaylistItem,
    sourceBookFileId: number,
  ): Promise<{ targetFile: SyncFile; cfi: string; koreaderProgress: string | null } | null> {
    if (!item.textFragment) return null;
    const outcome = await this.positionConverter.fragmentToPositions({
      bookFileId: targetFile.id,
      chapterIndex: item.sectionIndex,
      fragment: item.textFragment,
      sourceBookFileId,
    });
    if (outcome.status === 'failed' || !outcome.cfi) return null;
    return { targetFile, cfi: outcome.cfi, koreaderProgress: outcome.koreaderProgress ?? null };
  }

  private async getPlaylist(file: SyncFile, bookId: number): Promise<EpubMediaOverlayPlaylist> {
    const { mtimeMs } = await stat(file.absolutePath);
    const cached = this.playlistCache.get(file.id);
    if (cached && cached.absolutePath === file.absolutePath && cached.mtimeMs === mtimeMs) {
      cached.lastAccessed = Date.now();
      return cached.playlist;
    }

    const playlist = await buildEpubMediaOverlayPlaylistFromFile(file.absolutePath, bookId, file.id);
    this.playlistCache.set(file.id, { absolutePath: file.absolutePath, mtimeMs, playlist, lastAccessed: Date.now() });
    this.evictPlaylistCache();
    return playlist;
  }

  private evictPlaylistCache(): void {
    if (this.playlistCache.size <= PLAYLIST_CACHE_MAX) return;
    const oldest = [...this.playlistCache.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)[0];
    if (oldest) this.playlistCache.delete(oldest[0]);
  }

  private itemFragment(item: EpubMediaOverlayPlaylistItem): string {
    return item.textFragment ? `${item.textHref}#${item.textFragment}` : item.textHref;
  }

  private itemMatchesFragment(item: EpubMediaOverlayPlaylistItem, rawFragment: string, sectionIndex: number | null): boolean {
    if (sectionIndex != null && item.sectionIndex !== sectionIndex) return false;
    if (this.itemFragment(item) === rawFragment) return true;

    const [, splitFragment] = rawFragment.split('#');
    const fragment = splitFragment ?? rawFragment;
    return !!fragment && item.textFragment === fragment;
  }

  private isPositiveFinite(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  private isNonNegativeFinite(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  private clampPercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }
}
