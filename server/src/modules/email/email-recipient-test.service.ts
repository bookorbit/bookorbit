import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { EmailTestResult } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { EmailProviderResolver } from './email-provider-resolver';
import { EmailRecipientService } from './email-recipient.service';
import { EmailTransportService } from './email-transport.service';

const EMAIL_RECIPIENT_TEST_EVENT = 'email.recipient-test';

/**
 * Sends one plain message, without a book, through the caller's default server. It answers with
 * the server's verdict instead of queueing, because the point is to see that verdict.
 */
@Injectable()
export class EmailRecipientTestService {
  private readonly logger = new Logger(EmailRecipientTestService.name);

  constructor(
    private readonly recipientService: EmailRecipientService,
    private readonly providerResolver: EmailProviderResolver,
    private readonly transport: EmailTransportService,
  ) {}

  async send(recipientId: number, subject: string, text: string, user: RequestUser): Promise<EmailTestResult> {
    const startedAt = Date.now();
    const recipient = await this.recipientService.getOwnedById(recipientId, user);
    // Amazon answers a message without a document with an error email of its own.
    if (recipient.deviceType === 'kindle')
      throw new BadRequestException({ code: 'KINDLE_TEST_UNSUPPORTED', message: 'Kindle accepts only documents' });

    const resolved = await this.providerResolver.resolve(user, null);
    this.logger.log(
      `[${EMAIL_RECIPIENT_TEST_EVENT}] [start] userId=${user.id} recipientId=${recipient.id} providerId=${resolved.providerId} - test send started`,
    );
    const transporter = this.transport.buildTransporter(resolved.config);
    const fromAddress = resolved.config.fromAddress?.trim();
    const fromName = resolved.config.fromName?.trim();
    try {
      await transporter.sendMail({
        ...(fromAddress ? { from: fromName ? `${fromName} <${fromAddress}>` : fromAddress } : {}),
        to: recipient.email,
        subject,
        text,
      });
      this.logger.log(
        `[${EMAIL_RECIPIENT_TEST_EVENT}] [end] userId=${user.id} recipientId=${recipient.id} durationMs=${Date.now() - startedAt} - test send completed`,
      );
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = error instanceof Error && error.name ? error.name : 'Error';
      this.logger.warn(
        `[${EMAIL_RECIPIENT_TEST_EVENT}] [fail] userId=${user.id} recipientId=${recipient.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - test send failed`,
      );
      return { success: false, error: message.slice(0, 1000) };
    }
  }
}
