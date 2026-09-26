import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { CoverMedium } from '@bookorbit/types';

import { COVER_THUMBNAIL_FILE_NAME, bookCoverSlotDirPath } from '../../src/common/book-cover-storage';
import * as schema from '../../src/db/schema';

type SlotCoverContext = {
  db: NodePgDatabase<typeof schema>;
  fixture: { booksPath: string };
};

export type SlotCoverArtifactOptions = {
  medium?: CoverMedium;
  source?: 'custom' | 'extracted';
  coverExtension?: 'jpg' | 'png';
  coverContent?: Buffer;
  thumbnailContent?: Buffer;
};

/**
 * Lays a cover out the way the cover store does: the files in the slot's directory, the slot row,
 * and the `cover_source` summary beside it. The bytes need not be an image; the row leaves the
 * measured size empty, as the store does for anything it cannot read.
 */
export async function createSlotCoverArtifacts(ctx: SlotCoverContext, bookId: number, options: SlotCoverArtifactOptions = {}): Promise<void> {
  const medium = options.medium ?? 'ebook';
  const source = options.source ?? 'custom';
  const dir = bookCoverSlotDirPath(ctx.fixture.booksPath, bookId, medium);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `cover_${source}.${options.coverExtension ?? 'jpg'}`), options.coverContent ?? Buffer.from(`cover-${bookId}`, 'utf8'));
  await writeFile(join(dir, COVER_THUMBNAIL_FILE_NAME), options.thumbnailContent ?? Buffer.from(`thumbnail-${bookId}`, 'utf8'));

  const row = { source, origin: source === 'custom' ? 'upload' : 'embedded', width: null, height: null, updatedAt: new Date(), dormantSince: null };
  await ctx.db
    .insert(schema.bookCovers)
    .values({ bookId, medium, ...row })
    .onConflictDoUpdate({ target: [schema.bookCovers.bookId, schema.bookCovers.medium], set: row });
  await ctx.db
    .insert(schema.bookMetadata)
    .values({ bookId, coverSource: source })
    .onConflictDoUpdate({ target: schema.bookMetadata.bookId, set: { coverSource: source } });
}
