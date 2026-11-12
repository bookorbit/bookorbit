import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { KOREADER_DEVICE_NAME_MAX_LENGTH } from '@bookorbit/types';
import { UpdateKoreaderDeviceNameDto } from './koreader-device-param.dto';

function toDto(value: unknown) {
  return plainToInstance(UpdateKoreaderDeviceNameDto, value);
}

describe('UpdateKoreaderDeviceNameDto', () => {
  it('trims the name it accepts', async () => {
    const dto = toDto({ name: '  Pixel 8  ' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.name).toBe('Pixel 8');
  });

  it('accepts a name at the length limit, in any script', async () => {
    await expect(validate(toDto({ name: 'x'.repeat(KOREADER_DEVICE_NAME_MAX_LENGTH) }))).resolves.toHaveLength(0);
    await expect(validate(toDto({ name: 'Liseuse du salon' }))).resolves.toHaveLength(0);
    await expect(validate(toDto({ name: 'Kindle de María' }))).resolves.toHaveLength(0);
    await expect(validate(toDto({ name: '寝室のタブレット' }))).resolves.toHaveLength(0);
  });

  it.each([
    ['missing', {}],
    ['empty', { name: '' }],
    ['blank', { name: '   ' }],
    ['too long', { name: 'x'.repeat(KOREADER_DEVICE_NAME_MAX_LENGTH + 1) }],
    ['a line break', { name: 'Pixel\n8' }],
    ['a NUL', { name: 'Pixel\u00008' }],
    ['not a string', { name: 8 }],
  ])('rejects a name that is %s', async (_label, value) => {
    const errors = await validate(toDto(value));

    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });
});
