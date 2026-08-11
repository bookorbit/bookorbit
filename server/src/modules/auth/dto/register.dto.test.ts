import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RegisterDto } from './register.dto';

const VALID = { username: 'ada_lovelace', name: 'Ada Lovelace', email: 'ada@example.com', password: 'Passw0rd' };

async function failedProperties(overrides: Partial<Record<keyof typeof VALID, string>>): Promise<string[]> {
  const errors = await validate(plainToInstance(RegisterDto, { ...VALID, ...overrides }));
  return errors.map((error) => error.property);
}

describe('RegisterDto', () => {
  it('accepts a plain account', async () => {
    await expect(failedProperties({})).resolves.toEqual([]);
  });

  it.each(['José-García', '夏目漱石', 'Кирилл', 'أحمد', 'ada99', 'user.name', 'ada-lovelace', 'Ada Lovelace'])(
    'accepts the non-spoofing username %s',
    async (username) => {
      await expect(failedProperties({ username })).resolves.toEqual([]);
    },
  );

  it.each([
    ['leading whitespace', ' admin'],
    ['trailing whitespace', 'admin '],
    ['a right-to-left override', 'adm\u202Ein'],
    ['a left-to-right override', 'adm\u202Din'],
    ['a right-to-left isolate', 'adm\u2067in'],
    ['a zero-width space', 'ad\u200Bmin'],
    ['a zero-width joiner', 'ad\u200Dmin'],
    ['a byte order mark', 'ad\uFEFFmin'],
    ['a newline', 'evil\nadmin'],
    ['a carriage return', 'evil\radmin'],
    ['a null byte', 'ad\u0000min'],
    ['a delete control character', 'ad\u007Fmin'],
  ])('rejects a username with %s', async (_label, username) => {
    await expect(failedProperties({ username })).resolves.toEqual(['username']);
  });

  it.each([
    ['leading whitespace', ' Ada'],
    ['trailing whitespace', 'Ada '],
    ['a right-to-left override', 'Ada\u202ELovelace'],
    ['a zero-width space', 'Ada\u200BLovelace'],
    ['a newline', 'Ada\nLovelace'],
  ])('rejects a display name with %s', async (_label, name) => {
    await expect(failedProperties({ name })).resolves.toEqual(['name']);
  });

  it('still enforces the username length bounds', async () => {
    await expect(failedProperties({ username: 'ab' })).resolves.toEqual(['username']);
    await expect(failedProperties({ username: 'a'.repeat(101) })).resolves.toEqual(['username']);
  });

  it('still enforces the password policy', async () => {
    await expect(failedProperties({ password: 'alllowercase1' })).resolves.toEqual(['password']);
    await expect(failedProperties({ password: 'Sh0rt' })).resolves.toEqual(['password']);
  });

  it('still enforces a well-formed email', async () => {
    await expect(failedProperties({ email: 'not-an-email' })).resolves.toEqual(['email']);
  });
});
