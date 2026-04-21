import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'fs';

import { NotificationType } from '@bookorbit/types';
import type { BookFile } from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { NotificationService } from '../notification/notification.service';
import { EmailBookAccessService } from './email-book-access.service';
import { EmailFileSelector } from './email-file-selector';
import { EmailPreferencesService } from './email-preferences.service';
import { EmailProviderResolver } from './email-provider-resolver';
import { EmailRecipientGroupService } from './email-recipient-group.service';
import { EmailRecipientService } from './email-recipient.service';
import { KINDLE_CONVERT_SUBJECT } from './email-send.constants';
import { EmailSendLogService, SEND_RETRY_DELAYS_MS } from './email-send-log.service';
import { EmailTemplateContextService } from './email-template-context.service';
import { EmailTemplateService } from './email-template.service';
import { EmailTransportService } from './email-transport.service';
import { renderTemplate } from './email-template-renderer';
import type { SendBookDto } from './dto/send-book.dto';

interface SendTask {
  bookId: number;
  userId: number;
  recipientId: number;
  recipientEmail: string;
  recipientName: string;
  deviceType: string | null;
  preferredFormat: string | null;
  effectiveTemplateId: number | null;
}

const EMAIL_SEND_EVENT = 'email.send';
const EMAIL_RESEND_EVENT = 'email.resend';
const EMAIL_QUICK_SEND_EVENT = 'email.quick-send';
const EMAIL_DISPATCH_EVENT = 'email.dispatch';

@Injectable()
export class EmailSendOrchestrator {
  private readonly logger = new Logger(EmailSendOrchestrator.name);

  constructor(
    private readonly bookAccessService: EmailBookAccessService,
    private readonly providerResolver: EmailProviderResolver,
    private readonly fileSelector: EmailFileSelector,
    private readonly recipientService: EmailRecipientService,
    private readonly groupService: EmailRecipientGroupService,
    private readonly templateService: EmailTemplateService,
    private readonly templateContextService: EmailTemplateContextService,
    private readonly preferencesService: EmailPreferencesService,
    private readonly sendLogService: EmailSendLogService,
    private readonly transportService: EmailTransportService,
    private readonly notificationService: NotificationService,
  ) {}

  async send(dto: SendBookDto, user: RequestUser): Promise<{ queued: number }> {
    const startedAt = Date.now();
    const requestedRecipientCount = (dto.recipientIds?.length ?? 0) + (dto.groupIds?.length ?? 0);
    this.logger.log(
      `[${EMAIL_SEND_EVENT}] [start] userId=${user.id} bookCount=${dto.bookIds.length} requestedRecipientCount=${requestedRecipientCount} - send enqueue started`,
    );

    try {
      await this.bookAccessService.assertUserCanAccessBooks(dto.bookIds, user);

      const preferences = await this.preferencesService.getForUser(user.id);
      const tasks = await this.buildTasks(dto, user, preferences?.defaultTemplateId ?? null);
      if (tasks.length === 0) throw new BadRequestException('No recipients specified');

      const resolved = await this.providerResolver.resolve(user, dto.providerId);

      let queued = 0;
      for (const task of tasks) {
        for (const bookId of dto.bookIds) {
          await this.enqueueOne({ ...task, bookId, userId: user.id }, resolved, dto.fileId ?? null, user);
          queued++;
        }
      }

      this.logger.log(`[${EMAIL_SEND_EVENT}] [end] userId=${user.id} durationMs=${Date.now() - startedAt} queued=${queued} - send enqueue completed`);
      return { queued };
    } catch (error) {
      this.logger.error(
        `[${EMAIL_SEND_EVENT}] [fail] userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${this.getErrorClass(error)} error="${this.getErrorMessage(error)}" - send enqueue failed`,
      );
      throw error;
    }
  }

