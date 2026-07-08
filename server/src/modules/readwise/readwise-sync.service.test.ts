import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ReadwiseUnauthorizedError } from './readwise-client.service';
import { READWISE_BATCH_SIZE, READWISE_MAX } from './readwise.constants';
import { ReadwiseSyncService } from './readwise-sync.service';
import type { NewHighlightRow } from './readwise.repository';

const mockRepo = {
  findSettings: vi.fn(),
  userHasReadwiseSyncPermission: vi.fn(),
  findNewHighlights: vi.fn(),
  upsertSettings: vi.fn(),
};

const mockClient = {
  createHighlights: vi.fn(),
};

function makeService() {
  return new ReadwiseSyncService(mockRepo as any, mockClient as any, { appUrl: 'https://bookorbit.example/' } as any);
}

function makeRow(overrides: Partial<NewHighlightRow> = {}): NewHighlightRow {
  return {
    annotationId: 1,
    bookId: 10,
    text: 'a highlight',
    note: 'a note',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    title: 'A Book',
    author: 'An Author',
    isbn13: null,
    isbn10: null,
    ...overrides,
  };
}

function enabledSettings(overrides: Record<string, unknown> = {}) {
  return { apiToken: 'tok', enabled: true, lastSyncedAnnotationId: 0, ...overrides };
}

