import type { RequestUser } from '../../common/types/request-user';
import { BookService } from './book.service';

function makeUser(): RequestUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: null,
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    roles: [],
  };
}

function makeService() {
  const bookRepo = {
    findPatternMetadataByBookIds: jest.fn(),
    findLibraryIdsByBookIds: jest.fn(),
    findPrimaryFilesByBookIds: jest.fn(),
    findAllFilesByBookIds: jest.fn(),
  };
  const libraryService = {
    verifyUserAccess: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest.fn().mockReturnValue('/tmp'),
  };
  const appSettings = {
    getDownloadPattern: jest.fn().mockResolvedValue('{originalFilename}'),
  };

  const service = new BookService(
    bookRepo as never,
    libraryService as never,
    {} as never,
    {} as never,
    {} as never,
    config as never,
    appSettings as never,
  );

  return { service, bookRepo, libraryService, appSettings };
}

function metaRow(bookId: number, fields?: Partial<{ title: string | null; authors: string[] }>) {
  return {
    bookId,
    title: fields?.title ?? null,
    subtitle: null,
    publisher: null,
    publishedYear: null,
    language: null,
    seriesName: null,
    seriesIndex: null,
    isbn13: null,
    authors: fields?.authors ?? [],
  };
}

describe('BookService download naming', () => {
  it('resolves download filename from pattern and metadata', async () => {
    const { service, appSettings, bookRepo } = makeService();
    appSettings.getDownloadPattern.mockResolvedValue('<{authors:first} - >{title}');
    bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(10, { title: 'Neuromancer', authors: ['William Gibson'] })]);

    const filename = await service.resolveDownloadFilename({
      bookId: 10,
      absolutePath: '/books/original-name.epub',
      format: 'epub',
    });

    expect(filename).toBe('William Gibson - Neuromancer.epub');
  });

  it('falls back to sanitized original filename when pattern resolution fails', async () => {
    const { service, appSettings } = makeService();
    appSettings.getDownloadPattern.mockRejectedValue(new Error('settings unavailable'));

    const filename = await service.resolveDownloadFilename({
      bookId: 10,
      absolutePath: '/books/bad:name?.epub',
      format: 'epub',
    });

    expect(filename).toBe('bad_name_.epub');
  });

  it('applies pattern to export zip paths and de-duplicates collisions', async () => {
    const { service, appSettings, bookRepo, libraryService } = makeService();
    const user = makeUser();

    appSettings.getDownloadPattern.mockResolvedValue('{title}');
    bookRepo.findLibraryIdsByBookIds.mockResolvedValue([
      { id: 1, libraryId: 77 },
      { id: 2, libraryId: 77 },
    ]);
    bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([
      { bookId: 1, absolutePath: '/books/a.epub', format: 'epub' },
      { bookId: 2, absolutePath: '/books/b.epub', format: 'epub' },
    ]);
    bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'Duplicate' }), metaRow(2, { title: 'Duplicate' })]);

    const files = await service.getExportFiles([1, 2], user, false);

    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 77, false);
    expect(files).toEqual([
      { absolutePath: '/books/a.epub', zipPath: 'Duplicate.epub' },
      { absolutePath: '/books/b.epub', zipPath: 'Duplicate (2).epub' },
    ]);
  });

  it('uses all-files query when allFormats is true', async () => {
    const { service, appSettings, bookRepo } = makeService();
    const user = makeUser();

    appSettings.getDownloadPattern.mockResolvedValue('{title}');
    bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 77 }]);
    bookRepo.findAllFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/a.epub', format: 'epub' }]);
    bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'One' })]);

    await service.getExportFiles([1], user, true);

    expect(bookRepo.findAllFilesByBookIds).toHaveBeenCalledWith([1]);
    expect(bookRepo.findPrimaryFilesByBookIds).not.toHaveBeenCalled();
  });
});
