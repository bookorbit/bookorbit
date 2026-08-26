import 'reflect-metadata';

import { validate } from 'class-validator';

import { CreateBookRequestDto } from './create-book-request.dto';

function dto(coverUrl: string | null): CreateBookRequestDto {
  return Object.assign(new CreateBookRequestDto(), {
    title: 'A book',
    mediaKind: 'ebook',
    coverUrl,
  });
}

describe('CreateBookRequestDto', () => {
  it.each(['https://covers.example/book.jpg', 'http://localhost/cover'])('accepts an HTTP cover URL: %s', async (coverUrl) => {
    await expect(validate(dto(coverUrl))).resolves.toEqual([]);
  });

  it.each(['data:image/png;base64,AAAA', 'javascript:alert(1)', 'cover.jpg', 'https://'])('rejects a non-HTTP cover URL: %s', async (coverUrl) => {
    expect(await validate(dto(coverUrl))).not.toEqual([]);
  });

  it('allows an omitted cover', async () => {
    await expect(validate(dto(null))).resolves.toEqual([]);
  });
});
