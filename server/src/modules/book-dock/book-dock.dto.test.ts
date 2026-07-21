import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';

import { BulkEditBookDockDto, BulkSetTargetDto, FinalizeBookDockDto, UpdateBookDockFileDto } from './dto';
import { ListBookDockFilesDto } from './dto/list-book-dock-files.dto';

async function errorsFor<T extends object>(dtoClass: new () => T, value: Record<string, unknown>) {
  return validate(plainToInstance(dtoClass, value));
}

describe('BookDock DTO validation', () => {
  it('ListBookDockFilesDto validates enums and transforms pagination numbers', async () => {
    const dto = plainToInstance(ListBookDockFilesDto, {
      status: 'ready',
      page: '2',
      limit: '30',
      sort: 'fileName',
      order: 'asc',
      search: 'dune',
    });

    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(30);
    expect((await validate(dto)).length).toBe(0);
    expect((await errorsFor(ListBookDockFilesDto, { status: 'unknown' })).length).toBeGreaterThan(0);
    expect((await errorsFor(ListBookDockFilesDto, { limit: 200 })).length).toBeGreaterThan(0);
  });

  it('FinalizeBookDockDto requires default destination values to be complete pair', async () => {
    expect((await errorsFor(FinalizeBookDockDto, { defaultLibraryId: 1 })).length).toBeGreaterThan(0);
    expect((await errorsFor(FinalizeBookDockDto, { defaultFolderId: 2 })).length).toBeGreaterThan(0);
    expect((await errorsFor(FinalizeBookDockDto, { defaultLibraryId: 1, defaultFolderId: 2, fileIds: [1, 2] })).length).toBe(0);
  });

  it('UpdateBookDockFileDto allows null destination values but rejects non-integers', async () => {
    expect((await errorsFor(UpdateBookDockFileDto, { targetLibraryId: null, targetFolderId: null })).length).toBe(0);
    expect((await errorsFor(UpdateBookDockFileDto, { targetLibraryId: 'x' })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookDockFileDto, { targetFolderId: 2.5 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookDockFileDto, { selectedMetadata: { publishedYear: 1984 } })).length).toBe(0);
    expect((await errorsFor(UpdateBookDockFileDto, { selectedMetadata: { publishedYear: 101 } })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookDockFileDto, { selectedMetadata: { publishedYear: 2201 } })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookDockFileDto, { selectedMetadata: { publishedYear: 1984.5 } })).length).toBeGreaterThan(0);
  });

  it('UpdateBookDockFileDto accepts every metadata field emitted by metadata search through the production validation path', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const selectedMetadata = {
      title: 'Dune',
      pageCount: 688,
      narrators: ['Simon Vance'],
      durationSeconds: 1200,
      abridged: false,
      chapters: [{ title: 'Chapter 1', startMs: 0 }],
      seriesMemberships: [{ seriesName: 'Dune', seriesIndex: 1 }],
      communityRatings: [{ provider: 'hardcover', rating: 4.5, ratingCount: 1000 }],
      googleBooksId: 'google-id',
      goodreadsId: 'goodreads-id',
      amazonId: 'amazon-id',
      hardcoverId: 'hardcover-id',
      hardcoverEditionId: 'hardcover-edition-id',
      openLibraryId: 'OL1W',
      itunesId: 'itunes-id',
      audibleId: 'audible-id',
      librofmId: 'librofm-id',
      koboId: 'kobo-id',
      comicvineId: 'comicvine-id',
      ranobedbId: 'ranobedb-id',
      lubimyczytacId: 'lubimyczytac-id',
      aladinId: 'aladin-id',
      comicMetadata: { issueNumber: '1', pencillers: ['Artist'] },
    };

    await expect(pipe.transform({ selectedMetadata }, { type: 'body', metatype: UpdateBookDockFileDto, data: undefined })).resolves.toMatchObject({
      selectedMetadata,
    });
  });

  it('BulkSetTargetDto validates ids, filters, and nullable target fields', async () => {
    expect(
      (
        await errorsFor(BulkSetTargetDto, {
          fileIds: [1, 2],
          excludedIds: [3],
          selectAll: true,
          status: 'error',
          search: 'abc',
          targetLibraryId: null,
          targetFolderId: null,
        })
      ).length,
    ).toBe(0);
    expect((await errorsFor(BulkSetTargetDto, { fileIds: ['bad'] as never })).length).toBeGreaterThan(0);
    expect((await errorsFor(BulkSetTargetDto, { targetLibraryId: 'bad' })).length).toBeGreaterThan(0);
  });

  it('BulkEditBookDockDto requires nested fields and explicit edit controls', async () => {
    expect(
      (
        await errorsFor(BulkEditBookDockDto, {
          fields: { title: 'Edited Title', authors: ['A'] },
          enabledFields: ['title', 'authors'],
          mergeArrays: false,
        })
      ).length,
    ).toBe(0);

    expect((await errorsFor(BulkEditBookDockDto, { enabledFields: ['title'], mergeArrays: false })).length).toBeGreaterThan(0);
    expect((await errorsFor(BulkEditBookDockDto, { fields: {}, mergeArrays: false })).length).toBeGreaterThan(0);
    expect((await errorsFor(BulkEditBookDockDto, { fields: {}, enabledFields: ['title'] })).length).toBeGreaterThan(0);
    expect(
      (await errorsFor(BulkEditBookDockDto, { fields: { publishedYear: 101 }, enabledFields: ['publishedYear'], mergeArrays: false })).length,
    ).toBeGreaterThan(0);
    expect(
      (await errorsFor(BulkEditBookDockDto, { fields: { publishedYear: 1984 }, enabledFields: ['publishedYear'], mergeArrays: false })).length,
    ).toBe(0);
  });
});
