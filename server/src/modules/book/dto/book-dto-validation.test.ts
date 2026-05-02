import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BulkBookIdsDto } from './bulk-book-ids.dto';
import { BulkQuerySelectionDto } from './bulk-query-selection.dto';
import { BulkSelectionDto } from './bulk-selection.dto';
import { BulkSetMetadataDto } from './bulk-set-metadata.dto';
import { BulkSetMetadataLockDto } from './bulk-set-metadata-lock.dto';
import { BulkSetRatingDto } from './bulk-set-rating.dto';
import { BulkSetStatusDto } from './bulk-set-status.dto';
import { BulkUpdateTagsDto } from './bulk-update-tags.dto';
import { DeleteBooksDto } from './delete-books.dto';
import { ExportBooksDto } from './export-books.dto';
import { MetadataExportDto } from './metadata-export.dto';
import { GetBooksDto } from './get-books.dto';
import { SaveProgressDto } from './save-progress.dto';
import { SearchBooksDto } from './search-books.dto';
import { UpdateBookMetadataDto } from './update-book-metadata.dto';
import { UpdateRatingDto } from './update-rating.dto';
import { UpsertAudioProgressDto } from './upsert-audio-progress.dto';

async function errorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  const dto = plainToInstance(cls, value);
  return validate(dto);
}

