import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { GlobalSearchDto } from './global-search.dto';

describe('GlobalSearchDto', () => {
  it('trims the query and transforms numeric options', async () => {
    const dto = plainToInstance(GlobalSearchDto, { q: '  dune  ', limit: '7', libraryId: '3' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ q: 'dune', limit: 7, libraryId: 3 });
  });

  it('rejects short queries and out-of-range limits', async () => {
    const short = plainToInstance(GlobalSearchDto, { q: 'd' });
    const oversized = plainToInstance(GlobalSearchDto, { q: 'dune', limit: '11' });

    expect((await validate(short)).length).toBeGreaterThan(0);
    expect((await validate(oversized)).length).toBeGreaterThan(0);
  });
});
