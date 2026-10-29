import { Injectable, Logger } from '@nestjs/common';
import type { AudiobookChapter } from '@bookorbit/types';

import {
  chapterProvenance,
  computeAudiobookManifestRevision,
  computeLayoutManifestRevision,
  computeAudiobookPositionsKey,
  isFileDerivedChapterSource,
  normalizeAudiobookChapters,
  orderAudiobookTracks,
  resolveStoredAudiobookChapters,
  sameAudiobookChapters,
} from '../../common/utils/audiobook-chapters.utils';
import { FileLockService, bookOperationLockKey } from '../../common/services/file-lock.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AudiobookChaptersRepository, type ChapterMutationOptions } from './audiobook-chapters.repository';

type TrackRow = Omit<Awaited<ReturnType<AudiobookChaptersRepository['findTrackRows']>>[number], 'fileHash' | 'chapterWriteProvenance'>;

@Injectable()
export class AudiobookChaptersService {
  private readonly logger = new Logger(AudiobookChaptersService.name);

  constructor(
    private readonly repo: AudiobookChaptersRepository,
    private readonly locks: FileLockService,
  ) {}

  /**
   * The manifest revision clients are handed for this book right now, and the positions key it
   * maps to. Recording the pair is what lets a write naming this revision through later, after a
   * change that moved no audio.
   */
  async currentRevision(bookId: number, rows: readonly TrackRow[], required = false): Promise<{ revision: string; positionsKey: string } | null> {
    const tracks = orderAudiobookTracks(rows);
    if (tracks.length === 0) return null;
    const state = await this.repo.findChapterState(bookId);
    const chapters = resolveStoredAudiobookChapters(state?.chapters, rows) ?? [];
    const revision = computeLayoutManifestRevision(tracks, chapters);
    const positionsKey = computeAudiobookPositionsKey(tracks);
    await this.recordManifestRevision(bookId, computeAudiobookManifestRevision(tracks, chapters), positionsKey, required);
    return { revision, positionsKey };
  }

  withWriteSnapshot<T>(bookId: number, write: (markWritten: () => Promise<void>) => Promise<T>): Promise<T> {
    return this.repo.withWriteSnapshot(bookId, write);
  }

  fileChapterHints(bookId: number) {
    return this.repo.findTrackRows(bookId);
  }

  /** Whether a position written against `revision` still lands on the same audio today. */
  async isPositionCompatible(bookId: number, revision: string, positionsKey: string): Promise<boolean> {
    if (/^[0-9a-f]{64}$/.test(revision) && revision.slice(0, 32) === positionsKey.slice(0, 32)) return true;
    return (await this.repo.findPositionsKey(bookId, revision)) === positionsKey;
  }

  /**
   * Records the revision clients hold right now, so a device that has not synced since keeps
   * syncing after the chapter write that is about to replace it.
   */
  async recordCurrentRevision(bookId: number, required = false): Promise<void> {
    try {
      await this.currentRevision(bookId, await this.repo.findTrackRows(bookId), required);
    } catch (error) {
      if (required) throw error;
      this.logRecordFailure(bookId, error);
    }
  }

  private async recordManifestRevision(bookId: number, revision: string, positionsKey: string, required = false): Promise<void> {
    try {
      await this.repo.recordManifestRevision(bookId, revision, positionsKey);
    } catch (error) {
      if (required) throw error;
      this.logRecordFailure(bookId, error);
      return;
    }
  }

  private logRecordFailure(bookId: number, error: unknown): void {
    const errorClass = error instanceof Error ? error.name : 'Error';
    const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
    this.logger.warn(
      `[audiobook_chapters.record_revision] [fail] bookId=${bookId} errorClass=${errorClass} error="${message}" - manifest revision not recorded`,
    );
  }

  /**
   * Stores chapters read from a book's audio files. An empty read clears only a list that itself
   * came from the files: chapters a provider, a migration or a person supplied are never erased by
   * a file that carries none. Callers have already dropped the write if chapters are locked.
   */
  async applyFileChapters(bookId: number, chapters: readonly AudiobookChapter[] | null): Promise<boolean> {
    return this.locks.withLock(bookOperationLockKey(bookId), async () => {
      const state = await this.repo.findChapterState(bookId);
      const current = state?.chapters?.length ? state.chapters : null;
      const next = chapters && chapters.length > 0 ? normalizeAudiobookChapters(chapters) : null;

      if (next === null && (current === null || !isFileDerivedChapterSource(state?.source))) return false;
      if (next !== null && current !== null && sameAudiobookChapters(next, normalizeAudiobookChapters(current))) return false;

      await this.recordCurrentRevision(bookId);
      await this.repo.writeChaptersWithVersions(
        bookId,
        {
          chapters: next,
          chaptersSource: next ? 'embedded' : null,
          chaptersUpdatedAt: new Date(),
          chaptersUpdatedBy: null,
        },
        [],
        { requireUnlocked: true },
      );
      return true;
    });
  }

  /**
   * Stores a list a person saved in the editor. The first save also keeps the list it replaces, so
   * what the files or a provider supplied can always be restored from the version history.
   */
  async saveEditedChapters(bookId: number, chapters: readonly AudiobookChapter[], userId: number, options?: ChapterMutationOptions): Promise<void> {
    await this.locks.withLock(bookOperationLockKey(bookId), () => this.saveVersioned(bookId, chapters, 'manual', userId, options));
  }

  /** Stores a list a bulk lookup applied on someone's behalf, versioned like an edit so it can be undone. */
  async saveLookedUpChapters(
    bookId: number,
    chapters: readonly AudiobookChapter[],
    userId: number | null,
    options?: ChapterMutationOptions,
  ): Promise<void> {
    await this.locks.withLock(bookOperationLockKey(bookId), () => this.saveVersioned(bookId, chapters, 'provider', userId, options));
  }

  private async saveVersioned(
    bookId: number,
    chapters: readonly AudiobookChapter[],
    source: 'manual' | 'provider',
    userId: number | null,
    options?: ChapterMutationOptions,
  ): Promise<void> {
    const next = normalizeAudiobookChapters(chapters);
    const versions: Parameters<AudiobookChaptersRepository['writeChaptersWithVersions']>[2][number][] = [];
    versions.push({ chapters: next, source, createdBy: userId });

    await this.recordCurrentRevision(bookId);
    await this.repo.writeChaptersWithVersions(bookId, { chapters: next, ...chapterProvenance(next, source, userId) }, versions, options);
  }

  /** The editor's "revert to automatic": whatever the files carry now, or nothing for the per-track list. */
  async restoreFileChapters(
    bookId: number,
    chapters: readonly AudiobookChapter[] | null,
    userId: number,
    options?: ChapterMutationOptions,
  ): Promise<void> {
    await this.locks.withLock(bookOperationLockKey(bookId), async () => {
      const next = chapters && chapters.length > 0 ? normalizeAudiobookChapters(chapters) : null;
      const versions: Parameters<AudiobookChaptersRepository['writeChaptersWithVersions']>[2][number][] = [];
      if (next) versions.push({ chapters: next, source: 'embedded', createdBy: userId });

      await this.recordCurrentRevision(bookId);
      await this.repo.writeChaptersWithVersions(bookId, { chapters: next, ...chapterProvenance(next, 'embedded') }, versions, options);
    });
  }
}
