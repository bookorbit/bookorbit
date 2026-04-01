import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { EmailEncryptionService } from './email-encryption.service';
import { EmailProviderRepository } from './email-provider.repository';
import { EmailTransportService } from './email-transport.service';
import { SystemMailService } from './system-mail.service';

describe('SystemMailService', () => {
  let service: SystemMailService;
  let repo: { findSystemProvider: ReturnType<typeof vi.fn> };
  let encryption: { decrypt: ReturnType<typeof vi.fn> };
  let transport: { buildTransporter: ReturnType<typeof vi.fn> };
  let config: { get: ReturnType<typeof vi.fn> };
  let transporter: { sendMail: ReturnType<typeof vi.fn> };

  const provider = {
    id: 3,
    host: 'smtp.example.com',
    port: 587,
    username: 'smtp-user',
    passwordEnc: 'enc-password',
    auth: true,
    ssl: false,
    startTls: true,
    fromName: 'Project X',
    fromAddress: 'no-reply@example.com',
  };

  beforeEach(async () => {
    transporter = {
      sendMail: vi.fn().mockResolvedValue({ messageId: 'abc123' }),
    };
    repo = {
      findSystemProvider: vi.fn().mockResolvedValue([provider]),
    };
    encryption = {
      decrypt: vi.fn().mockReturnValue('decrypted-password'),
    };
    transport = {
      buildTransporter: vi.fn().mockReturnValue(transporter),
    };
    config = {
      get: vi.fn((key: string) => {
        if (key === 'app.appUrl') return 'http://localhost:3000/';
        if (key === 'app.nodeEnv') return 'test';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemMailService,
        { provide: EmailProviderRepository, useValue: repo },
        { provide: EmailEncryptionService, useValue: encryption },
        { provide: EmailTransportService, useValue: transport },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<SystemMailService>(SystemMailService);
  });

  it('reports configured when a system provider exists', async () => {
    await expect(service.isConfigured()).resolves.toBe(true);
  });

  it('reports not configured when no system provider exists', async () => {
    repo.findSystemProvider.mockResolvedValue([]);
    await expect(service.isConfigured()).resolves.toBe(false);
  });

  it('sends a password reset email using the configured provider', async () => {
    await service.sendPasswordReset('user@example.com', 'User', 'raw-token');

    expect(transport.buildTransporter).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      username: 'smtp-user',
      password: 'decrypted-password',
      auth: true,
      ssl: false,
      startTls: true,
    });
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Project X <no-reply@example.com>',
        to: 'user@example.com',
        subject: 'Reset your password',
      }),
    );
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('http://localhost:3000/reset-password?token=raw-token'),
      }),
    );
  });

  it('throws when no system provider is configured at send time', async () => {
    repo.findSystemProvider.mockResolvedValue([]);
    await expect(service.sendPasswordReset('user@example.com', 'User', 'raw-token')).rejects.toThrow(ServiceUnavailableException);
    expect(transport.buildTransporter).not.toHaveBeenCalled();
  });

  it('throws when SMTP delivery fails', async () => {
    transporter.sendMail.mockRejectedValue(new Error('smtp timeout'));
    await expect(service.sendPasswordReset('user@example.com', 'User', 'raw-token')).rejects.toThrow(ServiceUnavailableException);
  });
});
