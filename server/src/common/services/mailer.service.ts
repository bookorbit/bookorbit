import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('mailer.host');
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('mailer.host'),
        port: this.config.get<number>('mailer.port'),
        secure: this.config.get<boolean>('mailer.secure'),
        auth: {
          user: this.config.get<string>('mailer.user'),
          pass: this.config.get<string>('mailer.pass'),
        },
      });
    }
    return this.transporter;
  }

  async sendPasswordReset(to: string, username: string, rawToken: string): Promise<void> {
    const appUrl = (this.config.get<string>('mailer.appUrl') ?? '').replace(/\/+$/, '');
    const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

    if (this.config.get('app.nodeEnv') !== 'production') {
      this.logger.log(`[DEV] Password reset URL for ${username}: ${resetUrl}`);
    }

    if (!this.isConfigured()) return;

    try {
      await this.getTransporter().sendMail({
        from: this.config.get<string>('mailer.from'),
        to,
        subject: 'Reset your password',
        text: `Hi ${username},\n\nClick the link below to reset your password (expires in 15 minutes):\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
        html: `<p>Hi ${username},</p><p>Click the link below to reset your password (expires in 15 minutes):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
      });
    } catch (err) {
      this.logger.error('Failed to send password reset email', err);
    }
  }
}