  async resend(logEntryId: number, user: RequestUser): Promise<{ queued: number }> {
    const startedAt = Date.now();
    this.logger.log(`[${EMAIL_RESEND_EVENT}] [start] userId=${user.id} logEntryId=${logEntryId} - resend enqueue started`);

    try {
      const logEntry = await this.sendLogService.getForResend(logEntryId, user);
      if (logEntry.bookId === null || logEntry.bookId === undefined || !logEntry.toEmail) {
        throw new BadRequestException('Cannot resend: original book or recipient is missing');
      }

      await this.bookAccessService.assertUserCanAccessBook(logEntry.bookId, user);

      const resolved = await this.providerResolver.resolve(user, logEntry.providerId ?? null);
      const file = await this.fileSelector.select(logEntry.bookId, logEntry.bookFileId ?? null, null);
      const template = await this.templateService.resolveTemplate(logEntry.templateId ?? null, user);
      const context = await this.templateContextService.buildForBook(logEntry.bookId, file.id, user.name);
      const rendered = renderTemplate(template.subject, template.bodyText, context);
      const effectiveSubject = logEntry.subject === KINDLE_CONVERT_SUBJECT ? KINDLE_CONVERT_SUBJECT : rendered.subject;

      const newLog = await this.sendLogService.create({
        userId: user.id,
        bookId: logEntry.bookId,
        bookFileId: file.id,
        providerId: resolved.providerId,
        templateId: template.id,
        toEmail: logEntry.toEmail,
        toName: logEntry.toName ?? '',
        subject: effectiveSubject,
      });

      const task: SendTask = {
        bookId: logEntry.bookId,
        userId: user.id,
        recipientId: 0,
        recipientEmail: logEntry.toEmail,
        recipientName: logEntry.toName ?? '',
        deviceType: logEntry.subject === KINDLE_CONVERT_SUBJECT ? 'kindle' : null,
        preferredFormat: null,
        effectiveTemplateId: logEntry.templateId ?? null,
      };

      setImmediate(() => void this.dispatchSend(newLog.id, resolved.config, task, file, effectiveSubject, rendered.bodyText, 0));

      this.logger.log(
        `[${EMAIL_RESEND_EVENT}] [end] userId=${user.id} logEntryId=${logEntryId} durationMs=${Date.now() - startedAt} queued=1 - resend enqueue completed`,
      );
      return { queued: 1 };
    } catch (error) {
      this.logger.error(
        `[${EMAIL_RESEND_EVENT}] [fail] userId=${user.id} logEntryId=${logEntryId} durationMs=${Date.now() - startedAt} errorClass=${this.getErrorClass(error)} error="${this.getErrorMessage(error)}" - resend enqueue failed`,
      );
      throw error;
    }
  }

  async quickSend(bookId: number, user: RequestUser): Promise<{ queued: number }> {
    const startedAt = Date.now();
    this.logger.log(`[${EMAIL_QUICK_SEND_EVENT}] [start] userId=${user.id} bookId=${bookId} - quick send enqueue started`);

    try {
      await this.bookAccessService.assertUserCanAccessBook(bookId, user);
      const prefs = await this.preferencesService.getForUser(user.id);
      if (!prefs?.defaultRecipientId) {
        throw new BadRequestException('No default recipient configured. Set one in email settings.');
      }

      const recipient = await this.recipientService.getOwnedById(prefs.defaultRecipientId, user);
      const resolved = await this.providerResolver.resolve(user, null);

      await this.enqueueOne(
        {
          bookId,
          userId: user.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          deviceType: recipient.deviceType,
          preferredFormat: recipient.preferredFormat,
          effectiveTemplateId: recipient.defaultTemplateId ?? prefs.defaultTemplateId ?? null,
        },
        resolved,
        null,
        user,
      );

      this.logger.log(
        `[${EMAIL_QUICK_SEND_EVENT}] [end] userId=${user.id} bookId=${bookId} durationMs=${Date.now() - startedAt} queued=1 - quick send enqueue completed`,
      );
      return { queued: 1 };
    } catch (error) {
      this.logger.error(
        `[${EMAIL_QUICK_SEND_EVENT}] [fail] userId=${user.id} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${this.getErrorClass(error)} error="${this.getErrorMessage(error)}" - quick send enqueue failed`,
      );
      throw error;
    }
  }

  private async buildTasks(dto: SendBookDto, user: RequestUser, defaultTemplateId: number | null): Promise<Omit<SendTask, 'bookId' | 'userId'>[]> {
    const recipientIds = new Set<number>(dto.recipientIds ?? []);

    if (dto.groupIds?.length) {
      const groupRecipients = await Promise.all(dto.groupIds.map((groupId) => this.groupService.expandOwnedGroupToRecipientIds(groupId, user)));
      for (const groupMemberIds of groupRecipients) {
        groupMemberIds.forEach((id) => recipientIds.add(id));
      }
    }

    const dedupedRecipientIds = [...recipientIds];
    if (dedupedRecipientIds.length === 0) return [];

    const recipients = await this.recipientService.getOwnedByIds(dedupedRecipientIds, user);
    return recipients.map((recipient) => ({
      recipientId: recipient.id,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      deviceType: recipient.deviceType,
      preferredFormat: recipient.preferredFormat,
      effectiveTemplateId: dto.templateId ?? recipient.defaultTemplateId ?? defaultTemplateId,
    }));
  }

