import * as nodemailer from 'nodemailer';
import { EmailTransportService } from './email-transport.service';

vi.mock('nodemailer');

describe('EmailTransportService', () => {
  let service: EmailTransportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmailTransportService();
  });

  it('should build transporter with correct config (Port 587)', () => {
    (nodemailer.createTransport as vi.Mock).mockReturnValue({});

    service.buildTransporter({
      host: 'smtp.test.com',
      port: 587,
      username: 'user',
      password: 'pass',
      auth: true,
      ssl: false,
      startTls: true,
      tlsRejectUnauthorized: true,
    });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.test.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: 'user', pass: 'pass' },
      }),
    );
  });

  it('should build transporter with secure: true for Port 465', () => {
    (nodemailer.createTransport as vi.Mock).mockReturnValue({});

    service.buildTransporter({
      host: 'smtp.test.com',
      port: 465,
      auth: false,
      ssl: false,
      startTls: false,
      tlsRejectUnauthorized: true,
    });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 465,
        secure: true,
      }),
    );
  });

  it('should verify transporter', async () => {
    const mockTransporter = { verify: vi.fn().mockResolvedValue(true) };
    await service.verifyTransporter(mockTransporter as any);
    expect(mockTransporter.verify).toHaveBeenCalled();
  });

  it('should include auth even when password is an empty string', () => {
    (nodemailer.createTransport as vi.Mock).mockReturnValue({});

    service.buildTransporter({
      host: 'smtp.test.com',
      port: 587,
      username: 'apikey',
      password: '',
      auth: true,
      ssl: false,
      startTls: true,
      tlsRejectUnauthorized: true,
    });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'apikey', pass: '' },
      }),
    );
  });

  it('should not set tls option when tlsRejectUnauthorized is true', () => {
    (nodemailer.createTransport as vi.Mock).mockReturnValue({});

    service.buildTransporter({
      host: 'smtp.test.com',
      port: 587,
      username: 'user',
      password: 'pass',
      auth: true,
      ssl: false,
      startTls: true,
      tlsRejectUnauthorized: true,
    });

    const calls = (nodemailer.createTransport as vi.Mock).mock.calls;
    const callArg = calls[calls.length - 1][0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('tls');
  });

  it('should set tls.rejectUnauthorized=false when tlsRejectUnauthorized is false', () => {
    (nodemailer.createTransport as vi.Mock).mockReturnValue({});

    service.buildTransporter({
      host: 'smtp.selfhosted.com',
      port: 465,
      auth: true,
      username: 'user',
      password: 'pass',
      ssl: true,
      startTls: false,
      tlsRejectUnauthorized: false,
    });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        tls: { rejectUnauthorized: false },
      }),
    );
  });
});
