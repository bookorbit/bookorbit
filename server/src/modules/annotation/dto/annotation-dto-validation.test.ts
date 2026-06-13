import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  AnnotationBulkDto,
  AnnotationExportQueryDto,
  AnnotationHubBooksQueryDto,
  AnnotationHubQueryDto,
  AnnotationPositionRetryDto,
} from './annotation-hub.dto';
import { CreateAnnotationDto } from './create-annotation.dto';
import { UpdateAnnotationDto } from './update-annotation.dto';

async function errorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  const dto = plainToInstance(cls, value);
  return validate(dto);
}

describe('Annotation DTO validation', () => {
  it('accepts create payload with optional fields and valid style', async () => {
    const errors = await errorsFor(CreateAnnotationDto, {
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      text: 'Selected text',
      color: '#FACC15',
      style: 'underline',
      note: 'reader note',
      chapterTitle: 'Chapter 1',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid create payload boundaries', async () => {
    expect((await errorsFor(CreateAnnotationDto, { cfi: '', text: 'ok' })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateAnnotationDto, { cfi: 'x', text: '' })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateAnnotationDto, { cfi: 'x', text: 'ok', color: 'x'.repeat(21) })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateAnnotationDto, { cfi: 'x', text: 'ok', style: 'invalid' })).length).toBeGreaterThan(0);
    expect((await errorsFor(CreateAnnotationDto, { cfi: 'x', text: 'ok', chapterTitle: 'x'.repeat(501) })).length).toBeGreaterThan(0);
  });

  it('accepts update payload with nullable note and optional style', async () => {
    const nullNoteErrors = await errorsFor(UpdateAnnotationDto, { note: null, style: 'highlight' });
    const normalErrors = await errorsFor(UpdateAnnotationDto, { note: 'updated', color: '#38BDF8' });

    expect(nullNoteErrors).toHaveLength(0);
    expect(normalErrors).toHaveLength(0);
  });

  it('rejects invalid update payload types', async () => {
    expect((await errorsFor(UpdateAnnotationDto, { note: 123 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateAnnotationDto, { color: 'x'.repeat(21) })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateAnnotationDto, { style: 'invalid' })).length).toBeGreaterThan(0);
  });
});

describe('AnnotationHubQueryDto validation', () => {
  it('coerces a hasNote "true" string to boolean and accepts an ISO date range', async () => {
    const dto = plainToInstance(AnnotationHubQueryDto, {
      hasNote: 'true',
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-31',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.hasNote).toBe(true);
  });

  it('coerces a hasNote "false" string to boolean false', async () => {
    const dto = plainToInstance(AnnotationHubQueryDto, { hasNote: 'false' });

    expect(dto.hasNote).toBe(false);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('leaves hasNote undefined when it is absent', async () => {
    const dto = plainToInstance(AnnotationHubQueryDto, {});

    expect(dto.hasNote).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-boolean hasNote and a malformed date', async () => {
    expect((await errorsFor(AnnotationHubQueryDto, { hasNote: 'maybe' })).length).toBeGreaterThan(0);
    expect((await errorsFor(AnnotationHubQueryDto, { dateFrom: 'not-a-date' })).length).toBeGreaterThan(0);
  });

  it('accepts a fully populated query and coerces numeric fields', async () => {
    const dto = plainToInstance(AnnotationHubQueryDto, {
      page: '2',
      pageSize: '50',
      bookId: '5',
      search: 'foo',
      chapter: 'Chapter 1',
      colors: '#FACC15,#4ADE80',
      styles: 'highlight,underline',
      origins: 'web,koreader',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      hasNote: 'true',
      status: 'active',
      sortBy: 'book',
      sortDir: 'asc',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.bookId).toBe(5);
  });

  it('rejects out-of-range pagination and bad enum values', async () => {
    expect((await errorsFor(AnnotationHubQueryDto, { page: '0' })).length).toBeGreaterThan(0);
    expect((await errorsFor(AnnotationHubQueryDto, { pageSize: '101' })).length).toBeGreaterThan(0);
    expect((await errorsFor(AnnotationHubQueryDto, { status: 'archived' })).length).toBeGreaterThan(0);
    expect((await errorsFor(AnnotationHubQueryDto, { sortBy: 'color' })).length).toBeGreaterThan(0);
    expect((await errorsFor(AnnotationHubQueryDto, { search: 'x'.repeat(201) })).length).toBeGreaterThan(0);
  });
});

describe('AnnotationBulkDto validation', () => {
  it('accepts a trash action and a restyle with color and style', async () => {
    expect(await errorsFor(AnnotationBulkDto, { ids: [1, 2], action: 'trash' })).toHaveLength(0);
    expect(await errorsFor(AnnotationBulkDto, { ids: [1], action: 'restyle', color: '#FACC15', style: 'underline' })).toHaveLength(0);
  });

  it('normalizes an empty color string to undefined', () => {
    const dto = plainToInstance(AnnotationBulkDto, { ids: [1], action: 'restyle', color: '' });
    expect(dto.color).toBeUndefined();
  });

  it('rejects an empty id list, unknown action, oversize color and bad style', async () => {
    expect((await errorsFor(AnnotationBulkDto, { ids: [], action: 'trash' })).length).toBeGreaterThan(0);
    expect((await errorsFor(AnnotationBulkDto, { ids: [1], action: 'explode' })).length).toBeGreaterThan(0);
    expect((await errorsFor(AnnotationBulkDto, { ids: [1], action: 'restyle', color: 'x'.repeat(21) })).length).toBeGreaterThan(0);
    expect((await errorsFor(AnnotationBulkDto, { ids: [1], action: 'restyle', style: 'nope' })).length).toBeGreaterThan(0);
  });
});

describe('AnnotationPositionRetryDto validation', () => {
  it('accepts a known format and rejects an unknown one', async () => {
    expect(await errorsFor(AnnotationPositionRetryDto, { format: 'cfi' })).toHaveLength(0);
    expect((await errorsFor(AnnotationPositionRetryDto, { format: 'mobi' })).length).toBeGreaterThan(0);
  });
});

describe('AnnotationExportQueryDto validation', () => {
  it('accepts a known export format and rejects an unknown one', async () => {
    expect(await errorsFor(AnnotationExportQueryDto, { format: 'csv' })).toHaveLength(0);
    expect((await errorsFor(AnnotationExportQueryDto, { format: 'pdf' })).length).toBeGreaterThan(0);
  });
});

describe('AnnotationHubBooksQueryDto validation', () => {
  it('accepts active and trashed but rejects other statuses', async () => {
    expect(await errorsFor(AnnotationHubBooksQueryDto, { status: 'active' })).toHaveLength(0);
    expect(await errorsFor(AnnotationHubBooksQueryDto, { status: 'trashed' })).toHaveLength(0);
    expect((await errorsFor(AnnotationHubBooksQueryDto, { status: 'gone' })).length).toBeGreaterThan(0);
  });
});
