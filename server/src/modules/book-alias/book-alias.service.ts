import { Injectable } from '@nestjs/common';

import { BookAliasRepository } from './book-alias.repository';

/** Book ids are int4 serials; anything outside that range cannot be a merged-away id. */
const MAX_BOOK_ID = 2_147_483_647;

function isBookIdCandidate(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_BOOK_ID;
}

@Injectable()
export class BookAliasService {
  constructor(private readonly repository: BookAliasRepository) {}

  /** Maps each merged-away id to the book it was merged into; ids that were never merged are left out. */
  async resolve(ids: number[]): Promise<Map<number, number>> {
    const candidates = ids.filter(isBookIdCandidate);
    if (candidates.length === 0) return new Map();
    return this.repository.resolve(candidates);
  }

  /** The book a merged-away id now lives in, or null when the id was never merged. */
  async resolveOne(id: number): Promise<number | null> {
    const resolved = await this.resolve([id]);
    return resolved.get(id) ?? null;
  }
}
