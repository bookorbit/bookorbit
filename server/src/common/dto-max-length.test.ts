import 'reflect-metadata';
import { validate } from 'class-validator';

import { ChangePasswordDto } from '../modules/auth/dto/change-password.dto';
import { LoginDto } from '../modules/auth/dto/login.dto';
import { OidcCallbackDto } from '../modules/auth/dto/oidc-callback.dto';
import { RegisterDto } from '../modules/auth/dto/register.dto';
import { ResetPasswordDto } from '../modules/auth/dto/reset-password.dto';
import { SetupDto } from '../modules/auth/dto/setup.dto';
import { CreateEmailProviderDto } from '../modules/email/dto/create-email-provider.dto';
import { CreateEmailRecipientDto } from '../modules/email/dto/create-email-recipient.dto';
import { CreateEmailRecipientGroupDto } from '../modules/email/dto/create-email-recipient-group.dto';
import { CreateEmailTemplateDto } from '../modules/email/dto/create-email-template.dto';
import { UpdateOidcConfigDto } from '../modules/app-settings/dto/update-oidc-config.dto';
import { UpdateMeDto } from '../modules/user/dto/update-me.dto';
import { CreateUserDto } from '../modules/user/dto/create-user.dto';
import { PrescanLibraryDto } from '../modules/library/dto/prescan-library.dto';
import { SearchBooksDto } from '../modules/book/dto/search-books.dto';

async function hasError(dto: object, property: string, constraint: string): Promise<boolean> {
  const errors = await validate(dto);
  return errors.some((e) => e.property === property && Object.keys(e.constraints ?? {}).some((k) => k.includes(constraint)));
}

