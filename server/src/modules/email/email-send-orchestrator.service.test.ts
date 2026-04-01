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
import { EmailBookAccessService } from './email-book-access.service';
import type { RequestUser } from '../../common/types/request-user';
import type { SendBookDto } from './dto/send-book.dto';
import * as fs from 'fs';
import { KINDLE_CONVERT_SUBJECT } from './email-send.constants';

vi.mock('fs');

describe('EmailSendOrchestrator', () => {
  let orchestrator: EmailSendOrchestrator;
  let providerResolver: EmailProviderResolver;
  let recipientService: EmailRecipientService;
  let groupService: EmailRecipientGroupService;
  let preferencesService: EmailPreferencesService;
  let sendLogService: EmailSendLogService;
  let transportService: EmailTransportService;
  let bookAccessService: EmailBookAccessService;

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
    isSuperuser: false,
    permissions: [],
  };

  const mockRecipient = {
    id: 10,
    email: 'recipient@test.com',
    name: 'Recipient',
    deviceType: 'kindle',
    preferredFormat: 'mobi',
    defaultTemplateId: null,
  };
  const mockFile = { id: 100, absolutePath: '/path/to/book.mobi', format: 'MOBI', relPath: 'Books/book.mobi' };
  const mockTemplate = { id: 200, subject: 'Subject {{title}}', bodyText: 'Body' };
  const mockProvider = { config: { host: 'smtp.test.com' }, providerId: 300 };
  const mockLogEntry = { id: 400 };

  beforeEach(async () => {
    // Avoid background tasks running in tests where we don't expect them
    vi.spyOn(global, 'setImmediate').mockImplementation((fn: any) => fn() as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailSendOrchestrator,
        {
          provide: EmailProviderResolver,
          useValue: { resolve: vi.fn().mockResolvedValue(mockProvider) },
        },
        {
          provide: EmailFileSelector,
          useValue: { select: vi.fn().mockResolvedValue(mockFile) },
        },
        {
          provide: EmailRecipientService,
          useValue: {
            getOwnedById: vi.fn().mockResolvedValue(mockRecipient),
            getOwnedByIds: vi.fn().mockResolvedValue([mockRecipient]),
          },
        },
        {
          provide: EmailRecipientGroupService,
          useValue: { expandOwnedGroupToRecipientIds: vi.fn().mockResolvedValue([10]) },
        },
        {
          provide: EmailTemplateService,
          useValue: { resolveTemplate: vi.fn().mockResolvedValue(mockTemplate) },
        },
        {
          provide: EmailTemplateContextService,
          useValue: { buildForBook: vi.fn().mockResolvedValue({ title: 'Book Title' }) },
        },
        {
          provide: EmailPreferencesService,
          useValue: { getForUser: vi.fn() },
        },
        {
          provide: EmailSendLogService,
          useValue: {
            create: vi.fn().mockResolvedValue(mockLogEntry),
            markSent: vi.fn().mockResolvedValue(mockLogEntry),
            markFailed: vi.fn().mockResolvedValue({ isFinal: true }),
            getForResend: vi.fn(),
          },
        },
        {
          provide: EmailTransportService,
          useValue: { buildTransporter: vi.fn().mockReturnValue({ sendMail: vi.fn().mockResolvedValue({}) }) },
        },
        {
          provide: EmailBookAccessService,
          useValue: {
            assertUserCanAccessBook: vi.fn().mockResolvedValue(undefined),
            assertUserCanAccessBooks: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    orchestrator = module.get<EmailSendOrchestrator>(EmailSendOrchestrator);
    providerResolver = module.get<EmailProviderResolver>(EmailProviderResolver);
    recipientService = module.get<EmailRecipientService>(EmailRecipientService);
    groupService = module.get<EmailRecipientGroupService>(EmailRecipientGroupService);
    preferencesService = module.get<EmailPreferencesService>(EmailPreferencesService);
    sendLogService = module.get<EmailSendLogService>(EmailSendLogService);
    transportService = module.get<EmailTransportService>(EmailTransportService);
    bookAccessService = module.get<EmailBookAccessService>(EmailBookAccessService);

    (fs.createReadStream as vi.Mock).mockReturnValue('mock-stream');
  });

  describe('send', () => {
    it('should queue emails for recipients', async () => {
      const dto: SendBookDto = { bookIds: [1], recipientIds: [10], providerId: 300 };
      const result = await orchestrator.send(dto, mockUser);

      expect(result.queued).toBe(1);
      expect(providerResolver.resolve).toHaveBeenCalledWith(mockUser, 300);
      expect(sendLogService.create).toHaveBeenCalled();
      expect(bookAccessService.assertUserCanAccessBooks).toHaveBeenCalledWith([1], mockUser);
      expect(recipientService.getOwnedByIds).toHaveBeenCalledWith([10], mockUser);
    });

    it('should expand groups and queue emails', async () => {
      const dto: SendBookDto = { bookIds: [1], groupIds: [5] };
      const result = await orchestrator.send(dto, mockUser);

      expect(result.queued).toBe(1);
      expect(groupService.expandOwnedGroupToRecipientIds).toHaveBeenCalledWith(5, mockUser);
      expect(recipientService.getOwnedByIds).toHaveBeenCalledWith([10], mockUser);
    });

    it('should throw BadRequestException if no recipients', async () => {
      const dto: SendBookDto = { bookIds: [1], recipientIds: [], groupIds: [] };
      await expect(orchestrator.send(dto, mockUser)).rejects.toThrow(BadRequestException);
    });

    it('should fail if user cannot access requested books', async () => {
      (bookAccessService.assertUserCanAccessBooks as vi.Mock).mockRejectedValue(new Error('No access to this library'));
      const dto: SendBookDto = { bookIds: [1], recipientIds: [10] };
      await expect(orchestrator.send(dto, mockUser)).rejects.toThrow('No access to this library');
    });
  });

  describe('quickSend', () => {
    it('should use default recipient from preferences', async () => {
      (preferencesService.getForUser as vi.Mock).mockResolvedValue({ defaultRecipientId: 10 });

      const result = await orchestrator.quickSend(1, mockUser);

      expect(result.queued).toBe(1);
      expect(bookAccessService.assertUserCanAccessBook).toHaveBeenCalledWith(1, mockUser);
      expect(recipientService.getOwnedById).toHaveBeenCalledWith(10, mockUser);
    });

    it('should throw if no default recipient', async () => {
      (preferencesService.getForUser as vi.Mock).mockResolvedValue(null);
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
      (sendLogService.getForResend as vi.Mock).mockResolvedValue(existingLog);

      const result = await orchestrator.resend(400, mockUser);

      expect(result.queued).toBe(1);
      expect(bookAccessService.assertUserCanAccessBook).toHaveBeenCalledWith(1, mockUser);
      expect(sendLogService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          toEmail: 'resend@test.com',
        }),
      );
    });
  });

  describe('dispatchSend', () => {
    let mockTransporter: { sendMail: vi.Mock };

    beforeEach(() => {
      mockTransporter = { sendMail: vi.fn().mockResolvedValue({ messageId: '123' }) };
      (transportService.buildTransporter as vi.Mock).mockReturnValue(mockTransporter);
    });

    it('should send email and mark log as sent', async () => {
      const task = { recipientEmail: 'test@test.com' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Subject', 'Body', 0);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@test.com',
          subject: 'Subject',
          text: 'Body',
        }),
      );
      expect(sendLogService.markSent).toHaveBeenCalledWith(400);
    });

    it('should retry on failure', async () => {
      vi.useFakeTimers();
      vi.spyOn(global, 'setTimeout');
      mockTransporter.sendMail.mockRejectedValueOnce(new Error('SMTP Error'));
      (sendLogService.markFailed as vi.Mock).mockResolvedValue({ isFinal: false });

      const task = { recipientEmail: 'test@test.com' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Subject', 'Body', 0);

      expect(sendLogService.markFailed).toHaveBeenCalledWith(400, 'SMTP Error', 0);
      expect(setTimeout).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should set subject to "convert" if task deviceType is kindle', async () => {
      const task = { recipientEmail: 'test@test.com', deviceType: 'kindle' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Original', 'Body', 0);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: KINDLE_CONVERT_SUBJECT,
        }),
      );
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
        subject: KINDLE_CONVERT_SUBJECT,
      };
      (sendLogService.getForResend as vi.Mock).mockResolvedValue(existingLog);

      await orchestrator.resend(400, mockUser);

      expect(sendLogService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: KINDLE_CONVERT_SUBJECT,
        }),
      );
    });

    it('should not retry if isFinal is true', async () => {
      vi.useFakeTimers();
      vi.spyOn(global, 'setTimeout');
      mockTransporter.sendMail.mockRejectedValueOnce(new Error('SMTP Error'));
      (sendLogService.markFailed as vi.Mock).mockResolvedValue({ isFinal: true });

      const task = { recipientEmail: 'test@test.com' } as any;
      const file = { absolutePath: '/test.mobi', relPath: 'test.mobi' } as any;

      await (orchestrator as any).dispatchSend(400, {}, task, file, 'Subject', 'Body', 0);

      expect(sendLogService.markFailed).toHaveBeenCalledWith(400, 'SMTP Error', 0);
      expect(setTimeout).not.toHaveBeenCalled();
      vi.useRealTimers();
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