describe('ReadwiseSyncService', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) so any unconsumed mock*Once queue is dropped between tests.
    vi.resetAllMocks();
    mockRepo.userHasReadwiseSyncPermission.mockResolvedValue(true);
    mockClient.createHighlights.mockResolvedValue(undefined);
    mockRepo.upsertSettings.mockResolvedValue(undefined);
  });

  describe('flush guards', () => {
    it('skips when no settings row', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      await makeService().flush(1);
      expect(mockClient.createHighlights).not.toHaveBeenCalled();
      expect(mockRepo.findNewHighlights).not.toHaveBeenCalled();
    });

    it('skips when token missing', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings({ apiToken: null }));
      await makeService().flush(1);
      expect(mockClient.createHighlights).not.toHaveBeenCalled();
    });

    it('skips when enabled=false', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings({ enabled: false }));
      await makeService().flush(1);
      expect(mockClient.createHighlights).not.toHaveBeenCalled();
    });

    it('skips when no permission', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      mockRepo.userHasReadwiseSyncPermission.mockResolvedValue(false);
      await makeService().flush(1);
      expect(mockClient.createHighlights).not.toHaveBeenCalled();
      expect(mockRepo.findNewHighlights).not.toHaveBeenCalled();
    });
  });

  describe('highlight mapping', () => {
    it('maps a row to a ReadwiseHighlight with fixed source_type/category and ISO highlighted_at', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      mockRepo.findNewHighlights.mockResolvedValueOnce([makeRow({ annotationId: 5 })]).mockResolvedValueOnce([]);
      await makeService().flush(1);
      const [, , payload] = mockClient.createHighlights.mock.calls[0];
      expect(payload[0]).toEqual({
        text: 'a highlight',
        title: 'A Book',
        author: 'An Author',
        note: 'a note',
        highlighted_at: '2026-01-02T03:04:05.000Z',
        highlight_url: 'https://bookorbit.example/book/10?tab=highlights&annotationId=5',
        source_type: 'bookorbit',
        category: 'books',
      });
    });

    it('truncates text/title/author/note to their max lengths', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      const row = makeRow({
        annotationId: 5,
        text: 'x'.repeat(READWISE_MAX.TEXT + 100),
        title: 't'.repeat(READWISE_MAX.TITLE + 100),
        author: 'a'.repeat(READWISE_MAX.AUTHOR + 100),
        note: 'n'.repeat(READWISE_MAX.NOTE + 100),
      });
      mockRepo.findNewHighlights.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
      await makeService().flush(1);
      const h = mockClient.createHighlights.mock.calls[0][2][0];
      expect(h.text.length).toBe(READWISE_MAX.TEXT);
      expect(h.title.length).toBe(READWISE_MAX.TITLE);
      expect(h.author.length).toBe(READWISE_MAX.AUTHOR);
      expect(h.note.length).toBe(READWISE_MAX.NOTE);
    });

    it('omits note when null and omits title/author when empty', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      mockRepo.findNewHighlights.mockResolvedValueOnce([makeRow({ annotationId: 5, note: null, title: null, author: '' })]).mockResolvedValueOnce([]);
      await makeService().flush(1);
      const h = mockClient.createHighlights.mock.calls[0][2][0];
      expect('note' in h).toBe(false);
      expect('title' in h).toBe(false);
      expect('author' in h).toBe(false);
    });

    it('sets image_url from the OpenLibrary cover for isbn13', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      mockRepo.findNewHighlights.mockResolvedValueOnce([makeRow({ annotationId: 5, isbn13: '9781234567897' })]).mockResolvedValueOnce([]);
      await makeService().flush(1);
      const h = mockClient.createHighlights.mock.calls[0][2][0];
      expect(h.image_url).toBe('https://covers.openlibrary.org/b/isbn/9781234567897-L.jpg?default=false');
    });

    it('falls back to isbn10 when isbn13 is absent', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      mockRepo.findNewHighlights.mockResolvedValueOnce([makeRow({ annotationId: 5, isbn13: null, isbn10: '1234567890' })]).mockResolvedValueOnce([]);
      await makeService().flush(1);
      const h = mockClient.createHighlights.mock.calls[0][2][0];
      expect(h.image_url).toBe('https://covers.openlibrary.org/b/isbn/1234567890-L.jpg?default=false');
    });

    it('omits image_url when the book has no ISBN', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      mockRepo.findNewHighlights.mockResolvedValueOnce([makeRow({ annotationId: 5, isbn13: null, isbn10: null })]).mockResolvedValueOnce([]);
      await makeService().flush(1);
      const h = mockClient.createHighlights.mock.calls[0][2][0];
      expect('image_url' in h).toBe(false);
    });
  });

  describe('watermark', () => {
    it('advances the watermark to the max annotationId of a confirmed batch', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      mockRepo.findNewHighlights.mockResolvedValueOnce([makeRow({ annotationId: 3 }), makeRow({ annotationId: 7 })]).mockResolvedValueOnce([]);
      await makeService().flush(1);
      expect(mockRepo.upsertSettings).toHaveBeenCalledTimes(1);
      const data = mockRepo.upsertSettings.mock.calls[0][1];
      expect(data.lastSyncedAnnotationId).toBe(7);
      expect(data.lastSyncedAt).toBeInstanceOf(Date);
    });

    it('loops again on a full batch, stops on a partial batch', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      const fullBatch = Array.from({ length: READWISE_BATCH_SIZE }, (_, i) => makeRow({ annotationId: i + 1 }));
      mockRepo.findNewHighlights.mockResolvedValueOnce(fullBatch).mockResolvedValueOnce([makeRow({ annotationId: READWISE_BATCH_SIZE + 5 })]);
      await makeService().flush(1);

      expect(mockRepo.findNewHighlights).toHaveBeenCalledTimes(2);
      // Second fetch uses the watermark advanced from the first full batch.
      expect(mockRepo.findNewHighlights.mock.calls[1][1]).toBe(READWISE_BATCH_SIZE);
      expect(mockClient.createHighlights).toHaveBeenCalledTimes(2);
      expect(mockRepo.upsertSettings).toHaveBeenCalledTimes(2);
      expect(mockRepo.upsertSettings.mock.calls[1][1].lastSyncedAnnotationId).toBe(READWISE_BATCH_SIZE + 5);
    });

    it('stops when the first fetch returns an empty batch (nothing to sync)', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      mockRepo.findNewHighlights.mockResolvedValueOnce([]);
      await makeService().flush(1);
      expect(mockClient.createHighlights).not.toHaveBeenCalled();
      expect(mockRepo.upsertSettings).not.toHaveBeenCalled();
    });
  });

  describe('failure handling', () => {
    it('does not advance the watermark and propagates a generic push error for retry', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      mockRepo.findNewHighlights.mockResolvedValueOnce([makeRow({ annotationId: 9 })]);
      mockClient.createHighlights.mockRejectedValueOnce(new Error('boom'));
      await expect(makeService().flush(1)).rejects.toThrow('boom');
      expect(mockRepo.upsertSettings).not.toHaveBeenCalled();
      expect(mockRepo.findNewHighlights).toHaveBeenCalledTimes(1);
    });

    it('auto-disables on ReadwiseUnauthorizedError and does not advance watermark', async () => {
      mockRepo.findSettings.mockResolvedValue(enabledSettings());
      mockRepo.findNewHighlights.mockResolvedValueOnce([makeRow({ annotationId: 9 })]);
      mockClient.createHighlights.mockRejectedValueOnce(new ReadwiseUnauthorizedError());
      await makeService().flush(1);
      expect(mockRepo.upsertSettings).toHaveBeenCalledTimes(1);
      expect(mockRepo.upsertSettings).toHaveBeenCalledWith(1, { disabledReason: 'invalid_token', enabled: false });
      // no watermark advance
      const calledWithWatermark = mockRepo.upsertSettings.mock.calls.some((c) => 'lastSyncedAnnotationId' in c[1]);
      expect(calledWithWatermark).toBe(false);
    });
  });
});
