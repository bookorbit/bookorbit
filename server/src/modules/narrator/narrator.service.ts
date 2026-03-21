import { Injectable } from '@nestjs/common';

import { NarratorRepository } from './narrator.repository';

@Injectable()
export class NarratorService {
  constructor(private readonly narratorRepo: NarratorRepository) {}

  async replaceForBook(bookId: number, names: string[] | { name: string; sortName: string | null }[]): Promise<void> {
    const normalized =
      names.length > 0 && typeof names[0] !== 'string'
        ? (names as { name: string; sortName: string | null }[])
        : (names as string[]).map((name) => ({ name, sortName: null }));

    await this.narratorRepo.replaceForBook(bookId, normalized);
  }
}
