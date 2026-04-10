vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', parts, values })),
}));

import { and, eq } from 'drizzle-orm';

import { authors, bookAuthors, bookFiles, bookTags, books, tags } from '../../db/schema';
import { EmailBookReadRepository } from './email-book-read.repository';

function selectChain() {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    innerJoin: vi.fn(),
    orderBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  return chain;
}

describe('EmailBookReadRepository', () => {
  it('findBookById returns the first row or null when none is found', async () => {
    const chain = selectChain();
    chain.limit.mockResolvedValueOnce([{ id: 7 }]).mockResolvedValueOnce([]);
    const db = { select: vi.fn().mockReturnValue(chain) };
    const repo = new EmailBookReadRepository(db as never);

    await expect(repo.findBookById(7)).resolves.toEqual({ id: 7 });
    await expect(repo.findBookById(999)).resolves.toBeNull();

    expect(eq).toHaveBeenCalledWith(books.id, 7);
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it('findBookPrimaryFileId and findFileById normalize missing records to null', async () => {
    const chain = selectChain();
    chain.limit
      .mockResolvedValueOnce([{ primaryFileId: 12 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 18 }])
      .mockResolvedValueOnce([]);
    const db = { select: vi.fn().mockReturnValue(chain) };
    const repo = new EmailBookReadRepository(db as never);

    await expect(repo.findBookPrimaryFileId(3)).resolves.toBe(12);
    await expect(repo.findBookPrimaryFileId(33)).resolves.toBeNull();
    await expect(repo.findFileById(18)).resolves.toEqual({ id: 18 });
    await expect(repo.findFileById(999)).resolves.toBeNull();
  });

  it('findFileForBook scopes by both file id and book id', async () => {
    const chain = selectChain();
    chain.limit.mockResolvedValueOnce([{ id: 5, bookId: 3 }]).mockResolvedValueOnce([]);
    const db = { select: vi.fn().mockReturnValue(chain) };
    const repo = new EmailBookReadRepository(db as never);

    await expect(repo.findFileForBook(3, 5)).resolves.toEqual({ id: 5, bookId: 3 });
    await expect(repo.findFileForBook(3, 9)).resolves.toBeNull();

    expect(and).toHaveBeenCalledWith({ op: 'eq', left: bookFiles.id, right: 5 }, { op: 'eq', left: bookFiles.bookId, right: 3 });
  });

  it('findFilesByBookId returns all file rows for the book', async () => {
    const chain = selectChain();
    chain.where.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const db = { select: vi.fn().mockReturnValue(chain) };
    const repo = new EmailBookReadRepository(db as never);

    await expect(repo.findFilesByBookId(8)).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(chain.from).toHaveBeenCalledWith(bookFiles);
    expect(eq).toHaveBeenCalledWith(bookFiles.bookId, 8);
  });

  it('findMetadataByBookId returns metadata row or null', async () => {
    const chain = selectChain();
    chain.limit.mockResolvedValueOnce([{ bookId: 2, title: 'Dune' }]).mockResolvedValueOnce([]);
    const db = { select: vi.fn().mockReturnValue(chain) };
    const repo = new EmailBookReadRepository(db as never);

    await expect(repo.findMetadataByBookId(2)).resolves.toEqual({ bookId: 2, title: 'Dune' });
    await expect(repo.findMetadataByBookId(22)).resolves.toBeNull();
  });

  it('findAuthorNamesByBookId joins authors and preserves display order', async () => {
    const chain = selectChain();
    chain.orderBy.mockResolvedValue([{ name: 'Frank Herbert' }]);
    const db = { select: vi.fn().mockReturnValue(chain) };
    const repo = new EmailBookReadRepository(db as never);

    await expect(repo.findAuthorNamesByBookId(10)).resolves.toEqual([{ name: 'Frank Herbert' }]);

    expect(chain.from).toHaveBeenCalledWith(bookAuthors);
    expect(chain.innerJoin).toHaveBeenCalledWith(authors, { op: 'eq', left: authors.id, right: bookAuthors.authorId });
    expect(chain.where).toHaveBeenCalledWith({ op: 'eq', left: bookAuthors.bookId, right: 10 });
    expect(chain.orderBy).toHaveBeenCalledWith(bookAuthors.displayOrder);
  });

  it('findTagNamesByBookId joins tags and filters by book id', async () => {
    const chain = selectChain();
    chain.where.mockResolvedValue([{ name: 'Sci-Fi' }]);
    const db = { select: vi.fn().mockReturnValue(chain) };
    const repo = new EmailBookReadRepository(db as never);

    await expect(repo.findTagNamesByBookId(6)).resolves.toEqual([{ name: 'Sci-Fi' }]);

    expect(chain.from).toHaveBeenCalledWith(bookTags);
    expect(chain.innerJoin).toHaveBeenCalledWith(tags, { op: 'eq', left: tags.id, right: bookTags.tagId });
    expect(chain.where).toHaveBeenCalledWith({ op: 'eq', left: bookTags.bookId, right: 6 });
  });
});
