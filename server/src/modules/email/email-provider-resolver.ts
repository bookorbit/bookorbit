import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { EmailProvider } from '../../db/schema';
import { EmailPreferencesService } from './email-preferences.service';
import { EmailProviderService } from './email-provider.service';
import type { SmtpConfig } from './email-transport.service';

export interface ResolvedSmtp {
  config: SmtpConfig;
  providerId: number | null;
}

@Injectable()
export class EmailProviderResolver {
  private readonly logger = new Logger(EmailProviderResolver.name);

  constructor(
    private readonly providerService: EmailProviderService,
    private readonly preferencesService: EmailPreferencesService,
  ) {}

  async resolve(user: RequestUser, requestedProviderId?: number | null): Promise<ResolvedSmtp> {
    if (requestedProviderId !== null && requestedProviderId !== undefined) {
      const provider = await this.providerService.getProviderWithDecryptedPassword(requestedProviderId, user);
      this.logger.debug(`[email.provider] [resolved] id=${provider.id} host=${provider.host} (requested)`);
      return this.fromProvider(provider);
    }

    const prefs = await this.preferencesService.getForUser(user.id);
    if (prefs?.defaultProviderId !== null && prefs?.defaultProviderId !== undefined) {
      const provider = await this.providerService.getProviderWithDecryptedPassword(prefs.defaultProviderId, user);
      this.logger.debug(`[email.provider] [resolved] id=${provider.id} host=${provider.host} (default)`);
      return this.fromProvider(provider);
    }

    throw new BadRequestException('No email provider configured. Add a provider in email settings.');
  }

  private fromProvider(provider: EmailProvider & { plainPassword: string | null }): ResolvedSmtp {
    return {
      config: {
        host: provider.host,
        port: provider.port,
        username: provider.username,
        password: provider.plainPassword,
        auth: provider.auth,
        ssl: provider.ssl,
        startTls: provider.startTls,
      },
      providerId: provider.id,
    };
  }
}
