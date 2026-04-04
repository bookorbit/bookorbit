import type { BookBucketMetadata } from '@projectx/types';
import { BookBucketFinalizeService } from './book-bucket-finalize.service';

function makeService() {
  const repo = {
    findById: vi.fn(),
    countsByStatus: vi.fn(),
  };
  const appSettings = {
    getAutoFinalizeSettings: vi.fn(),
  };
  const events = {
    on: vi.fn(),
  };
  const gateway = {
    emitSummary: vi.fn(),
  };

  const service = new BookBucketFinalizeService(
    {} as never,
    repo as never,
    {} as never,
    appSettings as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    events as never,
    gateway as never,
  );

  return { service, repo, appSettings };
}

function makeRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 1,
    fileName: 'book.epub',
    absolutePath: '/tmp/book.epub',
    fileSize: 100,
    format: 'epub',
    status: 'ready',
    embeddedMetadata: { title: 'Embedded Title', genres: ['Embedded Genre'] } as BookBucketMetadata,
    selectedMetadata: null as BookBucketMetadata | null,
    fetchedMetadata: null as BookBucketMetadata | null,
    coverPath: null,
    targetLibraryId: null,
    targetFolderId: null,
    confidence: 90,
    fetchedMetadataSources: null,
    errorMessage: null,
    metadataEditedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('BookBucketFinalizeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('triggerAutoFinalize', () => {
    it('merges embedded and fetched metadata when auto-finalizing and selected metadata is empty', async () => {
      const { service, repo, appSettings } = makeService();
      const fetched = { title: 'Fetched Title', authors: ['Fetched Author'] } as BookBucketMetadata;
      const row = makeRow({ selectedMetadata: null, fetchedMetadata: fetched });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'safe_merge',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookBucketMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Fetched Title',
        authors: ['Fetched Author'],
        genres: ['Embedded Genre'],
      });
    });

    it('lets selected metadata override fetched and embedded values during auto-finalize', async () => {
      const { service, repo, appSettings } = makeService();
      const manual = { title: 'Manual Title' } as BookBucketMetadata;
      const fetched = { title: 'Fetched Title', authors: ['Fetched Author'] } as BookBucketMetadata;
      const row = makeRow({ selectedMetadata: manual, fetchedMetadata: fetched });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'safe_merge',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookBucketMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Manual Title',
        authors: ['Fetched Author'],
        genres: ['Embedded Genre'],
      });
    });

    it('uses fetched metadata only (plus manual selection) in fetched_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const manual = { title: 'Manual Title' } as BookBucketMetadata;
      const fetched = { authors: ['Fetched Author'] } as BookBucketMetadata;
      const row = makeRow({ selectedMetadata: manual, fetchedMetadata: fetched });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'fetched_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookBucketMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Manual Title',
        authors: ['Fetched Author'],
      });
    });

    it('uses embedded metadata only (plus manual selection) in embedded_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const row = makeRow({
        selectedMetadata: null,
        fetchedMetadata: { title: 'Fetched Title', authors: ['Fetched Author'] } as BookBucketMetadata,
      });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'embedded_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookBucketMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Embedded Title',
        genres: ['Embedded Genre'],
      });
    });

    it('ignores confidence threshold in embedded_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const row = makeRow({ confidence: null });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'embedded_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
    });

    it('still requires confidence threshold in fetched_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const row = makeRow({ confidence: null, fetchedMetadata: { title: 'Fetched Title' } as BookBucketMetadata });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'fetched_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).not.toHaveBeenCalled();
    });
  });
});
