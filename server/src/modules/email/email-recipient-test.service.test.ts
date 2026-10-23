import { BadRequestException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { EmailProviderResolver } from './email-provider-resolver';
import { EmailRecipientService } from './email-recipient.service';
import { EmailRecipientTestService } from './email-recipient-test.service';
import { EmailTransportService } from './email-transport.service';

describe('EmailRecipientTestService', () => {
  const user: RequestUser = {
    id: 1,
    username: 'reader',
    name: 'Reader',
    email: 'reader@example.com',
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    permissions: [],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
  const config = {
    host: 'smtp.example.com',
    port: 587,
    username: 'u',
    password: 'p',
    fromName: 'BookOrbit',
    fromAddress: 'books@example.com',
    auth: true,
    ssl: false,
    startTls: true,
    tlsRejectUnauthorized: true,
  };

  let recipientService: EmailRecipientService;
  let resolver: EmailProviderResolver;
  let transport: EmailTransportService;
  let sendMail: ReturnType<typeof vi.fn>;
  let service: EmailRecipientTestService;

  beforeEach(() => {
    sendMail = vi.fn().mockResolvedValue({});
    recipientService = {
      getOwnedById: vi.fn().mockResolvedValue({ id: 6, email: 'inbox@example.com', deviceType: null }),
    } as unknown as EmailRecipientService;
    resolver = { resolve: vi.fn().mockResolvedValue({ config, providerId: 2 }) } as unknown as EmailProviderResolver;
    transport = { buildTransporter: vi.fn().mockReturnValue({ sendMail }) } as unknown as EmailTransportService;
    service = new EmailRecipientTestService(recipientService, resolver, transport);
  });

  it('sends the given text from the default server and reports success', async () => {
    const result = await service.send(6, 'BookOrbit test', 'It works.', user);

    expect(recipientService.getOwnedById).toHaveBeenCalledWith(6, user);
    expect(resolver.resolve).toHaveBeenCalledWith(user, null);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'BookOrbit <books@example.com>',
      to: 'inbox@example.com',
      subject: 'BookOrbit test',
      text: 'It works.',
    });
    expect(result).toEqual({ success: true });
  });

  it('answers with the server error instead of throwing', async () => {
    sendMail.mockRejectedValue(new Error('535 Authentication failed'));

    expect(await service.send(6, 'S', 'T', user)).toEqual({ success: false, error: '535 Authentication failed' });
  });

  it('refuses a Kindle, which would answer a message without a document with an error email', async () => {
    (recipientService.getOwnedById as vi.Mock).mockResolvedValue({ id: 7, email: 'x@kindle.com', deviceType: 'kindle' });

    await expect(service.send(7, 'S', 'T', user)).rejects.toThrow(BadRequestException);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('propagates ownership errors before touching the mail server', async () => {
    (recipientService.getOwnedById as vi.Mock).mockRejectedValue(new Error('Cannot modify this recipient'));

    await expect(service.send(6, 'S', 'T', user)).rejects.toThrow('Cannot modify this recipient');
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});
