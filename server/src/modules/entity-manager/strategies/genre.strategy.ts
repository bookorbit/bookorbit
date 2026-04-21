import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { bookGenres, genres } from '../../../db/schema';
import { JunctionEntityStrategy } from './junction-entity.strategy';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class GenreStrategy extends JunctionEntityStrategy {
  readonly entityType = 'genre' as const;
  protected readonly entityTable = genres;
  protected readonly junctionTable = bookGenres;
  protected readonly entityIdCol = genres.id;
  protected readonly junctionEntityIdCol = bookGenres.genreId;
  protected readonly junctionBookIdCol = bookGenres.bookId;
  protected readonly nameCol = genres.name;
  protected readonly rawTableName = 'genres';
  protected readonly rawJunctionTable = 'book_genres';
  protected readonly rawEntityIdCol = 'genre_id';
  protected readonly hasCascade = true;

  constructor(@Inject(DB) db: Db) {
    super(db);
  }

  protected buildJunctionRow(bookId: number, entityId: number) {
    return { bookId, genreId: entityId };
  }
}
