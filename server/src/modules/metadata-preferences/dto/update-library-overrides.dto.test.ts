import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MetadataProviderKey } from '@projectx/types';

import { UpdateLibraryOverridesDto } from './update-library-overrides.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(UpdateLibraryOverridesDto, input);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('UpdateLibraryOverridesDto', () => {
  it('accepts an empty overrides object', async () => {
    const { errors } = await validateInput({ overrides: {} });
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid partial field overrides map', async () => {
    const { errors } = await validateInput({
      overrides: {
        title: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
          mergeStrategy: 'fillMissing',
        },
        authors: {
          enabled: false,
          providers: [],
          mergeStrategy: 'overwrite',
        },
      },
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects overrides with an unknown field key', async () => {
    const { errors } = await validateInput({
      overrides: {
        'not-a-real-field': {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE],
          mergeStrategy: 'overwrite',
        },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects overrides with an invalid provider key inside a known field', async () => {
    const { errors } = await validateInput({
      overrides: {
        title: {
          enabled: true,
          providers: ['not-a-provider'],
          mergeStrategy: 'fillMissing',
        },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects overrides that is not an object', async () => {
    const { errors } = await validateInput({ overrides: 'invalid' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
