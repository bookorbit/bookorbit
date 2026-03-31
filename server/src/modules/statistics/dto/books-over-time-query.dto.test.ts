import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BooksOverTimeQueryDto } from './books-over-time-query.dto';

describe('BooksOverTimeQueryDto', () => {
  it('accepts valid granularity and date range values', async () => {
    const dto = plainToInstance(BooksOverTimeQueryDto, {
      granularity: 'monthly',
      range: 'last-5-years',
      libraryIds: ['3', '4'],
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.granularity).toBe('monthly');
    expect(dto.range).toBe('last-5-years');
    expect(dto.libraryIds).toEqual([3, 4]);
  });

  it('accepts omitted optional filters', async () => {
    const dto = plainToInstance(BooksOverTimeQueryDto, {});
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects unsupported granularity values', async () => {
    const dto = plainToInstance(BooksOverTimeQueryDto, { granularity: 'weekly' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.property).toBe('granularity');
  });

  it('rejects unsupported range values', async () => {
    const dto = plainToInstance(BooksOverTimeQueryDto, { range: 'last-month' });
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.property).toBe('range');
  });
});
