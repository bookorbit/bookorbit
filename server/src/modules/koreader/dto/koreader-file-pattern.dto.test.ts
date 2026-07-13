import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateKoreaderDeviceFilePatternDto } from './koreader-file-pattern.dto';

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
});
