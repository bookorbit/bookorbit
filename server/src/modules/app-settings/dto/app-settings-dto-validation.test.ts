import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateAppSettingDto } from './update-app-setting.dto';
import { UpdateFilePatternDto } from './update-file-pattern.dto';
import { UpdateOidcConfigDto } from './update-oidc-config.dto';

async function errorsFor<T extends object>(cls: new () => T, input: Record<string, unknown>) {
  return validate(plainToInstance(cls, input));
}

describe('App settings DTO validation', () => {
  it('validates update-app-setting payload value as required non-empty string', async () => {
    expect((await errorsFor(UpdateAppSettingDto, { value: 'enabled' })).length).toBe(0);
    expect((await errorsFor(UpdateAppSettingDto, { value: '' })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateAppSettingDto, { value: 123 })).length).toBeGreaterThan(0);
  });

  it('accepts valid file patterns and rejects invalid characters', async () => {
    expect((await errorsFor(UpdateFilePatternDto, { pattern: '{author}/{title}' })).length).toBe(0);
    expect((await errorsFor(UpdateFilePatternDto, { pattern: '@@@' })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateFilePatternDto, { pattern: 'x'.repeat(501) })).length).toBeGreaterThan(0);
  });

  it('validates nested OIDC claimMapping and autoProvision fields', async () => {
    expect(
      (
        await errorsFor(UpdateOidcConfigDto, {
          enabled: true,
          providerName: 'Keycloak',
          issuerUri: 'https://id.example.com/realms/main',
          clientId: 'projectx',
          clientSecret: 'secret',
          scopes: 'openid profile email',
          claimMapping: {
            username: 'preferred_username',
            name: 'name',
            email: 'email',
            groups: 'groups',
          },
          autoProvision: {
            enabled: true,
            allowLocalLinking: false,
            defaultPermissionNames: ['library_download'],
          },
        })
      ).length,
    ).toBe(0);

    const invalid = await errorsFor(UpdateOidcConfigDto, {
      enabled: 'true',
      claimMapping: {
        username: 'preferred_username',
        name: 123,
      },
      autoProvision: {
        enabled: true,
        allowLocalLinking: 'yes',
        defaultPermissionNames: [1, 2],
      },
    });

    expect(invalid.length).toBeGreaterThan(0);
    expect(invalid.map((err) => err.property)).toEqual(expect.arrayContaining(['enabled', 'claimMapping', 'autoProvision']));
  });
});
