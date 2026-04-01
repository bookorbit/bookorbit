import { NotFoundException } from '@nestjs/common';

import { EmailFileSelector } from './email-file-selector';
import { EmailBookReadRepository } from './email-book-read.repository';

describe('EmailFileSelector', () => {
  let selector: EmailFileSelector;
  let repo: {
    findFileForBook: ReturnType<typeof vi.fn>;
    findFilesByBookId: ReturnType<typeof vi.fn>;
    findBookPrimaryFileId: ReturnType<typeof vi.fn>;
  };

  const mockFile = { id: 100, bookId: 1, format: 'EPUB', role: 'primary' };
  const mockFile2 = { id: 101, bookId: 1, format: 'PDF', role: 'secondary' };

  beforeEach(() => {
    repo = {
      findFileForBook: vi.fn(),
      findFilesByBookId: vi.fn(),
      findBookPrimaryFileId: vi.fn(),
    };
    selector = new EmailFileSelector(repo as unknown as EmailBookReadRepository);
  });

  it('should select by fileId if provided', async () => {
    repo.findFileForBook.mockResolvedValue(mockFile);
    const result = await selector.select(1, 100, null);
    expect(result).toEqual(mockFile);
    expect(repo.findFileForBook).toHaveBeenCalledWith(1, 100);
  });

  it('should throw NotFoundException if specific fileId not found', async () => {
    repo.findFileForBook.mockResolvedValue(null);
    await expect(selector.select(1, 999, null)).rejects.toThrow(NotFoundException);
  });

  it('should select preferred format if available', async () => {
    repo.findFilesByBookId.mockResolvedValue([mockFile, mockFile2]);
    const result = await selector.select(1, null, 'pdf');
    expect(result).toEqual(mockFile2);
  });

  it('should fallback to primary if preferred format not found', async () => {
    repo.findFilesByBookId.mockResolvedValue([mockFile, mockFile2]);
    repo.findBookPrimaryFileId.mockResolvedValue(100);
    const result = await selector.select(1, null, 'mobi');
    expect(result).toEqual(mockFile);
  });

  it('should fallback to first file when primary file is missing', async () => {
    repo.findFilesByBookId.mockResolvedValue([mockFile, mockFile2]);
    repo.findBookPrimaryFileId.mockResolvedValue(404);

    const result = await selector.select(1, null, 'mobi');

    expect(result).toEqual(mockFile);
  });

  it('should throw if no files found for book', async () => {
    repo.findFilesByBookId.mockResolvedValue([]);
    await expect(selector.select(1, null, null)).rejects.toThrow(NotFoundException);
  });
});
