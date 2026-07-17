import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { KoreaderDeviceParamDto } from './koreader-device-param.dto';
import { UpdateKoreaderDeviceFilePatternDto, UpdateKoreaderFilePatternDto } from './koreader-file-pattern.dto';

describe('UpdateKoreaderDeviceFilePatternDto', () => {
  it('allows omitted and empty string patterns', async () => {
    await expect(validate(plainToInstance(UpdateKoreaderDeviceFilePatternDto, {}))).resolves.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(UpdateKoreaderDeviceFilePatternDto, {
          pattern: '',
          seriesPattern: '',
          standalonePattern: '',
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it.each(['pattern', 'seriesPattern', 'standalonePattern'] as const)('rejects explicit null for %s', async (property) => {
    const errors = await validate(plainToInstance(UpdateKoreaderDeviceFilePatternDto, { [property]: null }));

    expect(errors.some((error) => error.property === property)).toBe(true);
  });

  it.each(['pattern', 'seriesPattern', 'standalonePattern'] as const)('rejects non-string values for %s', async (property) => {
    const errors = await validate(plainToInstance(UpdateKoreaderDeviceFilePatternDto, { [property]: 123 }));

    expect(errors.some((error) => error.property === property)).toBe(true);
  });

  it.each(['pattern', 'seriesPattern', 'standalonePattern'] as const)('rejects unsafe characters for %s', async (property) => {
    const errors = await validate(plainToInstance(UpdateKoreaderDeviceFilePatternDto, { [property]: '{title}\u0000bad' }));

    expect(errors.some((error) => error.property === property && error.constraints?.isFileNamingPattern)).toBe(true);
  });
});

describe('UpdateKoreaderFilePatternDto', () => {
  it('accepts a valid non-empty pattern', async () => {
    await expect(validate(plainToInstance(UpdateKoreaderFilePatternDto, { pattern: '{authors}/{title}' }))).resolves.toHaveLength(0);
  });

  it.each(['', '{title}\u0000bad', '{authors}\\{title}'])('rejects an invalid account pattern', async (pattern) => {
    const errors = await validate(plainToInstance(UpdateKoreaderFilePatternDto, { pattern }));

    expect(errors.some((error) => error.property === 'pattern')).toBe(true);
  });
});

describe('KoreaderDeviceParamDto', () => {
  it('accepts a bounded device id', async () => {
    await expect(validate(plainToInstance(KoreaderDeviceParamDto, { deviceId: 'device-1' }))).resolves.toHaveLength(0);
  });

  it.each(['', 'device/one', 'device\nlog-entry', 'x'.repeat(101)])('rejects an invalid device id', async (deviceId) => {
    const errors = await validate(plainToInstance(KoreaderDeviceParamDto, { deviceId }));

    expect(errors.some((error) => error.property === 'deviceId')).toBe(true);
  });
});
