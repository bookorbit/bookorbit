import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateUserDto } from './dto/create-user.dto';
import { SetPermissionsDto } from './dto/set-permissions.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';

async function hasErrors(dto: object): Promise<boolean> {
  return (await validate(dto as any)).length > 0;
}

describe('User DTO validation', () => {
  it('CreateUserDto enforces username minimum length and string permission names', async () => {
    const bad = plainToInstance(CreateUserDto, { username: 'ab', name: 'n', permissionNames: [1, 2] });
    expect(await hasErrors(bad)).toBe(true);

    const good = plainToInstance(CreateUserDto, {
      username: 'alice',
      name: 'Alice',
      email: 'alice@example.com',
      permissionNames: ['library_download'],
    });
    expect(await hasErrors(good)).toBe(false);
  });

  it('SetPermissionsDto requires an array of strings', async () => {
    expect(await hasErrors(plainToInstance(SetPermissionsDto, { permissionNames: [1, 2] }))).toBe(true);
    expect(await hasErrors(plainToInstance(SetPermissionsDto, { permissionNames: ['library_download'] }))).toBe(false);
    expect(await hasErrors(plainToInstance(SetPermissionsDto, { permissionNames: [] }))).toBe(false);
  });

  it('UpdateMeDto requires settings to be an object when provided', async () => {
    expect(await hasErrors(plainToInstance(UpdateMeDto, { settings: 'bad' }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateMeDto, { settings: { theme: 'dark' } }))).toBe(false);
  });

  it('UpdateUserDto enforces boolean active field', async () => {
    expect(await hasErrors(plainToInstance(UpdateUserDto, { active: 'false' }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateUserDto, { active: false }))).toBe(false);
  });
});
