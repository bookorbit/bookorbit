import { Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { EmailPreferencesRepository } from './email-preferences.repository';
import { EmailProviderService } from './email-provider.service';
import { EmailRecipientService } from './email-recipient.service';
import { EmailTemplateService } from './email-template.service';
import { UpdateEmailPreferencesDto } from './dto/update-email-preferences.dto';

@Injectable()
export class EmailPreferencesService {
  constructor(
    private readonly repo: EmailPreferencesRepository,
    private readonly providerService: EmailProviderService,
    private readonly recipientService: EmailRecipientService,
    private readonly templateService: EmailTemplateService,
  ) {}

  async findForUser(user: RequestUser) {
    const [prefs] = await this.repo.findByUserId(user.id);
    return prefs ?? { userId: user.id, defaultProviderId: null, defaultRecipientId: null, defaultTemplateId: null };
  }

  async upsert(dto: UpdateEmailPreferencesDto, user: RequestUser) {
    if (dto.defaultProviderId !== undefined && dto.defaultProviderId !== null) {
      await this.providerService.findOne(dto.defaultProviderId, user);
    }
    if (dto.defaultRecipientId !== undefined && dto.defaultRecipientId !== null) {
      await this.recipientService.getOwnedById(dto.defaultRecipientId, user);
    }
    if (dto.defaultTemplateId !== undefined && dto.defaultTemplateId !== null) {
      await this.templateService.findOne(dto.defaultTemplateId, user);
    }
    const [updated] = await this.repo.upsert(user.id, dto);
    return updated;
  }

  async getForUser(userId: number) {
    const [prefs] = await this.repo.findByUserId(userId);
    return prefs ?? null;
  }
}
