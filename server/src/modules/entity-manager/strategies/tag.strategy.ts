import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { bookTags, tags } from '../../../db/schema';
import { JunctionEntityStrategy } from './junction-entity.strategy';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class TagStrategy extends JunctionEntityStrategy {
  readonly entityType = 'tag' as const;
  protected readonly entityTable = tags;
  protected readonly junctionTable = bookTags;
  protected readonly entityIdCol = tags.id;
  protected readonly junctionEntityIdCol = bookTags.tagId;
  protected readonly junctionBookIdCol = bookTags.bookId;
  protected readonly nameCol = tags.name;
  protected readonly rawTableName = 'tags';
  protected readonly rawJunctionTable = 'book_tags';
  protected readonly rawEntityIdCol = 'tag_id';
  protected readonly hasCascade = true;

  constructor(@Inject(DB) db: Db) {
    super(db);
  }

  protected buildJunctionRow(bookId: number, entityId: number) {
    return { bookId, tagId: entityId };
  }
}
