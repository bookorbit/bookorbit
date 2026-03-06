import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailSendOrchestrator } from './email-send-orchestrator.service';
import { EmailProviderResolver } from './email-provider-resolver';
import { EmailFileSelector } from './email-file-selector';
import { EmailRecipientService } from './email-recipient.service';
import { EmailRecipientGroupService } from './email-recipient-group.service';
import { EmailTemplateService } from './email-template.service';
import { EmailTemplateContextService } from './email-template-context.service';
import { EmailPreferencesService } from './email-preferences.service';
import { EmailSendLogService } from './email-send-log.service';
import { EmailTransportService } from './email-transport.service';
import type { RequestUser } from '../../common/types/request-user';
import type { SendBookDto } from './dto/send-book.dto';
import * as fs from 'fs';

jest.mock('fs');

describe('EmailSendOrchestrator', () => {
  let orchestrator: EmailSendOrchestrator;
  let providerResolver: EmailProviderResolver;
  let fileSelector: EmailFileSelector;
  let recipientService: EmailRecipientService;
  let groupService: EmailRecipientGroupService;
  let templateService: EmailTemplateService;
  let templateContextService: EmailTemplateContextService;
  let preferencesService: EmailPreferencesService;
  let sendLogService: EmailSendLogService;
  let transportService: EmailTransportService;

  const mockUser: RequestUser = {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    email: 'test@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    roles: [],
  };

  const mockRecipient = { id: 10, email: 'recipient@test.com', name: 'Recipient', deviceType: 'kindle', preferredFormat: 'mobi', defaultTemplateId: null };
  const mockFile = { id: 100, absolutePath: '/path/to/book.mobi', format: 'MOBI', relPath: 'Books/book.mobi' };
  const mockTemplate = { id: 200, subject: 'Subject {{title}}', bodyText: 'Body' };
  const mockProvider = { config: { host: 'smtp.test.com' }, providerId: 300 };
  const mockLogEntry = { id: 400 };

  beforeEach(async () => {
    // Avoid background tasks running in tests where we don't expect them
    jest.spyOn(global, 'setImmediate').mockImplementation((fn: any) => fn() as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailSendOrchestrator,
        {
          provide: EmailProviderResolver,
          useValue: { resolve: jest.fn().mockResolvedValue(mockProvider) },
        },
        {
          provide: EmailFileSelector,
          useValue: { select: jest.fn().mockResolvedValue(mockFile) },
        },
        {
          provide: EmailRecipientService,
          useValue: { getOwnedById: jest.fn().mockResolvedValue(mockRecipient), getById: jest.fn().mockResolvedValue(mockRecipient) },
        },
        {
          provide: EmailRecipientGroupService,
          useValue: { expandOwnedGroupToRecipientIds: jest.fn().mockResolvedValue([10]) },
        },
        {
          provide: EmailTemplateService,
          useValue: { resolveTemplate: jest.fn().mockResolvedValue(mockTemplate) },
        },
        {
          provide: EmailTemplateContextService,
          useValue: { buildForBook: jest.fn().mockResolvedValue({ title: 'Book Title' }) },
        },
        {
          provide: EmailPreferencesService,
          useValue: { getForUser: jest.fn() },
        },
        {
          provide: EmailSendLogService,
          useValue: {
            create: jest.fn().mockResolvedValue(mockLogEntry),
            markSent: jest.fn().mockResolvedValue(mockLogEntry),
            markFailed: jest.fn().mockResolvedValue({ isFinal: true }),
            getForResend: jest.fn(),
          },
        },
        {
          provide: EmailTransportService,
          useValue: { buildTransporter: jest.fn().mockReturnValue({ sendMail: jest.fn().mockResolvedValue({}) }) },
        },
      ],
    }).compile();

    orchestrator = module.get<EmailSendOrchestrator>(EmailSendOrchestrator);
    providerResolver = module.get<EmailProviderResolver>(EmailProviderResolver);
    fileSelector = module.get<EmailFileSelector>(EmailFileSelector);
    recipientService = module.get<EmailRecipientService>(EmailRecipientService);
    groupService = module.get<EmailRecipientGroupService>(EmailRecipientGroupService);
    templateService = module.get<EmailTemplateService>(EmailTemplateService);
    templateContextService = module.get<EmailTemplateContextService>(EmailTemplateContextService);
    preferencesService = module.get<EmailPreferencesService>(EmailPreferencesService);
    sendLogService = module.get<EmailSendLogService>(EmailSendLogService);
    transportService = module.get<EmailTransportService>(EmailTransportService);

    (fs.createReadStream as jest.Mock).mockReturnValue('mock-stream');
  });

  describe('send', () => {
    it('should queue emails for recipients', async () => {
      const dto: SendBookDto = { bookIds: [1], recipientIds: [10], providerId: 300 };
      const result = await orchestrator.send(dto, mockUser);

      expect(result.queued).toBe(1);
      expect(providerResolver.resolve).toHaveBeenCalledWith(mockUser, 300);
      expect(sendLogService.create).toHaveBeenCalled();
    });

    it('should expand groups and queue emails', async () => {
      const dto: SendBookDto = { bookIds: [1], groupIds: [5] };
      const result = await orchestrator.send(dto, mockUser);

      expect(result.queued).toBe(1);
      expect(groupService.expandOwnedGroupToRecipientIds).toHaveBeenCalledWith(5, mockUser);
      expect(recipientService.getOwnedById).toHaveBeenCalledWith(10, mockUser);
    });

    it('should throw BadRequestException if no recipients', async () => {
      const dto: SendBookDto = { bookIds: [1], recipientIds: [], groupIds: [] };
      await expect(orchestrator.send(dto, mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('quickSend', () => {
    it('should use default recipient from preferences', async () => {
      (preferencesService.getForUser as jest.Mock).mockResolvedValue({ defaultRecipientId: 10 });

      const result = await orchestrator.quickSend(1, mockUser);

      expect(result.queued).toBe(1);
      expect(recipientService.getById).toHaveBeenCalledWith(10);
    });

    it('should throw if no default recipient', async () => {
      (preferencesService.getForUser as jest.Mock).mockResolvedValue(null);
      await expect(orchestrator.quickSend(1, mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('resend', () => {
    it('should queue a resend of an existing log entry', async () => {
      const existingLog = {
        userId: mockUser.id,
        bookId: 1,
        bookFileId: 100,
        providerId: 300,
        templateId: 200,
        toEmail: 'resend@test.com',
        toName: 'Resend',
        subject: 'Original Subject',
      };
      (sendLogService.getForResend as jest.Mock).mockResolvedValue(existingLog);

      const result = await orchestrator.resend(400, mockUser);

      expect(result.queued).toBe(1);
      expect(sendLogService.create).toHaveBeenCalledWith(expect.objectContaining({
        toEmail: 'resend@test.com',
      }));
    });
  });

  describe('dispatchSend', () => {
    let mockTransporter: { sendMail: jest.Mock };

    beforeEach(() => {
      mockTransporter = { sendMail: jest.fn().mockResolvedValue({ messageId: '123' }) };
      (transportService.buildTransporter as jest.Mock).mockReturnValue(mockTransporter);
    });

    it('should send email and mark log as sent', async () => {
      const task = { recipientEmail: 'test@test.com' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Subject', 'Body', 0);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'test@test.com',
        subject: 'Subject',
        text: 'Body',
      }));
      expect(sendLogService.markSent).toHaveBeenCalledWith(400);
    });

    it('should retry on failure', async () => {
      jest.useFakeTimers();
      jest.spyOn(global, 'setTimeout');
      mockTransporter.sendMail.mockRejectedValueOnce(new Error('SMTP Error'));
      (sendLogService.markFailed as jest.Mock).mockResolvedValue({ isFinal: false });

      const task = { recipientEmail: 'test@test.com' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Subject', 'Body', 0);

      expect(sendLogService.markFailed).toHaveBeenCalledWith(400, 'SMTP Error', 0);
      expect(setTimeout).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('should set subject to "convert" if task deviceType is kindle', async () => {
      const task = { recipientEmail: 'test@test.com', deviceType: 'kindle' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Original', 'Body', 0);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({
        subject: 'convert',
      }));
    });

    it('should use "convert" subject in resend if original was "convert"', async () => {
      const existingLog = {
        userId: mockUser.id,
        bookId: 1,
        bookFileId: 100,
        providerId: 300,
        templateId: 200,
        toEmail: 'resend@test.com',
        toName: 'Resend',
        subject: 'convert',
      };
      (sendLogService.getForResend as jest.Mock).mockResolvedValue(existingLog);

      await orchestrator.resend(400, mockUser);

      expect(sendLogService.create).toHaveBeenCalledWith(expect.objectContaining({
        subject: 'convert',
      }));
    });

    it('should not retry if isFinal is true', async () => {
      jest.useFakeTimers();
      jest.spyOn(global, 'setTimeout');
      mockTransporter.sendMail.mockRejectedValueOnce(new Error('SMTP Error'));
      (sendLogService.markFailed as jest.Mock).mockResolvedValue({ isFinal: true });

      const task = { recipientEmail: 'test@test.com' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Subject', 'Body', 0);

      expect(sendLogService.markFailed).toHaveBeenCalledWith(400, 'SMTP Error', 0);
      expect(setTimeout).not.toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('buildAttachmentFilename', () => {
    it('should build filename from relPath and format', () => {
      const file = { relPath: 'Library/Author/Book.epub', format: 'EPUB' } as any;
      const filename = (orchestrator as any).buildAttachmentFilename(file);
      expect(filename).toBe('Book.epub');
    });

    it('should use "book" if relPath is missing', () => {
      const file = { relPath: null, format: 'PDF' } as any;
      const filename = (orchestrator as any).buildAttachmentFilename(file);
      expect(filename).toBe('book.pdf');
    });

    it('should handle missing format', () => {
      const file = { relPath: 'some/book', format: null } as any;
      const filename = (orchestrator as any).buildAttachmentFilename(file);
      expect(filename).toBe('book');
    });
  });
});
