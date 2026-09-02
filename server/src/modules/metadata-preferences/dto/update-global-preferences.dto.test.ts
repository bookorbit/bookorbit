import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MetadataProviderKey } from '@bookorbit/types';

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

  it('accepts merge-with-existing for genres only', async () => {
    const genreResult = await validateInput({
      fields: {
        genres: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE],
          mergeStrategy: 'mergeExisting',
        },
      },
    });
    const titleResult = await validateInput({
      fields: {
        title: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE],
          mergeStrategy: 'mergeExisting',
        },
      },
    });

    expect(genreResult.errors).toHaveLength(0);
    expect(titleResult.errors).not.toHaveLength(0);
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
          blocklist: ['Audiobook', 'Adult'],
          maxCount: 3,
        },
        saveProviderIds: true,
        providerIdMode: 'existingOnly',
      },
    });

    expect(errors).toHaveLength(0);
  });

  it('accepts advanced options when the genre blocklist is omitted', async () => {
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
        },
        saveProviderIds: true,
        providerIdMode: 'preferExisting',
      },
    });

    expect(errors).toHaveLength(0);
  });

  it('accepts unlimited genre results when the maximum is null or omitted', async () => {
    const baseInput = {
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
          maxCount: null,
        },
        saveProviderIds: true,
        providerIdMode: 'preferExisting',
      },
    };

    await expect(validateInput(baseInput)).resolves.toMatchObject({ errors: [] });
    delete (baseInput.options.genres as { maxCount?: number | null }).maxCount;
    const { dto, errors } = await validateInput(baseInput);

    expect(errors).toHaveLength(0);
    expect(dto.options?.genres.maxCount).toBeNull();
  });

  it('rejects genre limits outside the supported integer range', async () => {
    const inputFor = (maxCount: number) => ({
      fields: {
        title: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE],
          mergeStrategy: 'fillMissing',
        },
      },
      options: {
        genres: { mode: 'merge', maxCount },
        saveProviderIds: true,
        providerIdMode: 'preferExisting',
      },
    });

    expect((await validateInput(inputFor(0))).errors).not.toHaveLength(0);
    expect((await validateInput(inputFor(2.5))).errors).not.toHaveLength(0);
    expect((await validateInput(inputFor(51))).errors).not.toHaveLength(0);
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
          blocklist: ['ok', 42],
          maxCount: 0,
        },
        saveProviderIds: 'yes',
        providerIdMode: 'unsupported',
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
