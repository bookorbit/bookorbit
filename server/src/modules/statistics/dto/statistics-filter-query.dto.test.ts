import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { StatisticsFilterQueryDto } from './statistics-filter-query.dto';

describe('StatisticsFilterQueryDto', () => {
  it('coerces a single libraryId query value into a numeric array', async () => {
    const dto = plainToInstance(StatisticsFilterQueryDto, { libraryIds: '12' });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.libraryIds).toEqual([12]);
  });

  it('coerces repeated query values into number array', async () => {
    const dto = plainToInstance(StatisticsFilterQueryDto, { libraryIds: ['5', '8'] });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.libraryIds).toEqual([5, 8]);
  });

  it('keeps libraryIds undefined when omitted', async () => {
    const dto = plainToInstance(StatisticsFilterQueryDto, {});
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.libraryIds).toBeUndefined();
  });

  it('rejects non-integer library ids after transformation', async () => {
    const dto = plainToInstance(StatisticsFilterQueryDto, { libraryIds: ['1.5', 'abc'] });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.property).toBe('libraryIds');
  });
});