  private async enqueueOne(
    task: SendTask,
    resolved: Awaited<ReturnType<EmailProviderResolver['resolve']>>,
    fileId: number | null,
    user: RequestUser,
  ) {
    const file = await this.fileSelector.select(task.bookId, fileId, task.preferredFormat);
    const template = await this.templateService.resolveTemplate(task.effectiveTemplateId, user);
    const context = await this.templateContextService.buildForBook(task.bookId, file.id, user.name);
    const rendered = renderTemplate(template.subject, template.bodyText, context);

    const effectiveSubject = task.deviceType === 'kindle' ? KINDLE_CONVERT_SUBJECT : rendered.subject;

    const logEntry = await this.sendLogService.create({
      userId: user.id,
      bookId: task.bookId,
      bookFileId: file.id,
      providerId: resolved.providerId,
      templateId: template.id,
      toEmail: task.recipientEmail,
      toName: task.recipientName,
      subject: effectiveSubject,
    });

    setImmediate(() => void this.dispatchSend(logEntry.id, resolved.config, task, file, effectiveSubject, rendered.bodyText, 0));
  }

  private async dispatchSend(
    logId: number,
    smtpConfig: Awaited<ReturnType<EmailProviderResolver['resolve']>>['config'],
    task: SendTask,
    file: BookFile,
    subject: string,
    bodyText: string,
    attemptCount: number,
  ) {
    try {
      const transporter = this.transportService.buildTransporter(smtpConfig);
      const effectiveSubject = task.deviceType === 'kindle' ? KINDLE_CONVERT_SUBJECT : subject;
      const from = this.buildFromHeader(smtpConfig.fromName, smtpConfig.fromAddress);

      await transporter.sendMail({
        ...(from ? { from } : {}),
        to: task.recipientEmail,
        subject: effectiveSubject,
        text: bodyText,
        attachments: [
          {
            filename: this.buildAttachmentFilename(file),
            content: createReadStream(file.absolutePath),
          },
        ],
      });

      await this.sendLogService.markSent(logId);

      this.notificationService
        .notify({
          type: NotificationType.EmailSent,
          title: 'Email sent successfully',
          message: `Sent to ${task.recipientEmail}`,
          scope: { kind: 'user', userId: task.userId },
          meta: { logId, bookId: task.bookId, recipientEmail: task.recipientEmail },
        })
        .catch(() => {});
    } catch (error) {
      const errorClass = this.getErrorClass(error);
      const errorMessage = this.getErrorMessage(error);
      const attempt = attemptCount + 1;

      const { isFinal } = await this.sendLogService.markFailed(logId, errorMessage, attemptCount);

      if (!isFinal) {
        const delayMs = SEND_RETRY_DELAYS_MS[attemptCount] ?? 0;
        this.logger.warn(
          `[${EMAIL_DISPATCH_EVENT}] [fail] logId=${logId} attempt=${attempt} willRetry=true retryDelayMs=${delayMs} errorClass=${errorClass} error="${errorMessage}" - dispatch failed`,
        );
        const retryTimer = setTimeout(() => void this.dispatchSend(logId, smtpConfig, task, file, subject, bodyText, attemptCount + 1), delayMs);
        if (typeof retryTimer.unref === 'function') {
          retryTimer.unref();
        }
      } else {
        this.logger.error(
          `[${EMAIL_DISPATCH_EVENT}] [fail] logId=${logId} toEmail=${task.recipientEmail} attempt=${attempt} willRetry=false errorClass=${errorClass} error="${errorMessage}" - dispatch failed`,
        );

        this.notificationService
          .notify({
            type: NotificationType.EmailFailed,
            title: 'Email delivery failed',
            message: `Failed to send to ${task.recipientEmail}`,
            scope: { kind: 'user', userId: task.userId },
            meta: { logId, bookId: task.bookId, recipientEmail: task.recipientEmail },
          })
          .catch(() => {});
      }
    }
  }

  private buildAttachmentFilename(file: BookFile): string {
    const ext = file.format ? `.${file.format.toLowerCase()}` : '';
    const base = file.relPath
      ? (file.relPath
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '') ?? 'book')
      : 'book';
    return `${base}${ext}`;
  }

  private buildFromHeader(fromName: string | null | undefined, fromAddress: string | null | undefined): string | undefined {
    const normalizedAddress = fromAddress?.trim();
    if (!normalizedAddress) return undefined;

    const normalizedName = fromName?.trim();
    if (!normalizedName) return normalizedAddress;

    return `${normalizedName} <${normalizedAddress}>`;
  }

  private getErrorClass(error: unknown): string {
    if (error instanceof Error && error.name) return error.name;
    return 'Error';
  }

  private getErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    return raw
      .replace(/[\r\n"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
