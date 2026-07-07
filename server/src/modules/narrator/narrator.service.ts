import { Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '../../db/schema';
import { normalizeMetadataText, normalizeMetadataTextKey } from '../../common/utils/metadata-text-normalize.utils';
import { NarratorRepository } from './narrator.repository';

type Db = NodePgDatabase<typeof schema>;
type NarratorMutationExecutor = Pick<Db, 'delete' | 'insert' | 'select' | 'update'>;

@Injectable()
export class NarratorService {
  constructor(private readonly narratorRepo: NarratorRepository) {}

  async replaceForBook(
    bookId: number,
    names: string[] | { name: string; sortName: string | null }[],
    options: { executor?: NarratorMutationExecutor } = {},
  ): Promise<void> {
    const input =
      names.length > 0 && typeof names[0] !== 'string'
        ? (names as { name: string; sortName: string | null }[])
        : (names as string[]).map((name) => ({ name, sortName: null }));
    const normalized = this.normalizeNarratorNames(input);

    if (options.executor) {
      await this.narratorRepo.replaceForBook(bookId, normalized, options.executor);
      return;
    }
    await this.narratorRepo.replaceForBook(bookId, normalized);
  }

  private normalizeNarratorNames(names: { name: string; sortName: string | null }[]): { name: string; sortName: string | null }[] {
    const normalized: { name: string; sortName: string | null }[] = [];
    const seen = new Set<string>();
    for (const narrator of names) {
      const name = normalizeMetadataText(narrator.name);
      const key = normalizeMetadataTextKey(name);
      if (!name || !key || seen.has(key)) continue;
      seen.add(key);
      normalized.push({ name, sortName: normalizeMetadataText(narrator.sortName) });
    }
    return normalized;
  }
}
