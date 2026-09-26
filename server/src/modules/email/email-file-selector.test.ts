import { NotFoundException } from '@nestjs/common';

import { EmailFileSelector } from './email-file-selector';
import { EmailBookReadRepository } from './email-book-read.repository';

describe('EmailFileSelector', () => {
  let selector: EmailFileSelector;
  let repo: {
    findFileForBook: ReturnType<typeof vi.fn>;
    findFilesByBookId: ReturnType<typeof vi.fn>;
    findBookPrimaryFileId: ReturnType<typeof vi.fn>;
    findLibraryFormatPriority: ReturnType<typeof vi.fn>;
  };

  const epub = { id: 100, bookId: 1, format: 'epub', role: 'content', sizeBytes: 10, mediaOverlayAvailable: false };
  const pdf = { id: 101, bookId: 1, format: 'pdf', role: 'content', sizeBytes: 10, mediaOverlayAvailable: false };
  const readAlong = { id: 102, bookId: 1, format: 'epub', role: 'content', sizeBytes: 10, mediaOverlayAvailable: true };
  const audiobook = { id: 103, bookId: 1, format: 'm4b', role: 'content', sizeBytes: 10, mediaOverlayAvailable: false };
  const cover = { id: 104, bookId: 1, format: 'jpg', role: 'cover', sizeBytes: 10, mediaOverlayAvailable: false };

  beforeEach(() => {
    repo = {
      findFileForBook: vi.fn(),
      findFilesByBookId: vi.fn(),
      findBookPrimaryFileId: vi.fn().mockResolvedValue(null),
      findLibraryFormatPriority: vi.fn().mockResolvedValue(null),
    };
    selector = new EmailFileSelector(repo as unknown as EmailBookReadRepository);
  });

  it('selects by fileId if provided', async () => {
    repo.findFileForBook.mockResolvedValue(epub);
    await expect(selector.select(1, 100, null)).resolves.toEqual(epub);
    expect(repo.findFileForBook).toHaveBeenCalledWith(1, 100);
  });

  it('rejects a fileId that is missing or not a sendable edition', async () => {
    repo.findFileForBook.mockResolvedValue(null);
    await expect(selector.select(1, 999, null)).rejects.toThrow(NotFoundException);
    repo.findFileForBook.mockResolvedValue(cover);
    await expect(selector.select(1, 104, null)).rejects.toThrow(NotFoundException);
    repo.findFileForBook.mockResolvedValue(audiobook);
    await expect(selector.select(1, 103, null)).rejects.toThrow(NotFoundException);
  });

  it('selects the preferred format when the book has it', async () => {
    repo.findFilesByBookId.mockResolvedValue([epub, pdf]);
    await expect(selector.select(1, null, 'PDF')).resolves.toEqual(pdf);
  });

  it('prefers the plain EPUB over a read-along copy for an EPUB recipient', async () => {
    repo.findFilesByBookId.mockResolvedValue([readAlong, epub]);
    repo.findBookPrimaryFileId.mockResolvedValue(102);
    await expect(selector.select(1, null, 'epub')).resolves.toEqual(epub);
  });

  it('falls back to the primary when the preferred format is absent', async () => {
    repo.findFilesByBookId.mockResolvedValue([epub, pdf]);
    repo.findBookPrimaryFileId.mockResolvedValue(101);
    await expect(selector.select(1, null, 'mobi')).resolves.toEqual(pdf);
  });

  it('never sends an audiobook or a cover, even when the audiobook is primary', async () => {
    repo.findFilesByBookId.mockResolvedValue([cover, audiobook, epub]);
    repo.findBookPrimaryFileId.mockResolvedValue(103);
    await expect(selector.select(1, null, null)).resolves.toEqual(epub);
  });

  it('ranks the fallback by the library format priority', async () => {
    repo.findFilesByBookId.mockResolvedValue([epub, pdf]);
    repo.findLibraryFormatPriority.mockResolvedValue(['pdf', 'epub']);
    await expect(selector.select(1, null, null)).resolves.toEqual(pdf);
  });

  it('throws when the book has no files or nothing sendable', async () => {
    repo.findFilesByBookId.mockResolvedValue([]);
    await expect(selector.select(1, null, null)).rejects.toThrow(NotFoundException);
    repo.findFilesByBookId.mockResolvedValue([audiobook, cover]);
    await expect(selector.select(1, null, null)).rejects.toThrow(NotFoundException);
  });
});
