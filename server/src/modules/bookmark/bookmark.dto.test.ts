import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { UpdateBookmarkDto } from './dto/update-bookmark.dto';

async function errorsFor(value: Record<string, unknown>) {
  const dto = plainToInstance(CreateBookmarkDto, value);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('Bookmark DTO validation', () => {
  it('requires a CFI location', async () => {
    const errors = await errorsFor({ title: 'Chapter 1' });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraints: expect.objectContaining({
            isString: 'cfi must be a string',
          }),
        }),
      ]),
    );
  });

  it('accepts valid CFI bookmarks and rejects the deleted audio shape', async () => {
    expect((await errorsFor({ title: 'Chapter 1', cfi: 'epubcfi(/6/2)' })).length).toBe(0);
    expect((await errorsFor({ title: '00:01:40', positionSeconds: 100 })).length).toBeGreaterThan(0);
  });

  it('rejects empty title and empty CFI', async () => {
    expect((await errorsFor({ title: '', cfi: 'epubcfi(/6/2)' })).length).toBeGreaterThan(0);
    expect((await errorsFor({ title: 'x', cfi: '' })).length).toBeGreaterThan(0);
  });

  it('enforces CFI and title max lengths', async () => {
    expect((await errorsFor({ title: 'x', cfi: 'a'.repeat(2001) })).length).toBeGreaterThan(0);
    expect((await errorsFor({ title: 'a'.repeat(501), cfi: 'epubcfi(/6/2)' })).length).toBeGreaterThan(0);
  });

  describe('UpdateBookmarkDto', () => {
    async function updateErrors(value: Record<string, unknown>) {
      return validate(plainToInstance(UpdateBookmarkDto, value), { whitelist: true, forbidNonWhitelisted: true });
    }

    it('accepts an empty patch, a title, a note and a null note', async () => {
      expect(await updateErrors({})).toHaveLength(0);
      expect(await updateErrors({ title: 'Renamed' })).toHaveLength(0);
      expect(await updateErrors({ note: 'Why I marked this' })).toHaveLength(0);
      expect(await updateErrors({ note: null })).toHaveLength(0);
    });

    it('trims the title and turns a blank note into null', () => {
      const dto = plainToInstance(UpdateBookmarkDto, { title: '  Renamed  ', note: '   ' });
      expect(dto.title).toBe('Renamed');
      expect(dto.note).toBeNull();
      expect(plainToInstance(UpdateBookmarkDto, { note: '  kept  ' }).note).toBe('kept');
    });

    it('rejects a blank or null title, and over-long fields', async () => {
      expect((await updateErrors({ title: '   ' })).map((error) => error.property)).toEqual(['title']);
      expect((await updateErrors({ title: null })).map((error) => error.property)).toEqual(['title']);
      expect((await updateErrors({ title: 'a'.repeat(501) })).map((error) => error.property)).toEqual(['title']);
      expect(await updateErrors({ title: 'a'.repeat(500) })).toHaveLength(0);
      expect((await updateErrors({ note: 'a'.repeat(4001) })).map((error) => error.property)).toEqual(['note']);
      expect(await updateErrors({ note: 'a'.repeat(4000) })).toHaveLength(0);
    });

    it('rejects fields it does not know, including a location change', async () => {
      expect((await updateErrors({ cfi: 'epubcfi(/6/4)' })).map((error) => error.property)).toEqual(['cfi']);
    });
  });
});
