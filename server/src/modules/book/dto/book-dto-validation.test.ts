import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BulkBookIdsDto } from './bulk-book-ids.dto';
import { DeleteBooksDto } from './delete-books.dto';
import { ExportBooksDto } from './export-books.dto';
import { GetBooksDto } from './get-books.dto';
import { SaveProgressDto } from './save-progress.dto';
import { SearchBooksDto } from './search-books.dto';
import { UpdateBookMetadataDto } from './update-book-metadata.dto';
import { UpdateRatingDto } from './update-rating.dto';

async function errorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  const dto = plainToInstance(cls, value);
  return validate(dto);
}

async function strictErrorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  const dto = plainToInstance(cls, value);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('Book DTO validation', () => {
  it('validates book id array DTOs require non-empty integer arrays', async () => {
    expect((await errorsFor(BulkBookIdsDto, { bookIds: [1, 2] })).length).toBe(0);
    expect((await errorsFor(DeleteBooksDto, { bookIds: [3] })).length).toBe(0);
    expect((await errorsFor(BulkBookIdsDto, { bookIds: [] })).length).toBeGreaterThan(0);
    expect((await errorsFor(DeleteBooksDto, { bookIds: ['x'] })).length).toBeGreaterThan(0);
  });

  it('validates export options and boolean allFormats flag', async () => {
    expect((await errorsFor(ExportBooksDto, { bookIds: [1], allFormats: true })).length).toBe(0);
    expect((await errorsFor(ExportBooksDto, { bookIds: [1], allFormats: 'true' })).length).toBeGreaterThan(0);
  });

  it('coerces GetBooksDto numeric query values and enforces bounds', async () => {
    const valid = plainToInstance(GetBooksDto, { libraryId: '3', page: '0', size: '50', search: 'dune' });
    const validErrors = await validate(valid);

    expect(validErrors.length).toBe(0);
    expect(valid.libraryId).toBe(3);
    expect(valid.page).toBe(0);
    expect(valid.size).toBe(50);

    expect((await errorsFor(GetBooksDto, { libraryId: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(GetBooksDto, { libraryId: 3, page: -1 })).length).toBeGreaterThan(0);
    expect((await errorsFor(GetBooksDto, { libraryId: 3, size: 500 })).length).toBeGreaterThan(0);
  });

  it('validates SaveProgressDto percentage bounds and conditional field types', async () => {
    expect((await errorsFor(SaveProgressDto, { percentage: 0 })).length).toBe(0);
    expect((await errorsFor(SaveProgressDto, { percentage: 100, cfi: 'epubcfi(/6/2)', pageNumber: 5 })).length).toBe(0);

    expect((await errorsFor(SaveProgressDto, { percentage: -1 })).length).toBeGreaterThan(0);
    expect((await errorsFor(SaveProgressDto, { percentage: 50, cfi: 123 })).length).toBeGreaterThan(0);
    expect((await errorsFor(SaveProgressDto, { percentage: 50, pageNumber: 'five' })).length).toBeGreaterThan(0);
  });

  it('requires non-empty search text and bounds search limit', async () => {
    const valid = plainToInstance(SearchBooksDto, { q: 'dune', limit: '20' });
    const validErrors = await validate(valid);

    expect(validErrors.length).toBe(0);
    expect(valid.limit).toBe(20);

    expect((await errorsFor(SearchBooksDto, { q: '' })).length).toBeGreaterThan(0);
    expect((await errorsFor(SearchBooksDto, { q: 'ok', limit: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(SearchBooksDto, { q: 'ok', limit: 21 })).length).toBeGreaterThan(0);
  });

  it('enforces UpdateBookMetadataDto bounds and array element types', async () => {
    expect(
      (
        await errorsFor(UpdateBookMetadataDto, {
          title: 'Dune',
          publishedYear: 1965,
          rating: 5,
          authors: ['Frank Herbert'],
          genres: ['Sci-Fi'],
          tags: ['classic'],
          amazonId: 'B00TEST',
        })
      ).length,
    ).toBe(0);

    expect((await errorsFor(UpdateBookMetadataDto, { rating: 6 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookMetadataDto, { publishedYear: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookMetadataDto, { authors: ['ok', 1] })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookMetadataDto, { language: 'english-too-long' })).length).toBeGreaterThan(0);
  });

  it('rejects legacy top-level audiobook fields and accepts nested audioMetadata', async () => {
    const legacyErrors = await strictErrorsFor(UpdateBookMetadataDto, {
      narrators: ['Narrator One'],
      durationSeconds: 3600,
      abridged: true,
      chapters: [{ title: 'Chapter 1', startMs: 0 }],
    });

    expect(legacyErrors.length).toBeGreaterThan(0);
    expect(legacyErrors.map((e) => e.property)).toEqual(expect.arrayContaining(['narrators', 'durationSeconds', 'abridged', 'chapters']));

    const nestedErrors = await strictErrorsFor(UpdateBookMetadataDto, {
      audioMetadata: {
        narrators: ['Narrator One'],
        durationSeconds: 3600,
        abridged: true,
        chapters: [{ title: 'Chapter 1', startMs: 0 }],
      },
    });

    expect(nestedErrors.length).toBe(0);
  });

  it('allows optional null rating reset and rejects out-of-range values', async () => {
    expect((await errorsFor(UpdateRatingDto, { rating: null })).length).toBe(0);
    expect((await errorsFor(UpdateRatingDto, { rating: 3 })).length).toBe(0);
    expect((await errorsFor(UpdateRatingDto, { rating: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateRatingDto, { rating: 6 })).length).toBeGreaterThan(0);
  });
});
