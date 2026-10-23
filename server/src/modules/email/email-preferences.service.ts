import { Injectable } from '@nestjs/common';
import type { EmailPreferences } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { Unserialized } from '../../common/types/unserialized';
import { EmailPreferencesRepository } from './email-preferences.repository';
import { EmailProviderService } from './email-provider.service';
import { EmailRecipientService } from './email-recipient.service';
import { EmailTemplateService } from './email-template.service';
import { UpdateEmailPreferencesDto } from './dto/update-email-preferences.dto';

/** The stored row when there is one, with every default replaced by the one sending will use. */
export type EffectiveEmailPreferences = Unserialized<EmailPreferences, 'createdAt' | 'updatedAt'>;

@Injectable()
export class EmailPreferencesService {
  constructor(
    private readonly repo: EmailPreferencesRepository,
    private readonly providerService: EmailProviderService,
    private readonly recipientService: EmailRecipientService,
    private readonly templateService: EmailTemplateService,
  ) {}

  async findForUser(user: RequestUser): Promise<EffectiveEmailPreferences> {
    return (await this.getForUser(user.id)) ?? { userId: user.id, defaultProviderId: null, defaultRecipientId: null, defaultTemplateId: null };
  }

  async upsert(dto: UpdateEmailPreferencesDto, user: RequestUser): Promise<EffectiveEmailPreferences> {
    if (dto.defaultProviderId !== undefined && dto.defaultProviderId !== null) {
      await this.providerService.findOne(dto.defaultProviderId, user);
    }
    if (dto.defaultRecipientId !== undefined && dto.defaultRecipientId !== null) {
      await this.recipientService.getOwnedById(dto.defaultRecipientId, user);
    }
    if (dto.defaultTemplateId !== undefined && dto.defaultTemplateId !== null) {
      await this.templateService.findOne(dto.defaultTemplateId, user);
    }
    await this.repo.setDefaults(user.id, dto);
    return this.findForUser(user);
  }

  /**
   * The defaults sending actually uses: the preferences row, falling back to a row still flagged
   * isDefault for any default the row leaves empty. Null when the account has neither.
   */
  async getForUser(userId: number): Promise<EffectiveEmailPreferences | null> {
    const [prefs] = await this.repo.findByUserId(userId);
    const needsFallback = !prefs || prefs.defaultProviderId === null || prefs.defaultRecipientId === null || prefs.defaultTemplateId === null;
    const flagged = needsFallback ? await this.repo.findFlaggedDefaults(userId) : null;
    const defaults = {
      defaultProviderId: prefs?.defaultProviderId ?? flagged?.providerId ?? null,
      defaultRecipientId: prefs?.defaultRecipientId ?? flagged?.recipientId ?? null,
      defaultTemplateId: prefs?.defaultTemplateId ?? flagged?.templateId ?? null,
    };
    if (prefs) return { ...prefs, ...defaults };
    if (defaults.defaultProviderId === null && defaults.defaultRecipientId === null && defaults.defaultTemplateId === null) return null;
    return { userId, ...defaults };
  }
}
