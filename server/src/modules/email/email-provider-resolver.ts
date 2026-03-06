import { BadRequestException, Injectable } from '@nestjs/common';

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
  constructor(
    private readonly providerService: EmailProviderService,
    private readonly preferencesService: EmailPreferencesService,
  ) {}

  async resolve(user: RequestUser, requestedProviderId?: number | null): Promise<ResolvedSmtp> {
    if (requestedProviderId !== null && requestedProviderId !== undefined) {
      return this.fromProvider(await this.providerService.getProviderWithDecryptedPassword(requestedProviderId, user));
    }

    const prefs = await this.preferencesService.getForUser(user.id);
    if (prefs?.defaultProviderId !== null && prefs?.defaultProviderId !== undefined) {
      return this.fromProvider(await this.providerService.getProviderWithDecryptedPassword(prefs.defaultProviderId, user));
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
