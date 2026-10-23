import type { BookMetadataFetchConditions } from '@bookorbit/types';

import { BookMetadataFetchPreviewService } from './book-metadata-fetch-preview.service';

const conditions: BookMetadataFetchConditions = {
  neverFetched: { enabled: true },
  scoreThreshold: { enabled: true, threshold: 60 },
  missingFields: { enabled: true, fields: ['description'] },
};

function makeService() {
  const queueRepo = { breakdown: vi.fn(), previewBooks: vi.fn() };
  const coverStore = { facesFor: vi.fn() };
  return { queueRepo, coverStore, service: new BookMetadataFetchPreviewService(queueRepo as never, coverStore as never) };
}

describe('BookMetadataFetchPreviewService', () => {
  it('passes the scope straight to the breakdown query', async () => {
    const { service, queueRepo } = makeService();
    queueRepo.breakdown.mockResolvedValue({ total: 4 });

    await expect(service.breakdown({ conditions, libraryIds: [2] })).resolves.toEqual({ total: 4 });
    expect(queueRepo.breakdown).toHaveBeenCalledWith(conditions, [2]);
  });

  it("adds each book's cover face and defaults the limit to twelve", async () => {
    const { service, queueRepo, coverStore } = makeService();
    const row = {
      bookId: 7,
      libraryId: 2,
      title: 'Hex',
      author: null,
      metadataScore: 41,
      neverFetched: true,
      hasCover: true,
      missingFields: ['description'],
    };
    queueRepo.previewBooks.mockResolvedValue({ items: [row, { ...row, bookId: 8 }], total: 30 });
    coverStore.facesFor.mockResolvedValue(new Map([[7, { coverAspectRatio: '2/3', coverVersion: 'ebook:1' }]]));

    const result = await service.previewBooks({ conditions });

    expect(queueRepo.previewBooks).toHaveBeenCalledWith(conditions, undefined, 12);
    expect(coverStore.facesFor).toHaveBeenCalledWith([7, 8]);
    expect(result.total).toBe(30);
    expect(result.items[0]).toMatchObject({ bookId: 7, coverAspectRatio: '2/3', coverVersion: 'ebook:1' });
    expect(result.items[1]).toMatchObject({ bookId: 8, coverAspectRatio: null, coverVersion: null });
  });
});
