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

  it('validates threshold ranges and integer limits in update settings DTO', async () => {
    expect(
      (
        await getErrors(UpdateSettingsDto, {
          readingThreshold: 2.5,
          finishedThreshold: 95,
          convertToKepub: true,
          twoWayProgressSync: true,
          forceEnableHyphenation: false,
          kepubConversionLimitMb: 120,
        })
      ).length,
    ).toBe(0);

    expect((await getErrors(UpdateSettingsDto, { readingThreshold: 0.49 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { readingThreshold: 10.01 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { finishedThreshold: 74 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { finishedThreshold: 101 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { convertToKepub: 'true' })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { kepubConversionLimitMb: 0 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { kepubConversionLimitMb: 501 })).length).toBeGreaterThan(0);
    expect((await getErrors(UpdateSettingsDto, { kepubConversionLimitMb: 10.5 })).length).toBeGreaterThan(0);
  });
});
