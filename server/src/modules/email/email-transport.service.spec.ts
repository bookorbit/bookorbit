import { Test, TestingModule } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { EmailTransportService } from './email-transport.service';

jest.mock('nodemailer');

describe('EmailTransportService', () => {
  let service: EmailTransportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailTransportService],
    }).compile();

    service = module.get<EmailTransportService>(EmailTransportService);
  });

  it('should build transporter with correct config (Port 587)', () => {
    (nodemailer.createTransport as jest.Mock).mockReturnValue({});

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
    (nodemailer.createTransport as jest.Mock).mockReturnValue({});

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
    const mockTransporter = { verify: jest.fn().mockResolvedValue(true) };
    await service.verifyTransporter(mockTransporter as any);
    expect(mockTransporter.verify).toHaveBeenCalled();
  });

  it('should include auth even when password is an empty string', () => {
    (nodemailer.createTransport as jest.Mock).mockReturnValue({});

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
});
