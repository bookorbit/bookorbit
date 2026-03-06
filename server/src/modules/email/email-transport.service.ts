import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
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
    const hasAuthCredentials = config.username !== undefined && config.username !== null && config.password !== undefined && config.password !== null;

    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure,
      requireTLS: requireTls,
      ...(config.auth && hasAuthCredentials ? { auth: { user: config.username, pass: config.password } } : {}),
      tls: { rejectUnauthorized: false },
    } as nodemailer.TransportOptions);
  }

  async verifyTransporter(transporter: Transporter): Promise<void> {
    await transporter.verify();
  }
}
