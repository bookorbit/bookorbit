import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListAccountActivityDto } from './list-account-activity.dto';

describe('ListAccountActivityDto', () => {
  it('applies bounded pagination and sort defaults', async () => {
    const dto = plainToInstance(ListAccountActivityDto, {});

    expect(dto).toMatchObject({ page: 1, pageSize: 50, sortBy: 'lastAuthenticatedAt', sortDir: 'desc' });
    expect(await validate(dto)).toEqual([]);
  });

  it('transforms valid query values', async () => {
    const dto = plainToInstance(ListAccountActivityDto, {
      page: '2',
      pageSize: '25',
      state: 'dormant',
      provisioningMethod: 'oidc',
      sortBy: 'lastLoginAt',
      sortDir: 'asc',
    });

    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(25);
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects unbounded pages and unsupported enum values', async () => {
    const dto = plainToInstance(ListAccountActivityDto, { pageSize: 1000, state: 'reading', sortBy: 'passwordHash', sortDir: 'sideways' });

    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
