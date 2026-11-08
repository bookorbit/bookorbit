import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import type { BookService } from '../book/book.service';
import type { TextLocateOutcome, TextLocatorService } from '../position-converter/text-locator.service';
import { PageLocatorService } from './page-locator.service';

const USER = { id: 7, isSuperuser: false } as RequestUser;

function makeService(format: string, outcome: TextLocateOutcome) {
  const books = { verifyFileAccess: vi.fn().mockResolvedValue({ id: 12, bookId: 3, format }) };
  const locator = { locate: vi.fn().mockResolvedValue(outcome) };
  return {
    books,
    locator,
    service: new PageLocatorService(books as unknown as BookService, locator as unknown as TextLocatorService),
  };
}

describe('PageLocatorService', () => {
  it('checks access to the file as the requesting user before reading it', async () => {
    const { books, locator, service } = makeService('epub', { status: 'no_match' });
    await service.locateText(12, 'page text', USER);
    expect(books.verifyFileAccess).toHaveBeenCalledWith(12, USER);
    expect(locator.locate).toHaveBeenCalledWith(12, 'page text');
  });

  it('returns the match with its place in the book', async () => {
    const { service } = makeService('kepub', {
      status: 'matched',
      chapterIndex: 4,
      cfi: 'epubcfi(/6/10!/4/2,/1:0,/1:20)',
      confidence: 0.82,
      excerpt: 'His friend Mr. Darcy',
    });
    await expect(service.locateText(12, 'page text', USER)).resolves.toEqual({
      match: { chapterIndex: 4, cfi: 'epubcfi(/6/10!/4/2,/1:0,/1:20)', confidence: 0.82, excerpt: 'His friend Mr. Darcy' },
    });
  });

  it('returns a null match when the text is not in the file', async () => {
    const { service } = makeService('epub', { status: 'no_match' });
    await expect(service.locateText(12, 'page text', USER)).resolves.toEqual({ match: null });
  });

  it('refuses a file that is not an EPUB without reading it', async () => {
    const { locator, service } = makeService('pdf', { status: 'no_match' });
    await expect(service.locateText(12, 'page text', USER)).rejects.toBeInstanceOf(BadRequestException);
    expect(locator.locate).not.toHaveBeenCalled();
  });

  it('reports a file that cannot be read as not found', async () => {
    const { service } = makeService('epub', { status: 'unavailable' });
    await expect(service.locateText(12, 'page text', USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('passes on a refused file access unchanged', async () => {
    const { books, service } = makeService('epub', { status: 'no_match' });
    books.verifyFileAccess.mockRejectedValue(new NotFoundException('No file with id 12'));
    await expect(service.locateText(12, 'page text', USER)).rejects.toBeInstanceOf(NotFoundException);
  });
});
