import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { ComicMetadataDto } from '../book/dto/update-book-metadata.dto';

type Db = NodePgDatabase<typeof schema>;
type ComicMetadataExecutor = Pick<Db, 'insert'>;

@Injectable()
export class ComicMetadataRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async upsert(bookId: number, fields: ComicMetadataDto, executor: ComicMetadataExecutor = this.db): Promise<void> {
    await executor
      .insert(schema.comicMetadata)
      .values({
        bookId,
        issueNumber: fields.issueNumber,
        volumeName: fields.volumeName,
        pencillers: fields.pencillers,
        inkers: fields.inkers,
        colorists: fields.colorists,
        letterers: fields.letterers,
        coverArtists: fields.coverArtists,
        characters: fields.characters,
        teams: fields.teams,
        locations: fields.locations,
        storyArcs: fields.storyArcs,
      })
      .onConflictDoUpdate({
        target: schema.comicMetadata.bookId,
        set: {
          issueNumber: fields.issueNumber,
          volumeName: fields.volumeName,
          pencillers: fields.pencillers,
          inkers: fields.inkers,
          colorists: fields.colorists,
          letterers: fields.letterers,
          coverArtists: fields.coverArtists,
          characters: fields.characters,
          teams: fields.teams,
          locations: fields.locations,
          storyArcs: fields.storyArcs,
          updatedAt: new Date(),
        },
      });
  }

  async findByBookId(bookId: number): Promise<schema.ComicMetadata | null> {
    return (
      (await this.db.query.comicMetadata.findFirst({
        where: eq(schema.comicMetadata.bookId, bookId),
      })) ?? null
    );
  }
}
