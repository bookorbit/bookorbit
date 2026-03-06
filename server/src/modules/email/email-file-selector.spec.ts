import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailFileSelector } from './email-file-selector';
import { DB } from '../../db';

describe('EmailFileSelector', () => {
  let selector: EmailFileSelector;
  let db: any;

  const mockFile = { id: 100, bookId: 1, format: 'EPUB', role: 'primary' };
  const mockFile2 = { id: 101, bookId: 1, format: 'PDF', role: 'secondary' };

  beforeEach(async () => {
    db = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailFileSelector,
        { provide: DB, useValue: db },
      ],
    }).compile();

    selector = module.get<EmailFileSelector>(EmailFileSelector);
  });

  it('should select by fileId if provided', async () => {
    db.where.mockReturnValue({
      limit: jest.fn().mockResolvedValue([mockFile]),
    });

    const result = await selector.select(1, 100, null);
    expect(result).toEqual(mockFile);
    expect(db.select).toHaveBeenCalled();
  });

  it('should throw NotFoundException if specific fileId not found', async () => {
    db.where.mockReturnValue({
      limit: jest.fn().mockResolvedValue([]),
    });

    await expect(selector.select(1, 999, null)).rejects.toThrow(NotFoundException);
  });

  it('should select preferred format if available', async () => {
    db.where.mockResolvedValue([mockFile, mockFile2]);

    const result = await selector.select(1, null, 'pdf');
    expect(result).toEqual(mockFile2);
  });

  it('should fallback to primary if preferred format not found', async () => {
    db.where.mockResolvedValue([mockFile, mockFile2]);

    const result = await selector.select(1, null, 'mobi');
    expect(result).toEqual(mockFile);
  });

  it('should throw if no files found for book', async () => {
    db.where.mockResolvedValue([]);

    await expect(selector.select(1, null, null)).rejects.toThrow(NotFoundException);
  });
});
