import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListUsersDto } from './list-users.dto';

describe('ListUsersDto', () => {
  it('applies bounded pagination and sort defaults', async () => {
    const dto = plainToInstance(ListUsersDto, {});

    expect(dto).toMatchObject({ page: 0, pageSize: 50, sortBy: 'username', sortDir: 'asc' });
    expect(await validate(dto)).toEqual([]);
  });

  it('transforms valid query values', async () => {
    const dto = plainToInstance(ListUsersDto, {
      page: '2',
      pageSize: '25',
      search: 'ada',
      state: 'admins',
      provisioningMethod: 'oidc',
      sortBy: 'createdAt',
      sortDir: 'desc',
    });

    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(25);
    expect(await validate(dto)).toEqual([]);
  });

  it('rejects unbounded page sizes and unsupported enum values', async () => {
    const dto = plainToInstance(ListUsersDto, { pageSize: 1000, state: 'banned', sortBy: 'passwordHash', sortDir: 'sideways' });

    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('rejects negative pages and oversized search terms', async () => {
    const dto = plainToInstance(ListUsersDto, { page: -1, search: 'a'.repeat(101) });

    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
