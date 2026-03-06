import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AddGroupMemberDto } from './add-group-member.dto';
import { CreateEmailProviderDto } from './create-email-provider.dto';
import { CreateEmailRecipientGroupDto } from './create-email-recipient-group.dto';
import { CreateEmailRecipientDto } from './create-email-recipient.dto';
import { CreateEmailTemplateDto } from './create-email-template.dto';
import { PreviewTemplateDto } from './preview-template.dto';
import { QuerySendLogDto } from './query-send-log.dto';
import { RECIPIENT_DEVICE_TYPES, RECIPIENT_FORMATS } from './email-recipient.constants';
import { SendBookDto } from './send-book.dto';
import { UpdateEmailPreferencesDto } from './update-email-preferences.dto';
import { UpdateEmailProviderDto } from './update-email-provider.dto';
import { UpdateEmailRecipientGroupDto } from './update-email-recipient-group.dto';
import { UpdateEmailRecipientDto } from './update-email-recipient.dto';
import { UpdateEmailTemplateDto } from './update-email-template.dto';

async function errorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  const dto = plainToInstance(cls, value);
  return validate(dto);
}

describe('Email DTO validation', () => {
  it('validates AddGroupMemberDto and PreviewTemplateDto integer ids', async () => {
    expect((await errorsFor(AddGroupMemberDto, { recipientId: 5 })).length).toBe(0);
    expect((await errorsFor(AddGroupMemberDto, { recipientId: 'x' })).length).toBeGreaterThan(0);

    expect((await errorsFor(PreviewTemplateDto, { bookId: 2 })).length).toBe(0);
    expect((await errorsFor(PreviewTemplateDto, { bookId: '2' })).length).toBeGreaterThan(0);
  });

  it('enforces SMTP provider port bounds and auth booleans', async () => {
    expect(
      (
        await errorsFor(CreateEmailProviderDto, {
          name: 'SMTP',
          host: 'smtp.example.com',
          port: 1,
          auth: true,
          ssl: false,
          startTls: true,
        })
      ).length,
    ).toBe(0);

    expect(
      (
        await errorsFor(CreateEmailProviderDto, {
          name: 'SMTP',
          host: 'smtp.example.com',
          port: 65536,
          auth: true,
          ssl: false,
          startTls: true,
        })
      ).length,
    ).toBeGreaterThan(0);

    expect((await errorsFor(UpdateEmailProviderDto, { port: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateEmailProviderDto, { port: 2525, auth: false })).length).toBe(0);
  });

  it('enforces recipient enums and allows null resets on update', async () => {
    expect(
      (
        await errorsFor(CreateEmailRecipientDto, {
          name: 'Kindle',
          email: 'kindle@example.com',
          deviceType: RECIPIENT_DEVICE_TYPES[0],
          preferredFormat: RECIPIENT_FORMATS[0],
        })
      ).length,
    ).toBe(0);

    expect(
      (
        await errorsFor(CreateEmailRecipientDto, {
          name: 'Bad Device',
          email: 'kindle@example.com',
          deviceType: 'ipad',
        })
      ).length,
    ).toBeGreaterThan(0);

    expect((await errorsFor(UpdateEmailRecipientDto, { deviceType: null, preferredFormat: null })).length).toBe(0);
    expect((await errorsFor(UpdateEmailRecipientDto, { preferredFormat: 'docx' })).length).toBeGreaterThan(0);
  });

  it('validates group/template DTO string and integer constraints', async () => {
    expect((await errorsFor(CreateEmailRecipientGroupDto, { name: 'My Group', defaultTemplateId: 3 })).length).toBe(0);
    expect((await errorsFor(CreateEmailRecipientGroupDto, { name: 99 })).length).toBeGreaterThan(0);

    expect((await errorsFor(UpdateEmailRecipientGroupDto, { defaultTemplateId: null })).length).toBe(0);
    expect((await errorsFor(UpdateEmailRecipientGroupDto, { name: 123 })).length).toBeGreaterThan(0);

    expect((await errorsFor(CreateEmailTemplateDto, { name: 'N', subject: 'S', bodyText: 'B' })).length).toBe(0);
    expect((await errorsFor(UpdateEmailTemplateDto, { subject: 10 })).length).toBeGreaterThan(0);
  });

  it('coerces query pagination strings and rejects invalid values', async () => {
    const valid = plainToInstance(QuerySendLogDto, { page: '2', size: '50' });
    const validErrors = await validate(valid);

    expect(validErrors.length).toBe(0);
    expect(valid.page).toBe(2);
    expect(valid.size).toBe(50);

    expect((await errorsFor(QuerySendLogDto, { page: -1, size: 0 })).length).toBeGreaterThan(0);
  });

  it('requires at least one book and integer collections for send requests', async () => {
    expect((await errorsFor(SendBookDto, { bookIds: [1], recipientIds: [2], groupIds: [3], providerId: 4, templateId: 5, fileId: 6 })).length).toBe(
      0,
    );
    expect((await errorsFor(SendBookDto, { bookIds: [] })).length).toBeGreaterThan(0);
    expect((await errorsFor(SendBookDto, { bookIds: [1], recipientIds: ['x'] })).length).toBeGreaterThan(0);
  });

  it('allows null preference ids but rejects non-integer values', async () => {
    expect(
      (
        await errorsFor(UpdateEmailPreferencesDto, {
          defaultProviderId: null,
          defaultRecipientId: null,
          defaultTemplateId: null,
        })
      ).length,
    ).toBe(0);

    expect((await errorsFor(UpdateEmailPreferencesDto, { defaultProviderId: 'abc' })).length).toBeGreaterThan(0);
  });
});
