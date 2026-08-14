import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateBookDockSettingsDto } from './update-book-dock-settings.dto';

const validSettings = {
  autoFetchMetadata: true,
  autoFinalizeEnabled: false,
  autoFinalizeThreshold: 85,
  autoFinalizeLibraryId: null,
  autoFinalizeFolderId: null,
  autoFinalizeMetadataMode: 'safe_merge',
};

async function errorsFor(overrides: Record<string, unknown> = {}) {
  return validate(plainToInstance(UpdateBookDockSettingsDto, { ...validSettings, ...overrides }));
}

describe('UpdateBookDockSettingsDto', () => {
  it('accepts the complete valid settings shape', async () => {
    await expect(errorsFor()).resolves.toHaveLength(0);
    await expect(
      errorsFor({
        autoFinalizeThreshold: 100,
        autoFinalizeLibraryId: 3,
        autoFinalizeFolderId: 9,
        autoFinalizeMetadataMode: 'embedded_only',
      }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    ['autoFetchMetadata', 'true'],
    ['autoFinalizeEnabled', 1],
    ['autoFinalizeThreshold', 49],
    ['autoFinalizeThreshold', 101],
    ['autoFinalizeThreshold', 85.5],
    ['autoFinalizeLibraryId', 0],
    ['autoFinalizeFolderId', -1],
    ['autoFinalizeMetadataMode', 'replace_all'],
  ])('rejects invalid %s values', async (field, value) => {
    const errors = await errorsFor({ [field]: value });
    expect(errors.map((error) => error.property)).toContain(field);
  });

  it.each(Object.keys(validSettings))('requires %s', async (field) => {
    const input = { ...validSettings } as Record<string, unknown>;
    delete input[field];
    const errors = await validate(plainToInstance(UpdateBookDockSettingsDto, input));
    expect(errors.map((error) => error.property)).toContain(field);
  });
});
