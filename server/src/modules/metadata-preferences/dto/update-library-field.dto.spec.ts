import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MetadataProviderKey } from '@projectx/types';

import { UpdateLibraryFieldDto } from './update-library-field.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(UpdateLibraryFieldDto, input);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('UpdateLibraryFieldDto', () => {
  it('accepts valid override payloads', async () => {
    const { dto, errors } = await validateInput({
      enabled: true,
      providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
      mergeStrategy: 'overwriteIfProvided',
    });

    expect(errors).toHaveLength(0);
    expect(dto.providers).toEqual([MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY]);
  });

  it('rejects invalid provider keys', async () => {
    const { errors } = await validateInput({
      enabled: true,
      providers: [MetadataProviderKey.GOOGLE, 'unknown-provider'],
      mergeStrategy: 'overwrite',
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'providers',
          constraints: expect.objectContaining({
            isIn: expect.stringContaining('providers'),
          }),
        }),
      ]),
    );
  });

  it('rejects non-array providers and unsupported merge strategy', async () => {
    const { errors } = await validateInput({
      enabled: true,
      providers: MetadataProviderKey.GOOGLE,
      mergeStrategy: 'replace',
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'providers',
          constraints: expect.objectContaining({
            isArray: 'providers must be an array',
          }),
        }),
        expect.objectContaining({
          property: 'mergeStrategy',
          constraints: expect.objectContaining({
            isIn: expect.stringContaining('mergeStrategy'),
          }),
        }),
      ]),
    );
  });
});
