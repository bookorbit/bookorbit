import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BulkEditBookBucketDto, BulkSetTargetDto, FinalizeBookBucketDto, UpdateBookBucketFileDto } from './dto';
import { ListBookBucketFilesDto } from './dto/list-book-bucket-files.dto';

async function errorsFor<T extends object>(dtoClass: new () => T, value: Record<string, unknown>) {
  return validate(plainToInstance(dtoClass, value));
}

describe('BookBucket DTO validation', () => {
  it('ListBookBucketFilesDto validates enums and transforms pagination numbers', async () => {
    const dto = plainToInstance(ListBookBucketFilesDto, {
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
    expect((await errorsFor(ListBookBucketFilesDto, { status: 'unknown' })).length).toBeGreaterThan(0);
    expect((await errorsFor(ListBookBucketFilesDto, { limit: 200 })).length).toBeGreaterThan(0);
  });

  it('FinalizeBookBucketDto requires default destination values to be complete pair', async () => {
    expect((await errorsFor(FinalizeBookBucketDto, { defaultLibraryId: 1 })).length).toBeGreaterThan(0);
    expect((await errorsFor(FinalizeBookBucketDto, { defaultFolderId: 2 })).length).toBeGreaterThan(0);
    expect((await errorsFor(FinalizeBookBucketDto, { defaultLibraryId: 1, defaultFolderId: 2, fileIds: [1, 2] })).length).toBe(0);
  });

  it('UpdateBookBucketFileDto allows null destination values but rejects non-integers', async () => {
    expect((await errorsFor(UpdateBookBucketFileDto, { targetLibraryId: null, targetFolderId: null })).length).toBe(0);
    expect((await errorsFor(UpdateBookBucketFileDto, { targetLibraryId: 'x' })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookBucketFileDto, { targetFolderId: 2.5 })).length).toBeGreaterThan(0);
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

  it('BulkEditBookBucketDto requires nested fields and explicit edit controls', async () => {
    expect(
      (
        await errorsFor(BulkEditBookBucketDto, {
          fields: { title: 'Edited Title', authors: ['A'] },
          enabledFields: ['title', 'authors'],
          mergeArrays: false,
        })
      ).length,
    ).toBe(0);

    expect((await errorsFor(BulkEditBookBucketDto, { enabledFields: ['title'], mergeArrays: false })).length).toBeGreaterThan(0);
    expect((await errorsFor(BulkEditBookBucketDto, { fields: {}, mergeArrays: false })).length).toBeGreaterThan(0);
    expect((await errorsFor(BulkEditBookBucketDto, { fields: {}, enabledFields: ['title'] })).length).toBeGreaterThan(0);
  });
});
