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
    });
    const updateDto = plainToInstance(UpdateOpdsUserDto, {
      sortOrder: 'series_desc',
    });

    expect(await validate(createDto)).toEqual([]);
    expect(await validate(updateDto)).toEqual([]);
  });

  it('rejects invalid create and update payloads', async () => {
    const badCreate = plainToInstance(CreateOpdsUserDto, {
      username: 'ab',
      password: 'short',
      sortOrder: 'invalid_order',
    });
    const badUpdate = plainToInstance(UpdateOpdsUserDto, {
      sortOrder: 'invalid_order',
    });

    expect((await validate(badCreate)).length).toBeGreaterThan(0);
    expect((await validate(badUpdate)).length).toBeGreaterThan(0);
  });
});
