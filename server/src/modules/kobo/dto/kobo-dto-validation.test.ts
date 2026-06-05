import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateDeviceDto } from './create-device.dto';
import { RenameDeviceDto } from './rename-device.dto';
import { UpdateSettingsDto } from './update-settings.dto';

async function getErrors<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  return validate(plainToInstance(cls, value));
}

describe('Kobo DTO validation', () => {
  it('accepts valid device names and rejects empty or oversized names', async () => {
    expect((await getErrors(CreateDeviceDto, { name: 'My Kobo' })).length).toBe(0);
    expect((await getErrors(RenameDeviceDto, { name: 'Renamed Kobo' })).length).toBe(0);

    expect((await getErrors(CreateDeviceDto, { name: '' })).length).toBeGreaterThan(0);
    expect((await getErrors(RenameDeviceDto, { name: '' })).length).toBeGreaterThan(0);
    expect((await getErrors(CreateDeviceDto, { name: 'x'.repeat(256) })).length).toBeGreaterThan(0);
  });

  it('validates boolean and integer limits in update settings DTO', async () => {
    expect(
      (
        await getErrors(UpdateSettingsDto, {
          convertToKepub: true,
          forceEnableHyphenation: false,
          twoWayProgressSync: true,
          kepubConversionLimitMb: 120,
        })
      ).length,
    ).toBe(0);

    expect((await getErrors(UpdateSettingsDto, { convertToKepub: 'true' })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { forceEnableHyphenation: 'false' })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { twoWayProgressSync: 'true' })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { kepubConversionLimitMb: 0 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { kepubConversionLimitMb: 501 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { kepubConversionLimitMb: 10.5 })).length).toBeGreaterThan(0);
  });

  it('validates readingThreshold and finishedThreshold bounds', async () => {
    expect((await getErrors(UpdateSettingsDto, { readingThreshold: 1 })).length).toBe(0);
    expect((await getErrors(UpdateSettingsDto, { readingThreshold: 0.5 })).length).toBe(0);
    expect((await getErrors(UpdateSettingsDto, { readingThreshold: 10 })).length).toBe(0);
    expect((await getErrors(UpdateSettingsDto, { finishedThreshold: 99 })).length).toBe(0);
    expect((await getErrors(UpdateSettingsDto, { finishedThreshold: 75 })).length).toBe(0);
    expect((await getErrors(UpdateSettingsDto, { finishedThreshold: 100 })).length).toBe(0);

    expect((await getErrors(UpdateSettingsDto, { readingThreshold: 0.4 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { readingThreshold: 10.1 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { finishedThreshold: 74 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { finishedThreshold: 101 })).length).toBeGreaterThan(0);
  });
});
