import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdateUserDto } from './dto/update-user.dto';

async function hasErrors(dto: object): Promise<boolean> {
  return (await validate(dto as any)).length > 0;
}

describe('User DTO validation', () => {
  it('CreateUserDto enforces username minimum length and integer role IDs', async () => {
    const bad = plainToInstance(CreateUserDto, { username: 'ab', name: 'n', roleIds: [1, 'x'] });
    expect(await hasErrors(bad)).toBe(true);

    const good = plainToInstance(CreateUserDto, { username: 'alice', name: 'Alice', email: 'alice@example.com', roleIds: [1, 2] });
    expect(await hasErrors(good)).toBe(false);
  });

  it('AssignRoleDto requires a positive integer roleId', async () => {
    expect(await hasErrors(plainToInstance(AssignRoleDto, { roleId: 0 }))).toBe(true);
    expect(await hasErrors(plainToInstance(AssignRoleDto, { roleId: 3 }))).toBe(false);
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
