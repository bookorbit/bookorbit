import { Test, TestingModule } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { EmailTransportService } from './email-transport.service';

vi.mock('nodemailer');

describe('EmailTransportService', () => {
  let service: EmailTransportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailTransportService],
    }).compile();

    service = module.get<EmailTransportService>(EmailTransportService);
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
    });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'apikey', pass: '' },
      }),
    );
  });

  it('should not disable TLS certificate verification by default', () => {
    (nodemailer.createTransport as vi.Mock).mockReturnValue({});

    service.buildTransporter({
      host: 'smtp.test.com',
      port: 587,
      username: 'user',
      password: 'pass',
      auth: true,
      ssl: false,
      startTls: true,
    });

    const calls = (nodemailer.createTransport as vi.Mock).mock.calls;
    const callArg = calls[calls.length - 1][0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('tls');
  });
});
