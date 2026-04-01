import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmailEncryptionService } from './email-encryption.service';
import { EmailProviderRepository } from './email-provider.repository';
import { EmailTransportService } from './email-transport.service';

@Injectable()
export class SystemMailService {
  private readonly logger = new Logger(SystemMailService.name);
  private readonly event = 'system-mail.password-reset';

  constructor(
    private readonly repo: EmailProviderRepository,
    private readonly encryption: EmailEncryptionService,
    private readonly transport: EmailTransportService,
    private readonly config: ConfigService,
  ) {}

  async isConfigured(): Promise<boolean> {
    const [provider] = await this.repo.findSystemProvider();
    return !!provider;
  }

  async sendPasswordReset(to: string, name: string, rawToken: string): Promise<void> {
    const startedAt = Date.now();
    const appUrl = (this.config.get<string>('app.appUrl') ?? '').replace(/\/+$/, '');
    const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
    this.logger.log(`[${this.event}] [start] toEmail=${to} - password reset send started`);

    if (this.config.get('app.nodeEnv') !== 'production') {
      this.logger.debug(`[${this.event}] [start] toEmail=${to} - password reset requested in non-production environment`);
    }

    const [provider] = await this.repo.findSystemProvider();
    if (!provider) {
      this.logger.error(
        `[${this.event}] [fail] toEmail=${to} durationMs=${Date.now() - startedAt} errorClass=ServiceUnavailableException error="system mail provider not configured" - password reset send failed`,
      );
      throw new ServiceUnavailableException('System mail provider is not configured');
    }

    const password = provider.passwordEnc ? this.encryption.decrypt(provider.passwordEnc) : undefined;
    const transporter = this.transport.buildTransporter({
      host: provider.host,
      port: provider.port,
      username: provider.username,
      password: password ?? null,
      auth: provider.auth,
      ssl: provider.ssl,
      startTls: provider.startTls,
    });

    const from = provider.fromAddress ? (provider.fromName ? `${provider.fromName} <${provider.fromAddress}>` : provider.fromAddress) : undefined;

    try {
      await transporter.sendMail({
        from,
        to,
        subject: 'Reset your password',
        text: this.buildResetText(name, resetUrl),
        html: this.buildResetHtml(name, resetUrl),
      });
      this.logger.log(`[${this.event}] [end] toEmail=${to} durationMs=${Date.now() - startedAt} - password reset send completed`);
    } catch (error) {
      const errorClass = error instanceof Error && error.name ? error.name : 'Error';
      const errorMessage = this.sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      this.logger.error(
        `[${this.event}] [fail] toEmail=${to} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - password reset send failed`,
      );
      throw new ServiceUnavailableException('Password reset email delivery failed');
    }
  }

  private buildResetText(name: string, resetUrl: string): string {
    return [
      `Hi ${name},`,
      '',
      'We received a request to reset the password for your account.',
      '',
      'Click the link below to set a new password. This link expires in 15 minutes.',
      '',
      resetUrl,
      '',
      'If you did not request a password reset, you can safely ignore this email.',
      'Your password will not change unless you click the link above.',
    ].join('\n');
  }

  private buildResetHtml(name: string, resetUrl: string): string {
    const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedUrl = resetUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
          <tr>
            <td style="background:#18181b;padding:24px 32px;">
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:600;letter-spacing:-0.3px;">Project X</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 24px;">
              <p style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b;">Reset your password</p>
              <p style="margin:0 0 24px;font-size:14px;color:#71717a;line-height:1.6;">
                Hi ${escapedName}, we received a request to reset the password for your account.
                This link expires in <strong style="color:#18181b;">15 minutes</strong>.
              </p>
              <a href="${escapedUrl}"
                 style="display:inline-block;padding:11px 24px;background:#18181b;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;border-radius:6px;">
                Reset password
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;line-height:1.6;">
                If you did not request a password reset, you can safely ignore this email.
                Your password will not change unless you click the button above.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private sanitizeErrorMessage(value: string): string {
    return value
      .replace(/[\r\n"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
