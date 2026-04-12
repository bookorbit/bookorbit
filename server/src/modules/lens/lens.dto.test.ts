import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SORT_FIELDS } from '@projectx/types';
import { CreateLensDto } from './dto/create-lens.dto';
import { ReorderLensesDto } from './dto/reorder-lenses.dto';
import { UpdateLensDto } from './dto/update-lens.dto';

async function hasErrors(dto: object): Promise<boolean> {
  return (await validate(dto as never)).length > 0;
}

describe('Lens DTO validation', () => {
  it('CreateLensDto validates sort field and direction', async () => {
    const valid = plainToInstance(CreateLensDto, {
      name: 'My Lens',
      icon: 'Aperture',
      defaultSort: [{ field: SORT_FIELDS[0], dir: 'asc' }],
    });
    expect(await hasErrors(valid)).toBe(false);

    const invalidField = plainToInstance(CreateLensDto, {
      name: 'My Lens',
      icon: 'Aperture',
      defaultSort: [{ field: 'invalid', dir: 'asc' }],
    });
    expect(await hasErrors(invalidField)).toBe(true);

    const invalidDirection = plainToInstance(CreateLensDto, {
      name: 'My Lens',
      icon: 'Aperture',
      defaultSort: [{ field: SORT_FIELDS[0], dir: 'up' }],
    });
    expect(await hasErrors(invalidDirection)).toBe(true);
  });

  it('CreateLensDto requires filter to be an object when provided', async () => {
    expect(await hasErrors(plainToInstance(CreateLensDto, { name: 'Lens', icon: 'Aperture', defaultSort: [], filter: 'bad' }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLensDto, { name: 'Lens', icon: 'Aperture', defaultSort: [], filter: {} }))).toBe(false);
  });

  it('CreateLensDto requires a non-empty icon and UpdateLensDto rejects empty icons when provided', async () => {
    expect(await hasErrors(plainToInstance(CreateLensDto, { name: 'Lens', defaultSort: [] }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLensDto, { name: 'Lens', icon: '   ', defaultSort: [] }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateLensDto, { icon: '   ' }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateLensDto, { icon: null }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateLensDto, { icon: 'Aperture' }))).toBe(false);
  });

  it('UpdateLensDto accepts null filter to clear filters and rejects non-object filters', async () => {
    expect(await hasErrors(plainToInstance(UpdateLensDto, { filter: null }))).toBe(false);
    expect(await hasErrors(plainToInstance(UpdateLensDto, { filter: 'bad' }))).toBe(true);
  });

  it('ReorderLensesDto rejects empty and duplicate IDs and accepts valid order', async () => {
    expect(await hasErrors(plainToInstance(ReorderLensesDto, { order: [] }))).toBe(true);
    expect(
      await hasErrors(
        plainToInstance(ReorderLensesDto, {
          order: [
            { id: 1, displayOrder: 0 },
            { id: 1, displayOrder: 1 },
          ],
        }),
      ),
    ).toBe(true);
    expect(await hasErrors(plainToInstance(ReorderLensesDto, { order: [{ id: 1, displayOrder: 0 }] }))).toBe(false);
  });
});
