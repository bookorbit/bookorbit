import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailTemplateContextService } from './email-template-context.service';
import { DB } from '../../db';

describe('EmailTemplateContextService', () => {
  let service: EmailTemplateContextService;
  let db: any;
  let config: ConfigService;

  beforeEach(async () => {
    db = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailTemplateContextService,
        { provide: DB, useValue: db },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost') } },
      ],
    }).compile();

    service = module.get<EmailTemplateContextService>(EmailTemplateContextService);
    config = module.get<ConfigService>(ConfigService);
  });

  it('should build context for a book', async () => {
    const mockBook = { id: 1 };
    const mockMeta = { title: 'Book Title', subtitle: 'Sub', seriesName: 'S', seriesIndex: 1 };
    const mockAuthors = [{ name: 'A1' }, { name: 'A2' }];
    const mockTags = [{ name: 'T1' }];
    const mockFile = { format: 'EPUB', sizeBytes: 1024 * 1024 };

    // Promise.all order: book, meta, authors, tags, file
    (db.limit as jest.Mock)
      .mockResolvedValueOnce([mockBook]) // book
      .mockResolvedValueOnce([mockMeta]) // meta
      .mockResolvedValueOnce([mockFile]); // file (because it's the last one with limit)

    // Authors and tags use orderBy or innerJoin and don't have limit
    (db.orderBy as jest.Mock).mockResolvedValueOnce(mockAuthors);
    (db.where as jest.Mock).mockImplementation(function (this: any) {
       if (db.where.mock.calls.length === 4) { // tags call
          return Promise.resolve(mockTags);
       }
       return this;
    });

    // Actually, it's cleaner to mock each stage
    db.limit = jest.fn()
      .mockResolvedValueOnce([mockBook])
      .mockResolvedValueOnce([mockMeta])
      .mockResolvedValueOnce([mockFile]);

    db.orderBy = jest.fn().mockResolvedValueOnce(mockAuthors);
    
    // For tags, it's select().from().innerJoin().where() -> no limit, no orderBy
    // We need to make where() return mockTags for the 4th call
    let callCount = 0;
    db.where = jest.fn().mockImplementation(function(this: any) {
      callCount++;
      if (callCount === 4) return Promise.resolve(mockTags);
      return this;
    });

    const context = await service.buildForBook(1, 100, 'Sender');

    expect(context.title).toBe('Book Title');
    expect(context.author).toBe('A1, A2');
    expect(context.tags).toBe('T1');
    expect(context.fileSize).toBe('1.0 MB');
    expect(context.coverUrl).toBe('http://localhost/api/books/1/cover');
  });

  it('should throw NotFoundException if book not found', async () => {
    db.limit = jest.fn().mockResolvedValueOnce([]); // book not found
    db.where = jest.fn().mockReturnThis();
    db.orderBy = jest.fn().mockReturnThis();

    await expect(service.buildForBook(1, null, 'Sender')).rejects.toThrow(NotFoundException);
  });
});
