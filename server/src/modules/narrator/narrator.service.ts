import { Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '../../db/schema';
import { NarratorRepository } from './narrator.repository';

type Db = NodePgDatabase<typeof schema>;
type NarratorMutationExecutor = Pick<Db, 'delete' | 'insert' | 'select'>;

@Injectable()
export class NarratorService {
  constructor(private readonly narratorRepo: NarratorRepository) {}

  async replaceForBook(
    bookId: number,
    names: string[] | { name: string; sortName: string | null }[],
    options: { executor?: NarratorMutationExecutor } = {},
  ): Promise<void> {
    const normalized =
      names.length > 0 && typeof names[0] !== 'string'
        ? (names as { name: string; sortName: string | null }[])
        : (names as string[]).map((name) => ({ name, sortName: null }));

    if (options.executor) {
      await this.narratorRepo.replaceForBook(bookId, normalized, options.executor);
      return;
    }
    await this.narratorRepo.replaceForBook(bookId, normalized);
  }
}
