import { Injectable } from '@nestjs/common';
import type { BookMetadataFetchBreakdown, BookMetadataFetchPreviewBooks, BookMetadataFetchPreviewScope } from '@bookorbit/types';

import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { BookMetadataFetchQueueRepository } from './book-metadata-fetch-queue.repository';

const DEFAULT_PREVIEW_LIMIT = 12;

/** Read-only answers for the settings page: how a draft rule lands on a scope, and which books it takes. */
@Injectable()
export class BookMetadataFetchPreviewService {
  constructor(
    private readonly queueRepo: BookMetadataFetchQueueRepository,
    private readonly coverStore: BookCoverStore,
  ) {}

  breakdown(scope: BookMetadataFetchPreviewScope): Promise<BookMetadataFetchBreakdown> {
    return this.queueRepo.breakdown(scope.conditions, scope.libraryIds);
  }

  async previewBooks(scope: BookMetadataFetchPreviewScope, limit = DEFAULT_PREVIEW_LIMIT): Promise<BookMetadataFetchPreviewBooks> {
    const { items, total } = await this.queueRepo.previewBooks(scope.conditions, scope.libraryIds, limit);
    const faces = await this.coverStore.facesFor(items.map((item) => item.bookId));
    return {
      items: items.map((item) => {
        const face = faces.get(item.bookId);
        return { ...item, coverAspectRatio: face?.coverAspectRatio ?? null, coverVersion: face?.coverVersion ?? null };
      }),
      total,
    };
  }
}
