import { FileEventProcessorService } from './file-event-processor.service';
import { ScannerRepository } from './scanner.repository';

const mockRepo: jest.Mocked<
  Pick<
    ScannerRepository,
    | 'findBookFileByAbsolutePath'
    | 'deleteBookFile'
    | 'countBookFilesByBookId'
    | 'markBooksAsMissing'
    | 'findBooksByFolderPath'
    | 'deleteBookFilesByBookIds'
  >
> = {
  findBookFileByAbsolutePath: jest.fn(),
  deleteBookFile: jest.fn(),
  countBookFilesByBookId: jest.fn(),
  markBooksAsMissing: jest.fn(),
  findBooksByFolderPath: jest.fn(),
  deleteBookFilesByBookIds: jest.fn(),
};

function makeService() {
  return new FileEventProcessorService(mockRepo as unknown as ScannerRepository);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.deleteBookFile.mockResolvedValue(undefined);
  mockRepo.markBooksAsMissing.mockResolvedValue(undefined);
  mockRepo.deleteBookFilesByBookIds.mockResolvedValue(undefined);
});

// ── handleUnlink ──────────────────────────────────────────────────────────────

describe('handleUnlink', () => {
  it('returns noop when path is not tracked in DB', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue(null);

    const result = await makeService().handleUnlink('/untracked/file.epub');

    expect(result).toEqual({ type: 'noop' });
    expect(mockRepo.deleteBookFile).not.toHaveBeenCalled();
  });

  it('returns file-removed when other files remain for the book', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 42, bookId: 7 },
      libraryId: 3,
    } as any);
    mockRepo.countBookFilesByBookId.mockResolvedValue(2); // 2 files remain after deletion

    const result = await makeService().handleUnlink('/books/Author/book.mobi');

    expect(mockRepo.deleteBookFile).toHaveBeenCalledWith(42);
    expect(mockRepo.markBooksAsMissing).not.toHaveBeenCalled();
    expect(result).toEqual({ type: 'file-removed', libraryId: 3, bookId: 7, fileId: 42 });
  });

  it('returns book-missing and marks book when last file is deleted', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 99, bookId: 12 },
      libraryId: 5,
    } as any);
    mockRepo.countBookFilesByBookId.mockResolvedValue(0);

    const result = await makeService().handleUnlink('/books/Solo/solo.epub');

    expect(mockRepo.deleteBookFile).toHaveBeenCalledWith(99);
    expect(mockRepo.markBooksAsMissing).toHaveBeenCalledWith([12]);
    expect(result).toEqual({ type: 'book-missing', libraryId: 5, bookIds: [12] });
  });
});

// ── handleUnlinkDir ───────────────────────────────────────────────────────────

describe('handleUnlinkDir', () => {
  it('returns noop when no books are under the deleted folder', async () => {
    mockRepo.findBooksByFolderPath.mockResolvedValue([]);

    const result = await makeService().handleUnlinkDir('/empty/folder');

    expect(result).toEqual({ type: 'noop' });
    expect(mockRepo.deleteBookFilesByBookIds).not.toHaveBeenCalled();
    expect(mockRepo.markBooksAsMissing).not.toHaveBeenCalled();
  });

  it('returns book-missing for a single-book folder', async () => {
    mockRepo.findBooksByFolderPath.mockResolvedValue([{ id: 20, libraryId: 1 }] as any);

    const result = await makeService().handleUnlinkDir('/books/Author/One Book');

    expect(mockRepo.deleteBookFilesByBookIds).toHaveBeenCalledWith([20]);
    expect(mockRepo.markBooksAsMissing).toHaveBeenCalledWith([20]);
    expect(result).toEqual({ type: 'book-missing', libraryId: 1, bookIds: [20] });
  });

  it('returns book-missing for all books under a parent folder', async () => {
    mockRepo.findBooksByFolderPath.mockResolvedValue([
      { id: 30, libraryId: 2 },
      { id: 31, libraryId: 2 },
    ] as any);

    const result = await makeService().handleUnlinkDir('/books/Series');

    expect(mockRepo.deleteBookFilesByBookIds).toHaveBeenCalledWith([30, 31]);
    expect(mockRepo.markBooksAsMissing).toHaveBeenCalledWith([30, 31]);
    expect(result).toEqual({ type: 'book-missing', libraryId: 2, bookIds: [30, 31] });
  });
});
