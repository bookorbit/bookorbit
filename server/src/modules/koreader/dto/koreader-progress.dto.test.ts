import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { KoreaderSaveProgressDto } from './koreader-progress.dto';

const BASE = { document: 'abc123', percentage: 0.42 };

describe('KoreaderSaveProgressDto', () => {
  it('accepts optional document metadata from newer KOSync clients', async () => {
    const metadata = { filename: 'book.epub', title: 'Book', authors: 'Author' };
    const dto = plainToInstance(KoreaderSaveProgressDto, { ...BASE, metadata });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors).toHaveLength(0);
    expect(dto.metadata).toEqual(metadata);
  });

  it('rejects metadata values that are not objects', async () => {
    const dto = plainToInstance(KoreaderSaveProgressDto, { ...BASE, metadata: 'book.epub' });
    const errors = await validate(dto);

    expect(errors).toEqual([expect.objectContaining({ property: 'metadata' })]);
  });

  it('rejects explicit null metadata', async () => {
    const dto = plainToInstance(KoreaderSaveProgressDto, { ...BASE, metadata: null });
    const errors = await validate(dto);

    expect(errors).toEqual([expect.objectContaining({ property: 'metadata' })]);
  });

  it('accepts an xpointer string progress from reflowable documents', async () => {
    const dto = plainToInstance(KoreaderSaveProgressDto, { ...BASE, progress: '/body/DocFragment[8]/body/p[12]/text().0' });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.progress).toBe('/body/DocFragment[8]/body/p[12]/text().0');
  });

  it('coerces the numeric page progress sent for paged documents into a string', async () => {
    const dto = plainToInstance(KoreaderSaveProgressDto, { ...BASE, progress: 42 });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.progress).toBe('42');
  });

  it('keeps progress undefined when omitted', async () => {
    const dto = plainToInstance(KoreaderSaveProgressDto, { ...BASE });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.progress).toBeUndefined();
  });

  it('rejects progress values that are neither string nor number', async () => {
    const dto = plainToInstance(KoreaderSaveProgressDto, { ...BASE, progress: true });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.property).toBe('progress');
  });
});
