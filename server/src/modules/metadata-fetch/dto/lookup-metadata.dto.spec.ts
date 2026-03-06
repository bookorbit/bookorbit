import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MetadataProviderKey } from '@projectx/types';

import { LookupMetadataDto } from './lookup-metadata.dto';

describe('LookupMetadataDto', () => {
  it('validates a well-formed lookup request', async () => {
    const dto = plainToInstance(LookupMetadataDto, {
      provider: MetadataProviderKey.GOOGLE,
      id: 'vol-123',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects unknown provider values', async () => {
    const dto = plainToInstance(LookupMetadataDto, {
      provider: 'not-a-provider',
      id: 'vol-123',
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'provider',
          constraints: expect.objectContaining({
            isEnum: expect.stringContaining('provider'),
          }),
        }),
      ]),
    );
  });

  it('requires id to be a non-empty string', async () => {
    const empty = plainToInstance(LookupMetadataDto, {
      provider: MetadataProviderKey.GOOGLE,
      id: '',
    });
    const nonString = plainToInstance(LookupMetadataDto, {
      provider: MetadataProviderKey.GOOGLE,
      id: 123,
    });

    const emptyErrors = await validate(empty);
    const nonStringErrors = await validate(nonString);

    expect(emptyErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'id',
          constraints: expect.objectContaining({
            isNotEmpty: 'id should not be empty',
          }),
        }),
      ]),
    );
    expect(nonStringErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'id',
          constraints: expect.objectContaining({
            isString: 'id must be a string',
          }),
        }),
      ]),
    );
  });
});
