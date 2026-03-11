import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MetadataProviderKey } from '@projectx/types';

import { MetadataSearchDto } from './metadata-search.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(MetadataSearchDto, input);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('MetadataSearchDto', () => {
  it('requires at least one of bookId, title, or isbn', async () => {
    const { errors } = await validateInput({ author: 'Frank Herbert' });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraints: expect.objectContaining({
            atLeastOneSearchTerm: 'At least one of bookId, title, or isbn must be provided',
          }),
        }),
      ]),
    );
  });

  it('accepts title-only searches but rejects blank title values', async () => {
    const valid = await validateInput({ title: 'Dune' });
    const blank = await validateInput({ title: '   ' });

    expect(valid.errors).toHaveLength(0);
    expect(blank.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraints: expect.objectContaining({
            atLeastOneSearchTerm: 'At least one of bookId, title, or isbn must be provided',
          }),
        }),
      ]),
    );
  });

  it('converts bookId to a number and enforces positive integers', async () => {
    const valid = await validateInput({ bookId: '12' });
    const invalidZero = await validateInput({ bookId: '0', title: 'Dune' });
    const invalidNegative = await validateInput({ bookId: '-2', title: 'Dune' });

    expect(valid.dto.bookId).toBe(12);
    expect(valid.errors).toHaveLength(0);

    expect(invalidZero.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'bookId',
          constraints: expect.objectContaining({
            min: 'bookId must not be less than 1',
          }),
        }),
      ]),
    );
    expect(invalidNegative.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'bookId',
          constraints: expect.objectContaining({
            min: 'bookId must not be less than 1',
          }),
        }),
      ]),
    );
  });

  it('normalizes provider query strings with mixed separators and whitespace', async () => {
    const { dto, errors } = await validateInput({
      title: 'Dune',
      providers: ` ${MetadataProviderKey.GOOGLE}, ${MetadataProviderKey.OPEN_LIBRARY} ,,${MetadataProviderKey.GOODREADS}`,
    });

    expect(errors).toHaveLength(0);
    expect(dto.providers).toEqual([MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY, MetadataProviderKey.GOODREADS]);
  });

  it('accepts repeated provider query params and trims each item', async () => {
    const { dto, errors } = await validateInput({
      title: 'Dune',
      providers: [`${MetadataProviderKey.GOOGLE}, ${MetadataProviderKey.OPEN_LIBRARY}`, ` ${MetadataProviderKey.GOODREADS} `],
    });

    expect(errors).toHaveLength(0);
    expect(dto.providers).toEqual([MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY, MetadataProviderKey.GOODREADS]);
  });

  it('rejects unknown provider keys after normalization', async () => {
    const { errors } = await validateInput({
      title: 'Dune',
      providers: `${MetadataProviderKey.GOOGLE},unknown-provider`,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'providers',
          constraints: expect.objectContaining({
            isEnum: expect.stringContaining('providers'),
          }),
        }),
      ]),
    );
  });
});
