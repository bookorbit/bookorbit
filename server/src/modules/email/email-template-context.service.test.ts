import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { EmailTemplateContextService } from './email-template-context.service';
import { EmailBookReadRepository } from './email-book-read.repository';

describe('EmailTemplateContextService', () => {
  let service: EmailTemplateContextService;
  let repo: {
    findBookById: ReturnType<typeof vi.fn>;
    findMetadataByBookId: ReturnType<typeof vi.fn>;
    findAuthorNamesByBookId: ReturnType<typeof vi.fn>;
    findTagNamesByBookId: ReturnType<typeof vi.fn>;
    findFileById: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    repo = {
      findBookById: vi.fn(),
      findMetadataByBookId: vi.fn(),
      findAuthorNamesByBookId: vi.fn(),
      findTagNamesByBookId: vi.fn(),
      findFileById: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailTemplateContextService,
        { provide: EmailBookReadRepository, useValue: repo },
        { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue('http://localhost') } },
      ],
    }).compile();

    service = module.get<EmailTemplateContextService>(EmailTemplateContextService);
  });

  it('should build context for a book', async () => {
    const mockBook = { id: 1, primaryFileId: 100 };
    const mockMeta = { title: 'Book Title', subtitle: 'Sub', seriesName: 'S', seriesIndex: 1 };
    const mockAuthors = [{ name: 'A1' }, { name: 'A2' }];
    const mockTags = [{ name: 'T1' }];
    const mockFile = { id: 100, bookId: 1, format: 'EPUB', sizeBytes: 1024 * 1024 };
    repo.findBookById.mockResolvedValue(mockBook);
    repo.findMetadataByBookId.mockResolvedValue(mockMeta);
    repo.findAuthorNamesByBookId.mockResolvedValue(mockAuthors);
    repo.findTagNamesByBookId.mockResolvedValue(mockTags);
    repo.findFileById.mockResolvedValue(mockFile);

    const context = await service.buildForBook(1, 100, 'Sender');

    expect(context.title).toBe('Book Title');
    expect(context.author).toBe('A1, A2');
    expect(context.tags).toBe('T1');
    expect(context.fileSize).toBe('1.0 MB');
    expect(context.coverUrl).toBe('http://localhost/api/books/1/cover');
  });

  it('should throw NotFoundException if book not found', async () => {
    repo.findBookById.mockResolvedValue(null);
    repo.findMetadataByBookId.mockResolvedValue(null);
    repo.findAuthorNamesByBookId.mockResolvedValue([]);
    repo.findTagNamesByBookId.mockResolvedValue([]);

    await expect(service.buildForBook(1, null, 'Sender')).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException if file does not belong to the book', async () => {
    repo.findBookById.mockResolvedValue({ id: 1 });
    repo.findMetadataByBookId.mockResolvedValue(null);
    repo.findAuthorNamesByBookId.mockResolvedValue([]);
    repo.findTagNamesByBookId.mockResolvedValue([]);
    repo.findFileById.mockResolvedValue({ id: 200, bookId: 2, format: 'PDF' });

    await expect(service.buildForBook(1, 200, 'Sender')).rejects.toThrow(NotFoundException);
  });
});
