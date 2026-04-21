import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SORT_FIELDS } from '@bookorbit/types';
import { CreateSmartScopeDto } from './dto/create-smart-scope.dto';
import { ReorderSmartScopesDto } from './dto/reorder-smart-scopes.dto';
import { UpdateSmartScopeDto } from './dto/update-smart-scope.dto';

async function hasErrors(dto: object): Promise<boolean> {
  return (await validate(dto as never)).length > 0;
}

describe('SmartScope DTO validation', () => {
  it('CreateSmartScopeDto validates sort field and direction', async () => {
    const valid = plainToInstance(CreateSmartScopeDto, {
      name: 'My SmartScope',
      icon: 'Aperture',
      defaultSort: [{ field: SORT_FIELDS[0], dir: 'asc' }],
    });
    expect(await hasErrors(valid)).toBe(false);

    const invalidField = plainToInstance(CreateSmartScopeDto, {
      name: 'My SmartScope',
      icon: 'Aperture',
      defaultSort: [{ field: 'invalid', dir: 'asc' }],
    });
    expect(await hasErrors(invalidField)).toBe(true);

    const invalidDirection = plainToInstance(CreateSmartScopeDto, {
      name: 'My SmartScope',
      icon: 'Aperture',
      defaultSort: [{ field: SORT_FIELDS[0], dir: 'up' }],
    });
    expect(await hasErrors(invalidDirection)).toBe(true);
  });

  it('CreateSmartScopeDto requires filter to be an object when provided', async () => {
    expect(await hasErrors(plainToInstance(CreateSmartScopeDto, { name: 'SmartScope', icon: 'Aperture', defaultSort: [], filter: 'bad' }))).toBe(
      true,
    );
    expect(await hasErrors(plainToInstance(CreateSmartScopeDto, { name: 'SmartScope', icon: 'Aperture', defaultSort: [], filter: {} }))).toBe(false);
  });

  it('CreateSmartScopeDto requires a non-empty icon and UpdateSmartScopeDto rejects empty icons when provided', async () => {
    expect(await hasErrors(plainToInstance(CreateSmartScopeDto, { name: 'SmartScope', defaultSort: [] }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateSmartScopeDto, { name: 'SmartScope', icon: '   ', defaultSort: [] }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateSmartScopeDto, { icon: '   ' }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateSmartScopeDto, { icon: null }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateSmartScopeDto, { icon: 'Aperture' }))).toBe(false);
  });

  it('UpdateSmartScopeDto accepts null filter to clear filters and rejects non-object filters', async () => {
    expect(await hasErrors(plainToInstance(UpdateSmartScopeDto, { filter: null }))).toBe(false);
    expect(await hasErrors(plainToInstance(UpdateSmartScopeDto, { filter: 'bad' }))).toBe(true);
  });

  it('ReorderSmartScopesDto rejects empty and duplicate IDs and accepts valid order', async () => {
    expect(await hasErrors(plainToInstance(ReorderSmartScopesDto, { order: [] }))).toBe(true);
    expect(
      await hasErrors(
        plainToInstance(ReorderSmartScopesDto, {
          order: [
            { id: 1, displayOrder: 0 },
            { id: 1, displayOrder: 1 },
          ],
        }),
      ),
    ).toBe(true);
    expect(await hasErrors(plainToInstance(ReorderSmartScopesDto, { order: [{ id: 1, displayOrder: 0 }] }))).toBe(false);
  });
});
