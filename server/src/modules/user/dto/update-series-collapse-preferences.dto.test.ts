import 'reflect-metadata';

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateSeriesCollapsePreferencesDto } from './update-series-collapse-preferences.dto';

function toDto(plain: Record<string, unknown>): UpdateSeriesCollapsePreferencesDto {
  return plainToInstance(UpdateSeriesCollapsePreferencesDto, plain);
}

describe('UpdateSeriesCollapsePreferencesDto', () => {
  it('accepts valid boolean global', async () => {
    const dto = toDto({ global: true });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts valid boolean libraries', async () => {
    const dto = toDto({ libraries: { '1': true, '2': false } });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts null values in libraries for deletion', async () => {
    const dto = toDto({ libraries: { '1': null, '2': true } });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts null values in collections for deletion', async () => {
    const dto = toDto({ collections: { '5': null } });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts smart scope overrides', async () => {
    const dto = toDto({ smartScopes: { '8': true, '9': null } });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects non-boolean/non-null values in libraries', async () => {
    const dto = toDto({ libraries: { '1': 'yes' } });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects number values in collections', async () => {
    const dto = toDto({ collections: { '1': 42 } });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-boolean values in smart scope overrides', async () => {
    const dto = toDto({ smartScopes: { '8': 'yes' } });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects array for libraries', async () => {
    const dto = toDto({ libraries: [true, false] });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts empty dto (all optional)', async () => {
    const dto = toDto({});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects non-boolean global', async () => {
    const dto = toDto({ global: 'true' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