describe('SEC-027 — @MaxLength enforcement on DTO string fields', () => {
  describe('LoginDto', () => {
    it('rejects username longer than 100 chars', async () => {
      const dto = Object.assign(new LoginDto(), { username: 'a'.repeat(101), password: 'secret' });
      expect(await hasError(dto, 'username', 'maxLength')).toBe(true);
    });

    it('rejects password longer than 1024 chars', async () => {
      const dto = Object.assign(new LoginDto(), { username: 'user', password: 'x'.repeat(1025) });
      expect(await hasError(dto, 'password', 'maxLength')).toBe(true);
    });

    it('accepts a valid login payload', async () => {
      const dto = Object.assign(new LoginDto(), { username: 'user', password: 'secret' });
      expect(await validate(dto)).toHaveLength(0);
    });
  });

  describe('ChangePasswordDto', () => {
    it('rejects currentPassword longer than 1024 chars', async () => {
      const dto = Object.assign(new ChangePasswordDto(), { currentPassword: 'x'.repeat(1025), newPassword: 'Valid1pass' });
      expect(await hasError(dto, 'currentPassword', 'maxLength')).toBe(true);
    });

    it('rejects newPassword longer than 1024 chars', async () => {
      const dto = Object.assign(new ChangePasswordDto(), { currentPassword: 'valid', newPassword: 'Aa1' + 'x'.repeat(1022) });
      expect(await hasError(dto, 'newPassword', 'maxLength')).toBe(true);
    });
  });

  describe('ResetPasswordDto', () => {
    it('rejects token longer than 512 chars', async () => {
      const dto = Object.assign(new ResetPasswordDto(), { token: 't'.repeat(513), newPassword: 'Valid1pass' });
      expect(await hasError(dto, 'token', 'maxLength')).toBe(true);
    });
  });

  describe('SetupDto', () => {
    it('rejects username longer than 100 chars', async () => {
      const dto = Object.assign(new SetupDto(), { username: 'a'.repeat(101), name: 'N', email: 'a@b.com', password: 'Pass1word' });
      expect(await hasError(dto, 'username', 'maxLength')).toBe(true);
    });

    it('rejects name longer than 255 chars', async () => {
      const dto = Object.assign(new SetupDto(), { username: 'admin', name: 'n'.repeat(256), email: 'a@b.com', password: 'Pass1word' });
      expect(await hasError(dto, 'name', 'maxLength')).toBe(true);
    });
  });

  describe('RegisterDto', () => {
    it('rejects username longer than 100 chars', async () => {
      const dto = Object.assign(new RegisterDto(), { username: 'a'.repeat(101), name: 'N', email: 'a@b.com', password: 'Pass1word' });
      expect(await hasError(dto, 'username', 'maxLength')).toBe(true);
    });
  });

  describe('OidcCallbackDto', () => {
    it('rejects code longer than 2048 chars', async () => {
      const dto = Object.assign(new OidcCallbackDto(), {
        code: 'x'.repeat(2049),
        codeVerifier: 'v',
        redirectUri: 'https://a.com',
        nonce: 'n',
        state: 's',
      });
      expect(await hasError(dto, 'code', 'maxLength')).toBe(true);
    });

    it('rejects state longer than 512 chars', async () => {
      const dto = Object.assign(new OidcCallbackDto(), {
        code: 'c',
        codeVerifier: 'v',
        redirectUri: 'https://a.com',
        nonce: 'n',
        state: 's'.repeat(513),
      });
      expect(await hasError(dto, 'state', 'maxLength')).toBe(true);
    });
  });

  describe('UpdateOidcConfigDto', () => {
    it('rejects providerName longer than 100 chars', async () => {
      const dto = Object.assign(new UpdateOidcConfigDto(), { providerName: 'p'.repeat(101) });
      expect(await hasError(dto, 'providerName', 'maxLength')).toBe(true);
    });

    it('rejects issuerUri longer than 2048 chars', async () => {
      const dto = Object.assign(new UpdateOidcConfigDto(), { issuerUri: 'https://auth.example.com/' + 'x'.repeat(2025) });
      expect(await hasError(dto, 'issuerUri', 'maxLength')).toBe(true);
    });

    it('rejects clientSecret longer than 1024 chars', async () => {
      const dto = Object.assign(new UpdateOidcConfigDto(), { clientSecret: 's'.repeat(1025) });
      expect(await hasError(dto, 'clientSecret', 'maxLength')).toBe(true);
    });
  });

  describe('CreateEmailTemplateDto', () => {
    it('rejects name longer than 255 chars', async () => {
      const dto = Object.assign(new CreateEmailTemplateDto(), { name: 'n'.repeat(256), subject: 'sub', bodyText: 'body' });
      expect(await hasError(dto, 'name', 'maxLength')).toBe(true);
    });

    it('rejects subject longer than 998 chars', async () => {
      const dto = Object.assign(new CreateEmailTemplateDto(), { name: 'template', subject: 's'.repeat(999), bodyText: 'body' });
      expect(await hasError(dto, 'subject', 'maxLength')).toBe(true);
    });

    it('accepts valid template data', async () => {
      const dto = Object.assign(new CreateEmailTemplateDto(), { name: 'Welcome', subject: 'Hello', bodyText: '<p>Hi</p>' });
      expect(await validate(dto)).toHaveLength(0);
    });
  });

  describe('CreateEmailRecipientDto', () => {
    it('rejects name longer than 255 chars', async () => {
      const dto = Object.assign(new CreateEmailRecipientDto(), { name: 'n'.repeat(256), email: 'a@b.com' });
      expect(await hasError(dto, 'name', 'maxLength')).toBe(true);
    });

    it('accepts a valid recipient', async () => {
      const dto = Object.assign(new CreateEmailRecipientDto(), { name: 'Alice', email: 'alice@example.com' });
      expect(await validate(dto)).toHaveLength(0);
    });
  });

  describe('CreateEmailRecipientGroupDto', () => {
    it('rejects group name longer than 255 chars', async () => {
      const dto = Object.assign(new CreateEmailRecipientGroupDto(), { name: 'g'.repeat(256) });
      expect(await hasError(dto, 'name', 'maxLength')).toBe(true);
    });
  });

  describe('CreateEmailProviderDto', () => {
    it('rejects host longer than 253 chars', async () => {
      const dto = Object.assign(new CreateEmailProviderDto(), {
        name: 'SMTP',
        host: 'h'.repeat(254),
        port: 587,
        auth: false,
        ssl: false,
        startTls: false,
      });
      expect(await hasError(dto, 'host', 'maxLength')).toBe(true);
    });

    it('rejects password longer than 1024 chars', async () => {
      const dto = Object.assign(new CreateEmailProviderDto(), {
        name: 'SMTP',
        host: 'smtp.example.com',
        port: 587,
        password: 'p'.repeat(1025),
        auth: true,
        ssl: false,
        startTls: true,
      });
      expect(await hasError(dto, 'password', 'maxLength')).toBe(true);
    });
  });

  describe('UpdateMeDto', () => {
    it('rejects name longer than 255 chars', async () => {
      const dto = Object.assign(new UpdateMeDto(), { name: 'n'.repeat(256) });
      expect(await hasError(dto, 'name', 'maxLength')).toBe(true);
    });

    it('accepts a valid name update', async () => {
      const dto = Object.assign(new UpdateMeDto(), { name: 'Alice' });
      expect(await validate(dto)).toHaveLength(0);
    });
  });

  describe('CreateUserDto', () => {
    it('rejects username longer than 100 chars', async () => {
      const dto = Object.assign(new CreateUserDto(), { username: 'u'.repeat(101), name: 'Alice', email: 'a@b.com' });
      expect(await hasError(dto, 'username', 'maxLength')).toBe(true);
    });

    it('rejects name longer than 255 chars', async () => {
      const dto = Object.assign(new CreateUserDto(), { username: 'alice', name: 'n'.repeat(256), email: 'a@b.com' });
      expect(await hasError(dto, 'name', 'maxLength')).toBe(true);
    });
  });

  describe('PrescanLibraryDto', () => {
    it('rejects a path longer than 4096 chars', async () => {
      const dto = Object.assign(new PrescanLibraryDto(), { paths: ['/' + 'a'.repeat(4096)] });
      expect(await hasError(dto, 'paths', 'maxLength')).toBe(true);
    });

    it('accepts valid short paths', async () => {
      const dto = Object.assign(new PrescanLibraryDto(), { paths: ['/books/library'] });
      expect(await validate(dto)).toHaveLength(0);
    });
  });

  describe('SearchBooksDto', () => {
    it('rejects q longer than 500 chars', async () => {
      const dto = Object.assign(new SearchBooksDto(), { q: 'a'.repeat(501) });
      expect(await hasError(dto, 'q', 'maxLength')).toBe(true);
    });

    it('accepts a valid search query', async () => {
      const dto = Object.assign(new SearchBooksDto(), { q: 'Dune' });
      expect(await validate(dto)).toHaveLength(0);
    });
  });
});

describe('SEC-030 — UpdateMeDto does not accept email field', () => {
  it('UpdateMeDto does not declare an email property', () => {
    const dto = new UpdateMeDto();
    expect('email' in dto).toBe(false);
  });

  it('class-validator forbids unknown email field when whitelist+forbidNonWhitelisted are active', async () => {
    const { validateOrReject } = await import('class-validator');
    const dto = Object.assign(new UpdateMeDto(), { email: 'hacker@evil.com' });
    await expect(validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true })).rejects.toBeDefined();
  });
});
