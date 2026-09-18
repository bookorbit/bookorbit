import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateOpdsUserDto } from './create-opds-user.dto';
import { UpdateOpdsUserDto } from './update-opds-user.dto';

describe('OPDS user DTOs', () => {
  it('accepts valid create and update payloads', async () => {
    const createDto = plainToInstance(CreateOpdsUserDto, {
      username: 'reader-user',
      password: 'password123',
      sortOrder: 'author_asc',
      pageSize: 15,
    });
    const updateDto = plainToInstance(UpdateOpdsUserDto, {
      pageSize: 25,
    });

    expect(await validate(createDto)).toEqual([]);
    expect(await validate(updateDto)).toEqual([]);
  });

  it('rejects invalid create and update payloads', async () => {
    const badCreate = plainToInstance(CreateOpdsUserDto, {
      username: 'ab',
      password: 'short',
      sortOrder: 'invalid_order',
      pageSize: 0,
    });
    const badUpdate = plainToInstance(UpdateOpdsUserDto, {
      pageSize: 101,
    });

    expect((await validate(badCreate)).length).toBeGreaterThan(0);
    expect((await validate(badUpdate)).length).toBeGreaterThan(0);
  });

  it('rejects invalid sort orders independently for each DTO', async () => {
    const badCreate = plainToInstance(CreateOpdsUserDto, {
      username: 'reader-user',
      password: 'password123',
      sortOrder: 'invalid_order',
    });
    const badUpdate = plainToInstance(UpdateOpdsUserDto, {
      sortOrder: 'invalid_order',
    });

    expect(await validate(badCreate)).not.toEqual([]);
    expect(await validate(badUpdate)).not.toEqual([]);
  });

  it('rejects explicit null values for optional settings', async () => {
    const createNullSortOrder = plainToInstance(CreateOpdsUserDto, {
      username: 'reader-user',
      password: 'password123',
      sortOrder: null,
    });
    const createNullPageSize = plainToInstance(CreateOpdsUserDto, {
      username: 'reader-user',
      password: 'password123',
      pageSize: null,
    });
    const updateNullSortOrder = plainToInstance(UpdateOpdsUserDto, { sortOrder: null });
    const updateNullPageSize = plainToInstance(UpdateOpdsUserDto, { pageSize: null });

    expect(await validate(createNullSortOrder)).not.toEqual([]);
    expect(await validate(createNullPageSize)).not.toEqual([]);
    expect(await validate(updateNullSortOrder)).not.toEqual([]);
    expect(await validate(updateNullPageSize)).not.toEqual([]);
  });
});
