import { Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { EmailPreferencesRepository } from './email-preferences.repository';
import { UpdateEmailPreferencesDto } from './dto/update-email-preferences.dto';

@Injectable()
export class EmailPreferencesService {
  constructor(private readonly repo: EmailPreferencesRepository) {}

  async findForUser(user: RequestUser) {
    const [prefs] = await this.repo.findByUserId(user.id);
    return prefs ?? { userId: user.id, defaultProviderId: null, defaultRecipientId: null, defaultTemplateId: null };
  }

  async upsert(dto: UpdateEmailPreferencesDto, user: RequestUser) {
    const [updated] = await this.repo.upsert(user.id, dto);
    return updated;
  }

  async getForUser(userId: number) {
    const [prefs] = await this.repo.findByUserId(userId);
    return prefs ?? null;
  }
}
