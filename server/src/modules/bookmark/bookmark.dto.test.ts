import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateBookmarkDto } from './dto/create-bookmark.dto';

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
});
