import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { BOOK_CHAPTERS_ERROR_CODES, type AudiobookChapter, type AudiobookChapterSource } from '@bookorbit/types';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import {
  computeChapterEditorRevision,
  computeAudiobookManifestRevision,
  computeAudiobookPositionsKey,
  orderAudiobookTracks,
  resolveStoredAudiobookChapters,
} from '../../common/utils/audiobook-chapters.utils';
import * as schema from '../../db/schema';
import { audiobookManifestRevisions, bookChapterVersions, bookFiles, bookMetadata } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const CHAPTER_VERSIONS_KEPT_PER_BOOK = 20;

export interface StoredChapterState {
  chapters: AudiobookChapter[] | null;
  source: AudiobookChapterSource | null;
}

export interface ChapterVersionWrite {
  chapters: AudiobookChapter[];
  source: AudiobookChapterSource;
  createdBy: number | null;
}

export interface ChapterMutationOptions {
  expectedRevision?: string;
  locked?: boolean;
  requireUnlocked?: boolean;
}

export interface ChapterWrite {
  chapters: AudiobookChapter[] | null;
  chaptersSource: AudiobookChapterSource | null;
  chaptersUpdatedAt: Date;
  chaptersUpdatedBy: number | null;
}

@Injectable()
export class AudiobookChaptersRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findTrackRows(bookId: number) {
    return this.db
      .select({
        id: bookFiles.id,
        fileHash: bookFiles.fileHash,
        chapterWriteProvenance: bookFiles.chapterWriteProvenance,
        publicId: bookFiles.publicId,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        durationSeconds: bookFiles.durationSeconds,
        sortOrder: bookFiles.sortOrder,
        mtime: bookFiles.mtime,
        updatedAt: bookFiles.updatedAt,
      })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId));
  }

  async findChapterState(bookId: number): Promise<StoredChapterState | null> {
    const [row] = await this.db
      .select({ chapters: bookMetadata.chapters, source: bookMetadata.chaptersSource })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);
    if (!row) return null;
    return { chapters: (row.chapters as AudiobookChapter[] | null) ?? null, source: row.source ?? null };
  }

  async writeChapters(bookId: number, values: ChapterWrite): Promise<void> {
    await this.db
      .update(bookMetadata)
      .set({ ...values, updatedAt: values.chaptersUpdatedAt })
      .where(eq(bookMetadata.bookId, bookId));
  }

  async withWriteSnapshot<T>(bookId: number, write: (markWritten: () => Promise<void>) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.insert(bookMetadata).values({ bookId }).onConflictDoNothing();
      await tx.select({ bookId: bookMetadata.bookId }).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).for('update');
      return write(async () => {
        await tx.update(bookMetadata).set({ lastWrittenAt: new Date() }).where(eq(bookMetadata.bookId, bookId));
      });
    });
  }

  async hasChapterVersions(bookId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: bookChapterVersions.id })
      .from(bookChapterVersions)
      .where(eq(bookChapterVersions.bookId, bookId))
      .limit(1);
    return row !== undefined;
  }

  /** Writes the list and records each version in one transaction, then trims the oldest versions. */
  async writeChaptersWithVersions(
    bookId: number,
    values: ChapterWrite,
    versions: readonly ChapterVersionWrite[],
    options: ChapterMutationOptions = {},
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(bookMetadata).values({ bookId }).onConflictDoNothing();
      const [state] = await tx
        .select({
          chapters: bookMetadata.chapters,
          source: bookMetadata.chaptersSource,
          updatedAt: bookMetadata.chaptersUpdatedAt,
          lockedFields: bookMetadata.lockedFields,
          legacyRecorded: bookMetadata.manifestLegacyRecorded,
        })
        .from(bookMetadata)
        .where(eq(bookMetadata.bookId, bookId))
        .for('update');
      const tracks = await tx
        .select({
          id: bookFiles.id,
          publicId: bookFiles.publicId,
          absolutePath: bookFiles.absolutePath,
          format: bookFiles.format,
          durationSeconds: bookFiles.durationSeconds,
          sortOrder: bookFiles.sortOrder,
          fileHash: bookFiles.fileHash,
          sizeBytes: bookFiles.sizeBytes,
          mtime: bookFiles.mtime,
          updatedAt: bookFiles.updatedAt,
        })
        .from(bookFiles)
        .where(eq(bookFiles.bookId, bookId))
        .for('share');
      if (
        options.expectedRevision !== undefined &&
        computeChapterEditorRevision({ ...state, chapters: state.chapters as AudiobookChapter[] | null }, tracks) !== options.expectedRevision
      ) {
        throw new ConflictException({ message: 'Chapters changed since they were loaded', errorCode: BOOK_CHAPTERS_ERROR_CODES.stale });
      }
      if (options.requireUnlocked && state.lockedFields.includes('chapters')) {
        throw new ConflictException({ message: 'Chapters are protected', errorCode: BOOK_CHAPTERS_ERROR_CODES.stale });
      }
      if (!state.legacyRecorded) {
        const ordered = orderAudiobookTracks(tracks);
        if (ordered.length > 0)
          await tx
            .insert(audiobookManifestRevisions)
            .values({
              bookId,
              revision: computeAudiobookManifestRevision(
                ordered,
                resolveStoredAudiobookChapters(state.chapters as AudiobookChapter[] | null, tracks) ?? [],
              ),
              positionsKey: computeAudiobookPositionsKey(ordered),
            })
            .onConflictDoNothing();
      }
      const lockedFields =
        options.locked === undefined
          ? {}
          : {
              lockedFields: options.locked
                ? sql`CASE WHEN 'chapters' = ANY(${bookMetadata.lockedFields}) THEN ${bookMetadata.lockedFields} ELSE array_append(${bookMetadata.lockedFields}, 'chapters') END`
                : sql`array_remove(${bookMetadata.lockedFields}, 'chapters')`,
            };
      await tx
        .update(bookMetadata)
        .set({ ...values, ...lockedFields, manifestLegacyRecorded: true, updatedAt: values.chaptersUpdatedAt })
        .where(eq(bookMetadata.bookId, bookId));

      const [existingVersion] = await tx
        .select({ id: bookChapterVersions.id })
        .from(bookChapterVersions)
        .where(eq(bookChapterVersions.bookId, bookId))
        .limit(1);
      const allVersions: ChapterVersionWrite[] = [...versions];
      const previous = state.chapters as AudiobookChapter[] | null;
      if (!existingVersion && previous?.length) allVersions.unshift({ chapters: previous, source: state.source ?? 'embedded', createdBy: null });
      if (allVersions.length === 0) return;
      await tx.insert(bookChapterVersions).values(allVersions.map((version) => ({ bookId, ...version, chapterCount: version.chapters.length })));
      const kept = tx
        .select({ id: bookChapterVersions.id })
        .from(bookChapterVersions)
        .where(eq(bookChapterVersions.bookId, bookId))
        .orderBy(desc(bookChapterVersions.createdAt), desc(bookChapterVersions.id))
        .limit(CHAPTER_VERSIONS_KEPT_PER_BOOK);
      await tx.delete(bookChapterVersions).where(and(eq(bookChapterVersions.bookId, bookId), notInArray(bookChapterVersions.id, kept)));
    });
  }

  async recordManifestRevision(bookId: number, revision: string, positionsKey: string): Promise<void> {
    const [known] = await this.db
      .select({ recorded: bookMetadata.manifestLegacyRecorded })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);
    if (known?.recorded) return;
    await this.db.transaction(async (tx) => {
      await tx.insert(bookMetadata).values({ bookId }).onConflictDoNothing();
      const [state] = await tx
        .select({ recorded: bookMetadata.manifestLegacyRecorded })
        .from(bookMetadata)
        .where(eq(bookMetadata.bookId, bookId))
        .for('update');
      if (state?.recorded) return;
      await tx.insert(audiobookManifestRevisions).values({ bookId, revision, positionsKey }).onConflictDoNothing();
      await tx.update(bookMetadata).set({ manifestLegacyRecorded: true }).where(eq(bookMetadata.bookId, bookId));
    });
  }

  async findPositionsKey(bookId: number, revision: string): Promise<string | null> {
    const [row] = await this.db
      .select({ positionsKey: audiobookManifestRevisions.positionsKey })
      .from(audiobookManifestRevisions)
      .where(and(eq(audiobookManifestRevisions.bookId, bookId), eq(audiobookManifestRevisions.revision, revision)))
      .limit(1);
    return row?.positionsKey ?? null;
  }
}
