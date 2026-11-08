import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { LocateTextResponse } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { TextLocatorService } from '../position-converter/text-locator.service';

const LOCATABLE_FORMATS = new Set(['epub', 'kepub']);

@Injectable()
export class PageLocatorService {
  constructor(
    private readonly books: BookService,
    private readonly locator: TextLocatorService,
  ) {}

  async locateText(fileId: number, text: string, user: RequestUser): Promise<LocateTextResponse> {
    const file = await this.books.verifyFileAccess(fileId, user);
    if (!file.format || !LOCATABLE_FORMATS.has(file.format)) {
      throw new BadRequestException('Page text can only be located in EPUB files');
    }

    const outcome = await this.locator.locate(fileId, text);
    if (outcome.status === 'unavailable') throw new NotFoundException('The book file could not be read');
    if (outcome.status === 'no_match') return { match: null };

    return {
      match: {
        chapterIndex: outcome.chapterIndex,
        cfi: outcome.cfi,
        confidence: outcome.confidence,
        excerpt: outcome.excerpt,
      },
    };
  }
}
