import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { FindNextSeriesBookDto } from './find-next-series-book.dto';

describe('FindNextSeriesBookDto', () => {
  it('keeps the query a released iOS build sends valid and leaves DjVu out', async () => {
    const dto = plainToInstance(FindNextSeriesBookDto, { formatGroup: 'cbx' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.includeDjvu).toBeUndefined();
  });

  it('reads the DjVu opt-in from a query string', async () => {
    const dto = plainToInstance(FindNextSeriesBookDto, { formatGroup: 'cbx', includeDjvu: 'true' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.includeDjvu).toBe(true);
  });
});
