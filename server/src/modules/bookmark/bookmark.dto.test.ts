import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateBookmarkDto } from './dto/create-bookmark.dto';

async function errorsFor(value: Record<string, unknown>) {
  const dto = plainToInstance(CreateBookmarkDto, value);
  return validate(dto);
}

describe('Bookmark DTO validation', () => {
  it('requires at least one location field: cfi or positionSeconds', async () => {
    const errors = await errorsFor({ title: 'Chapter 1' });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraints: expect.objectContaining({
            bookmarkLocation: 'Either cfi or positionSeconds must be provided',
          }),
        }),
      ]),
    );
  });

  it('accepts valid CFI bookmarks and valid audio-position bookmarks', async () => {
    expect((await errorsFor({ title: 'Chapter 1', cfi: 'epubcfi(/6/2)' })).length).toBe(0);
    expect((await errorsFor({ title: '00:01:40', positionSeconds: 100 })).length).toBe(0);
  });

  it('rejects empty title and empty CFI', async () => {
    expect((await errorsFor({ title: '', cfi: 'epubcfi(/6/2)' })).length).toBeGreaterThan(0);
    expect((await errorsFor({ title: 'x', cfi: '' })).length).toBeGreaterThan(0);
  });

  it('enforces CFI and title max lengths', async () => {
    expect((await errorsFor({ title: 'x', cfi: 'a'.repeat(2001) })).length).toBeGreaterThan(0);
    expect((await errorsFor({ title: 'a'.repeat(501), cfi: 'epubcfi(/6/2)' })).length).toBeGreaterThan(0);
  });

  it('enforces non-negative numeric positionSeconds', async () => {
    expect((await errorsFor({ title: 'x', positionSeconds: -0.1 })).length).toBeGreaterThan(0);
    expect((await errorsFor({ title: 'x', positionSeconds: 0 })).length).toBe(0);
  });
});
