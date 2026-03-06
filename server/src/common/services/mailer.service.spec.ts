import type { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

import { MailerService } from './mailer.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

type ConfigValues = Record<string, unknown>;

const DEFAULT_CONFIG: ConfigValues = {
  'mailer.host': 'smtp.example.com',
  'mailer.port': 587,
  'mailer.secure': false,
  'mailer.user': 'mailer-user',
  'mailer.pass': 'mailer-pass',
  'mailer.from': 'noreply@example.com',
  'mailer.appUrl': 'http://localhost:5173',
  'app.nodeEnv': 'development',
};

function makeConfig(overrides: ConfigValues = {}): ConfigService {
  const values = { ...DEFAULT_CONFIG, ...overrides };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function makeService(overrides: ConfigValues = {}) {
  const config = makeConfig(overrides);
  const service = new MailerService(config);
  const logger = {
    log: jest.fn(),
    error: jest.fn(),
  };

  (service as unknown as { logger: typeof logger }).logger = logger;

  return { service, config, logger };
}

describe('MailerService', () => {
  const createTransportMock = nodemailer.createTransport as jest.MockedFunction<typeof nodemailer.createTransport>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('isConfigured returns true only when SMTP host exists', () => {
    const configured = makeService();
    const notConfigured = makeService({ 'mailer.host': '' });

    expect(configured.service.isConfigured()).toBe(true);
    expect(notConfigured.service.isConfigured()).toBe(false);
  });

  it('does not send email when mailer is not configured and still logs reset URL in non-production', async () => {
    const { service, logger } = makeService({
      'mailer.host': undefined,
      'mailer.appUrl': 'http://app.local/',
      'app.nodeEnv': 'development',
    });

    await expect(service.sendPasswordReset('user@example.com', 'Alice', 'a+b&c/d==')).resolves.toBeUndefined();

    expect(createTransportMock).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      '[DEV] Password reset URL for Alice: http://app.local/reset-password?token=a%2Bb%26c%2Fd%3D%3D',
    );
  });

  it('sends password reset email with expected payload and no DEV log in production', async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    createTransportMock.mockReturnValue({ sendMail } as unknown as nodemailer.Transporter);

    const { service, logger } = makeService({
      'app.nodeEnv': 'production',
      'mailer.appUrl': 'https://app.example.com/',
    });

    await expect(service.sendPasswordReset('user@example.com', 'Alice', 'token+slash/value')).resolves.toBeUndefined();

    expect(logger.log).not.toHaveBeenCalled();
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: 'mailer-user',
        pass: 'mailer-pass',
      },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Reset your password',
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('https://app.example.com/reset-password?token=token%2Bslash%2Fvalue'),
        html: expect.stringContaining('https://app.example.com/reset-password?token=token%2Bslash%2Fvalue'),
      }),
    );
  });

  it('reuses the same transporter across multiple sends', async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    createTransportMock.mockReturnValue({ sendMail } as unknown as nodemailer.Transporter);

    const { service } = makeService();

    await service.sendPasswordReset('u1@example.com', 'User1', 'token-1');
    await service.sendPasswordReset('u2@example.com', 'User2', 'token-2');

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('swallows transport creation errors and logs them', async () => {
    const error = new Error('invalid SMTP configuration');
    createTransportMock.mockImplementation(() => {
      throw error;
    });

    const { service, logger } = makeService();

    await expect(service.sendPasswordReset('user@example.com', 'Alice', 'token')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith('Failed to send password reset email', error);
  });

  it('swallows provider-specific non-Error failures from sendMail and logs them', async () => {
    const providerFailure = { code: 'EAUTH', response: 'Invalid login' };
    const sendMail = jest.fn().mockRejectedValue(providerFailure);
    createTransportMock.mockReturnValue({ sendMail } as unknown as nodemailer.Transporter);

    const { service, logger } = makeService();

    await expect(service.sendPasswordReset('user@example.com', 'Alice', 'token')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith('Failed to send password reset email', providerFailure);
  });
});
