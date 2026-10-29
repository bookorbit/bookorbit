import { ConflictException } from '@nestjs/common';
import type { AudiobookChapter } from '@bookorbit/types';
import { and, eq, desc, notInArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import {
  computeAudiobookManifestRevision,
  computeAudiobookPositionsKey,
  normalizeAudiobookChapters,
  orderAudiobookTracks,
  resolveStoredAudiobookChapters,
} from '../common/utils/audiobook-chapters.utils';

type Executor = Pick<NodePgDatabase<typeof schema>, 'select' | 'insert' | 'update' | 'delete'>;

/** Must be called in the transaction that writes chapters. The metadata row stays locked until commit. */
export async function preserveOutgoingChapters(
  executor: Executor,
  bookId: number,
  patch: Partial<typeof schema.bookMetadata.$inferInsert>,
  respectLocks: boolean,
): Promise<Partial<typeof schema.bookMetadata.$inferInsert>> {
  if (!Object.prototype.hasOwnProperty.call(patch, 'chapters')) return patch;
  await executor.insert(schema.bookMetadata).values({ bookId }).onConflictDoNothing();
  const [state] = await executor
    .select({
      chapters: schema.bookMetadata.chapters,
      source: schema.bookMetadata.chaptersSource,
      locked: schema.bookMetadata.lockedFields,
      recorded: schema.bookMetadata.manifestLegacyRecorded,
    })
    .from(schema.bookMetadata)
    .where(eq(schema.bookMetadata.bookId, bookId))
    .for('update');
  const next = { ...patch };
  if (state.locked.includes('chapters')) {
    if (!respectLocks) throw new ConflictException('Chapters are protected');
    delete next.chapters;
    delete next.chaptersSource;
    delete next.chaptersUpdatedAt;
    delete next.chaptersUpdatedBy;
    return next;
  }
  if (!state.recorded) {
    const files = await executor
      .select({
        id: schema.bookFiles.id,
        publicId: schema.bookFiles.publicId,
        absolutePath: schema.bookFiles.absolutePath,
        format: schema.bookFiles.format,
        durationSeconds: schema.bookFiles.durationSeconds,
        sortOrder: schema.bookFiles.sortOrder,
        sizeBytes: schema.bookFiles.sizeBytes,
        mtime: schema.bookFiles.mtime,
        updatedAt: schema.bookFiles.updatedAt,
      })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.bookId, bookId));
    const ordered = orderAudiobookTracks(files);
    if (ordered.length)
      await executor
        .insert(schema.audiobookManifestRevisions)
        .values({
          bookId,
          revision: computeAudiobookManifestRevision(
            ordered,
            resolveStoredAudiobookChapters(state.chapters as AudiobookChapter[] | null, files) ?? [],
          ),
          positionsKey: computeAudiobookPositionsKey(ordered),
        })
        .onConflictDoNothing();
  }
  next.manifestLegacyRecorded = true;
  const [version] = await executor
    .select({ id: schema.bookChapterVersions.id })
    .from(schema.bookChapterVersions)
    .where(eq(schema.bookChapterVersions.bookId, bookId))
    .limit(1);
  const versions: (typeof schema.bookChapterVersions.$inferInsert)[] = [];
  const previous = state.chapters as AudiobookChapter[] | null;
  if (!version && previous?.length)
    versions.push({ bookId, chapters: previous, chapterCount: previous.length, source: state.source ?? 'embedded', createdBy: null });
  const incoming = normalizeAudiobookChapters((next.chapters as AudiobookChapter[] | null) ?? []);
  if (incoming.length)
    versions.push({
      bookId,
      chapters: incoming,
      chapterCount: incoming.length,
      source: next.chaptersSource ?? 'manual',
      createdBy: next.chaptersUpdatedBy ?? null,
    });
  if (versions.length) {
    await executor.insert(schema.bookChapterVersions).values(versions);
    const kept = executor
      .select({ id: schema.bookChapterVersions.id })
      .from(schema.bookChapterVersions)
      .where(eq(schema.bookChapterVersions.bookId, bookId))
      .orderBy(desc(schema.bookChapterVersions.createdAt), desc(schema.bookChapterVersions.id))
      .limit(20);
    await executor
      .delete(schema.bookChapterVersions)
      .where(and(eq(schema.bookChapterVersions.bookId, bookId), notInArray(schema.bookChapterVersions.id, kept)));
  }
  return next;
}
