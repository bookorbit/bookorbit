import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { Transporter } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  auth: boolean;
  ssl: boolean;
  startTls: boolean;
}

@Injectable()
export class EmailTransportService {
  buildTransporter(config: SmtpConfig): Transporter {
    const secure = config.ssl || config.port === 465;
    const requireTls = !secure && (config.startTls || config.port === 587);
    const username = config.username ?? undefined;
    const password = config.password ?? undefined;
    const auth = config.auth && username !== undefined && password !== undefined ? { user: username, pass: password } : undefined;
    const options: SMTPTransport.Options = {
      host: config.host,
      port: config.port,
      secure,
      requireTLS: requireTls,
      ...(auth ? { auth } : {}),
    };

    return nodemailer.createTransport(options);
  }

  async verifyTransporter(transporter: Transporter): Promise<void> {
    await transporter.verify();
  }
}