async function strictErrorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  const dto = plainToInstance(cls, value);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('Book DTO validation', () => {
  it('validates bulk selection DTOs for explicit ids and query payloads', async () => {
    expect((await errorsFor(BulkQuerySelectionDto, { libraryId: 5 })).length).toBe(0);
    expect((await errorsFor(BulkQuerySelectionDto, { filter: { type: 'group', join: 'AND', rules: [] } })).length).toBe(0);
    expect((await errorsFor(BulkSelectionDto, { bookIds: [1, 2] })).length).toBe(0);
    expect((await errorsFor(BulkSelectionDto, { query: { libraryId: 5 } })).length).toBe(0);
    expect((await errorsFor(BulkSelectionDto, { query: { filter: { type: 'group', join: 'AND', rules: [] } } })).length).toBe(0);
    expect((await errorsFor(BulkSelectionDto, { query: { sort: [{ field: 'title', dir: 'asc' }] } })).length).toBe(0);
    expect((await errorsFor(BulkSelectionDto, { query: {} })).length).toBe(0);
    expect((await errorsFor(BulkSelectionDto, {})).length).toBeGreaterThan(0);
    expect((await errorsFor(BulkSelectionDto, { bookIds: [] })).length).toBeGreaterThan(0);
    expect((await errorsFor(BulkSelectionDto, { bookIds: ['x'] })).length).toBeGreaterThan(0);
  });

  it('validates bulk book id DTOs in explicit and query modes', async () => {
    expect((await errorsFor(BulkBookIdsDto, { bookIds: [1, 2] })).length).toBe(0);
    expect((await errorsFor(BulkBookIdsDto, { query: { libraryId: 5 } })).length).toBe(0);
    expect((await errorsFor(DeleteBooksDto, { bookIds: [3] })).length).toBe(0);
    expect((await errorsFor(DeleteBooksDto, { query: { filter: { type: 'group', join: 'AND', rules: [] } } })).length).toBe(0);
    expect((await errorsFor(BulkBookIdsDto, {})).length).toBeGreaterThan(0);
    expect((await errorsFor(BulkBookIdsDto, { bookIds: [] })).length).toBeGreaterThan(0);
    expect((await errorsFor(DeleteBooksDto, { bookIds: ['x'] })).length).toBeGreaterThan(0);
  });

  it('validates bulk action DTOs with bookIds and query selection', async () => {
    expect((await errorsFor(BulkSetStatusDto, { bookIds: [1], status: 'read' })).length).toBe(0);
    expect((await errorsFor(BulkSetStatusDto, { query: { libraryId: 5 }, status: 'read' })).length).toBe(0);
    expect((await errorsFor(BulkSetRatingDto, { bookIds: [1], rating: 4 })).length).toBe(0);
    expect((await errorsFor(BulkSetRatingDto, { query: {}, rating: 4 })).length).toBe(0);
    expect((await errorsFor(BulkSetMetadataDto, { bookIds: [1], field: 'language', value: 'fr' })).length).toBe(0);
    expect((await errorsFor(BulkSetMetadataDto, { query: { libraryId: 5 }, field: 'language', value: 'fr' })).length).toBe(0);
    expect((await errorsFor(BulkUpdateTagsDto, { bookIds: [1], mode: 'add', tags: ['favorite'] })).length).toBe(0);
    expect(
      (await errorsFor(BulkUpdateTagsDto, { query: { filter: { type: 'group', join: 'AND', rules: [] } }, mode: 'replace', tags: ['favorite'] }))
        .length,
    ).toBe(0);
    expect((await errorsFor(BulkSetMetadataLockDto, { bookIds: [1], locked: true })).length).toBe(0);
    expect((await errorsFor(BulkSetMetadataLockDto, { query: {}, locked: false })).length).toBe(0);
  });

  it('validates export options and boolean allFormats flag', async () => {
    expect((await errorsFor(ExportBooksDto, { bookIds: [1], allFormats: true })).length).toBe(0);
    expect((await errorsFor(ExportBooksDto, { bookIds: [1], audioOnly: true })).length).toBe(0);
    expect((await errorsFor(ExportBooksDto, { bookIds: [1], allFormats: 'true' })).length).toBeGreaterThan(0);
    expect((await errorsFor(ExportBooksDto, { bookIds: [1], audioOnly: 'true' })).length).toBeGreaterThan(0);
  });

  it('validates metadata export dto options and scopes', async () => {
    expect(
      (
        await errorsFor(MetadataExportDto, {
          bookIds: [1],
          format: 'csv',
          viewType: 'library',
          sort: [{ field: 'title', dir: 'asc' }],
          options: { includePersonalData: true, includeFilePaths: false, columnsMode: 'canonical' },
        })
      ).length,
    ).toBe(0);
    expect(
      (
        await errorsFor(MetadataExportDto, {
          query: { libraryId: 3, q: 'dune', sort: [{ field: 'addedAt', dir: 'desc' }] },
          format: 'json',
          viewType: 'smartScope',
          options: { columnsMode: 'visible', visibleColumns: ['title', 'authors'] },
        })
      ).length,
    ).toBe(0);
    expect((await errorsFor(MetadataExportDto, { bookIds: [1], format: 'xml' })).length).toBeGreaterThan(0);
    expect((await errorsFor(MetadataExportDto, { bookIds: [1], format: 'csv', options: { columnsMode: 'bad-mode' } })).length).toBeGreaterThan(0);
    expect((await errorsFor(MetadataExportDto, { bookIds: [1], format: 'csv', viewType: 'series' })).length).toBeGreaterThan(0);
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
    expect((await errorsFor(UpdateBookMetadataDto, { publishedYear: 999 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookMetadataDto, { publishedYear: 2201 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookMetadataDto, { authors: ['ok', 1] })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookMetadataDto, { language: 'english-too-long' })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookMetadataDto, { isbn10: '12345678901' })).length).toBeGreaterThan(0);
  });

  it('validates inline-edit single-field patches for table view use cases', async () => {
    // Single title patch
    expect((await errorsFor(UpdateBookMetadataDto, { title: 'New Title' })).length).toBe(0);
    // Single series patch
    expect((await errorsFor(UpdateBookMetadataDto, { seriesName: 'My Series', seriesIndex: 1.5 })).length).toBe(0);
    // Series cleared to null
    expect((await errorsFor(UpdateBookMetadataDto, { seriesName: null, seriesIndex: null })).length).toBe(0);
    // Language valid 2-letter code
    expect((await errorsFor(UpdateBookMetadataDto, { language: 'en' })).length).toBe(0);
    // Language cleared to null
    expect((await errorsFor(UpdateBookMetadataDto, { language: null })).length).toBe(0);
    // Rating null (clear rating)
    expect((await errorsFor(UpdateBookMetadataDto, { rating: null })).length).toBe(0);
    // Rating valid range
    expect((await errorsFor(UpdateBookMetadataDto, { rating: 1 })).length).toBe(0);
    expect((await errorsFor(UpdateBookMetadataDto, { rating: 5 })).length).toBe(0);
    // Authors array single-field patch
    expect((await errorsFor(UpdateBookMetadataDto, { authors: ['Author One'] })).length).toBe(0);
    // Genres/tags single-field patch
    expect((await errorsFor(UpdateBookMetadataDto, { genres: ['Fantasy'] })).length).toBe(0);
    expect((await errorsFor(UpdateBookMetadataDto, { tags: ['to-read'] })).length).toBe(0);
    // Empty payload (all fields optional)
    expect((await errorsFor(UpdateBookMetadataDto, {})).length).toBe(0);
    // seriesIndex must be a number
    expect((await errorsFor(UpdateBookMetadataDto, { seriesIndex: 'not-a-number' })).length).toBeGreaterThan(0);
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

  it('validates audiobook progress bounds for percentage and position', async () => {
    expect((await errorsFor(UpsertAudioProgressDto, { percentage: 0, currentFileId: 1, positionSeconds: 0 })).length).toBe(0);
    expect((await errorsFor(UpsertAudioProgressDto, { percentage: 100, currentFileId: 2, positionSeconds: 120.5 })).length).toBe(0);

    expect((await errorsFor(UpsertAudioProgressDto, { percentage: -1, currentFileId: 1, positionSeconds: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpsertAudioProgressDto, { percentage: 101, currentFileId: 1, positionSeconds: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpsertAudioProgressDto, { percentage: 10, currentFileId: 0, positionSeconds: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpsertAudioProgressDto, { percentage: 10, currentFileId: 1, positionSeconds: -5 })).length).toBeGreaterThan(0);
  });
});
