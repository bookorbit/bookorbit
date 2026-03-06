import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'fs';

import * as schema from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { EmailFileSelector } from './email-file-selector';
import { EmailPreferencesService } from './email-preferences.service';
import { EmailProviderResolver } from './email-provider-resolver';
import { EmailRecipientGroupService } from './email-recipient-group.service';
import { EmailRecipientService } from './email-recipient.service';
import { EmailSendLogService, SEND_RETRY_DELAYS_MS } from './email-send-log.service';
import { EmailTemplateContextService } from './email-template-context.service';
import { EmailTemplateService } from './email-template.service';
import { EmailTransportService } from './email-transport.service';
import { renderTemplate } from './email-template-renderer';
import type { SendBookDto } from './dto/send-book.dto';

interface SendTask {
  bookId: number;
  recipientId: number;
  recipientEmail: string;
  recipientName: string;
  deviceType: string | null;
  preferredFormat: string | null;
  effectiveTemplateId: number | null;
}

@Injectable()
export class EmailSendOrchestrator {
  private readonly logger = new Logger(EmailSendOrchestrator.name);

  constructor(
    private readonly providerResolver: EmailProviderResolver,
    private readonly fileSelector: EmailFileSelector,
    private readonly recipientService: EmailRecipientService,
    private readonly groupService: EmailRecipientGroupService,
    private readonly templateService: EmailTemplateService,
    private readonly templateContextService: EmailTemplateContextService,
    private readonly preferencesService: EmailPreferencesService,
    private readonly sendLogService: EmailSendLogService,
    private readonly transportService: EmailTransportService,
  ) {}

  async send(dto: SendBookDto, user: RequestUser): Promise<{ queued: number }> {
    const tasks = await this.buildTasks(dto, user);
    if (tasks.length === 0) throw new BadRequestException('No recipients specified');

    const resolved = await this.providerResolver.resolve(user, dto.providerId);

    let queued = 0;
    for (const task of tasks) {
      for (const bookId of dto.bookIds) {
        await this.enqueueOne({ ...task, bookId }, resolved, dto, user);
        queued++;
      }
    }

    return { queued };
  }

  async resend(logEntryId: number, user: RequestUser): Promise<{ queued: number }> {
    const logEntry = await this.sendLogService.getForResend(logEntryId, user);
    if (!logEntry.bookId || !logEntry.toEmail) {
      throw new BadRequestException('Cannot resend: original book or recipient is missing');
    }

    const resolved = await this.providerResolver.resolve(user, logEntry.providerId ?? null);
    const file = await this.fileSelector.select(logEntry.bookId, logEntry.bookFileId ?? null, null);
    const template = await this.templateService.resolveTemplate(logEntry.templateId ?? null, user);
    const context = await this.templateContextService.buildForBook(logEntry.bookId, file.id, user.name);
    const rendered = renderTemplate(template.subject, template.bodyText, context);
    const effectiveSubject = logEntry.subject === 'convert' ? 'convert' : rendered.subject;

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
      recipientId: 0,
      recipientEmail: logEntry.toEmail,
      recipientName: logEntry.toName ?? '',
      deviceType: logEntry.subject === 'convert' ? 'kindle' : null,
      preferredFormat: null,
      effectiveTemplateId: logEntry.templateId ?? null,
    };

    setImmediate(() => void this.dispatchSend(newLog.id, resolved.config, task, file, effectiveSubject, rendered.bodyText, 0));

    return { queued: 1 };
  }

  async quickSend(bookId: number, user: RequestUser): Promise<{ queued: number }> {
    const prefs = await this.preferencesService.getForUser(user.id);
    if (!prefs?.defaultRecipientId) {
      throw new BadRequestException('No default recipient configured. Set one in email settings.');
    }

    const recipient = await this.recipientService.getById(prefs.defaultRecipientId);
    const resolved = await this.providerResolver.resolve(user, null);

    await this.enqueueOne(
      {
        bookId,
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        deviceType: recipient.deviceType,
        preferredFormat: recipient.preferredFormat,
        effectiveTemplateId: recipient.defaultTemplateId ?? prefs.defaultTemplateId ?? null,
      },
      resolved,
      { bookIds: [bookId] },
      user,
    );

    return { queued: 1 };
  }

  private async buildTasks(dto: SendBookDto, user: RequestUser): Promise<Omit<SendTask, 'bookId'>[]> {
    const tasks: Omit<SendTask, 'bookId'>[] = [];

    const recipientIds = new Set<number>(dto.recipientIds ?? []);

    if (dto.groupIds?.length) {
      for (const groupId of dto.groupIds) {
        const ids = await this.groupService.expandOwnedGroupToRecipientIds(groupId, user);
        ids.forEach((id) => recipientIds.add(id));
      }
    }

    for (const id of recipientIds) {
      const recipient = await this.recipientService.getOwnedById(id, user);
      tasks.push({
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        deviceType: recipient.deviceType,
        preferredFormat: recipient.preferredFormat,
        effectiveTemplateId: recipient.defaultTemplateId ?? dto.templateId ?? null,
      });
    }

    return tasks;
  }

  private async enqueueOne(
    task: SendTask,
    resolved: Awaited<ReturnType<EmailProviderResolver['resolve']>>,
    dto: Pick<SendBookDto, 'bookIds' | 'fileId' | 'templateId'>,
    user: RequestUser,
  ) {
    const file = await this.fileSelector.select(task.bookId, dto.fileId ?? null, task.preferredFormat);
    const template = await this.templateService.resolveTemplate(task.effectiveTemplateId, user);
    const context = await this.templateContextService.buildForBook(task.bookId, file.id, user.name);
    const rendered = renderTemplate(template.subject, template.bodyText, context);

    const effectiveSubject = task.deviceType === 'kindle' ? 'convert' : rendered.subject;

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
    file: typeof schema.bookFiles.$inferSelect,
    subject: string,
    bodyText: string,
    attemptCount: number,
  ) {
    try {
      const transporter = this.transportService.buildTransporter(smtpConfig);
      const effectiveSubject = task.deviceType === 'kindle' ? 'convert' : subject;

      await transporter.sendMail({
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
      this.logger.log(`Email sent: log#${logId} to ${task.recipientEmail}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Send failed for log#${logId} (attempt ${attemptCount + 1}): ${errorMessage}`);

      const { isFinal } = await this.sendLogService.markFailed(logId, errorMessage, attemptCount);

      if (!isFinal) {
        const delayMs = SEND_RETRY_DELAYS_MS[attemptCount] ?? 0;
        setTimeout(() => void this.dispatchSend(logId, smtpConfig, task, file, subject, bodyText, attemptCount + 1), delayMs);
      } else {
        this.logger.error(`Send permanently failed for log#${logId} to ${task.recipientEmail}`);
      }
    }
  }

  private buildAttachmentFilename(file: typeof schema.bookFiles.$inferSelect): string {
    const ext = file.format ? `.${file.format.toLowerCase()}` : '';
    const base = file.relPath
      ? (file.relPath
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '') ?? 'book')
      : 'book';
    return `${base}${ext}`;
  }
}
