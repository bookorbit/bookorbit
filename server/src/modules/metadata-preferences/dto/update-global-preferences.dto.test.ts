import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MetadataProviderKey } from '@projectx/types';

import { UpdateGlobalPreferencesDto } from './update-global-preferences.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(UpdateGlobalPreferencesDto, input);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('UpdateGlobalPreferencesDto', () => {
  it('accepts a valid field preferences map', async () => {
    const { errors } = await validateInput({
      fields: {
        title: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
          mergeStrategy: 'fillMissing',
        },
        authors: {
          enabled: false,
          providers: [MetadataProviderKey.GOODREADS],
          mergeStrategy: 'overwriteIfProvided',
        },
      },
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects non-object fields payloads', async () => {
    const { errors } = await validateInput({ fields: [] as unknown[] });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'fields',
          constraints: expect.objectContaining({
            isFieldPreferencesMap: 'fields must be a valid map of field preferences',
          }),
        }),
      ]),
    );
  });

  it('rejects unknown metadata fields', async () => {
    const { errors } = await validateInput({
      fields: {
        notAField: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE],
          mergeStrategy: 'overwrite',
        },
      },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'fields',
          constraints: expect.objectContaining({
            isFieldPreferencesMap: 'fields must be a valid map of field preferences',
          }),
        }),
      ]),
    );
  });

  it('rejects invalid nested provider keys or merge strategies', async () => {
    const { errors } = await validateInput({
      fields: {
        title: {
          enabled: true,
          providers: ['unsupported-provider'],
          mergeStrategy: 'replace',
        },
      },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'fields',
          constraints: expect.objectContaining({
            isFieldPreferencesMap: 'fields must be a valid map of field preferences',
          }),
        }),
      ]),
    );
  });

  it('accepts valid advanced options', async () => {
    const { errors } = await validateInput({
      fields: {
        title: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE],
          mergeStrategy: 'fillMissing',
        },
      },
      options: {
        genres: {
          mode: 'merge',
          providerScope: 'allConfiguredProviders',
        },
        saveProviderIds: true,
      },
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid advanced options', async () => {
    const { errors } = await validateInput({
      fields: {
        title: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE],
          mergeStrategy: 'fillMissing',
        },
      },
      options: {
        genres: {
          mode: 'invalid',
          providerScope: 'invalid',
        },
        saveProviderIds: 'yes',
      },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'options',
        }),
      ]),
    );
  });
});
