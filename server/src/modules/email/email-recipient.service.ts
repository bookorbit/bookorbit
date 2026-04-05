import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { EmailRecipientRepository } from './email-recipient.repository';
import { EmailTemplateService } from './email-template.service';
import { CreateEmailRecipientDto } from './dto/create-email-recipient.dto';
import { UpdateEmailRecipientDto } from './dto/update-email-recipient.dto';
import type { EmailRecipient } from '../../db/schema';
import { isUniqueViolation } from './email-db-error.util';

@Injectable()
export class EmailRecipientService {
  constructor(
    private readonly repo: EmailRecipientRepository,
    private readonly templateService: EmailTemplateService,
  ) {}

  findAll(user: RequestUser) {
    return this.repo.findAllForUser(user.id);
  }

  async findOne(id: number, user: RequestUser) {
    return this.getOwnedById(id, user);
  }

  async create(dto: CreateEmailRecipientDto, user: RequestUser) {
    await this.validateDefaultTemplate(dto.defaultTemplateId, user);
    try {
      const [created] = await this.repo.insert({
        userId: user.id,
        name: dto.name,
        email: dto.email,
        deviceType: dto.deviceType ?? null,
        preferredFormat: dto.preferredFormat ?? null,
        defaultTemplateId: dto.defaultTemplateId ?? null,
      });
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An email recipient with this email already exists');
      }
      throw error;
    }
  }

  async update(id: number, dto: UpdateEmailRecipientDto, user: RequestUser) {
    await this.getOwnedById(id, user);
    await this.validateDefaultTemplate(dto.defaultTemplateId, user);
    try {
      const [updated] = await this.repo.update(id, user.id, dto);
      if (!updated) throw new NotFoundException('Recipient not found');
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An email recipient with this email already exists');
      }
      throw error;
    }
  }

  async remove(id: number, user: RequestUser) {
    await this.getOwnedById(id, user);
    await this.repo.delete(id, user.id);
  }

  async setDefault(id: number, user: RequestUser) {
    await this.getOwnedById(id, user);
    const updated = (await this.repo.setDefault(id, user.id)).find((recipient) => recipient.id === id);
    if (!updated) throw new NotFoundException('Recipient not found');
    return updated;
  }

  async getOwnedById(id: number, user: RequestUser): Promise<EmailRecipient> {
    const [recipient] = await this.getOwnedByIds([id], user);
    return recipient;
  }

  async getOwnedByIds(ids: number[], user: RequestUser): Promise<EmailRecipient[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return [];

    const recipients = await this.repo.findByIds(uniqueIds);
    const recipientById = new Map(recipients.map((recipient) => [recipient.id, recipient]));
    const missingId = uniqueIds.find((id) => !recipientById.has(id));
    if (missingId !== undefined) throw new NotFoundException('Recipient not found');

    for (const recipient of recipients) {
      if (recipient.userId !== user.id) throw new ForbiddenException('Cannot modify this recipient');
    }

    return uniqueIds.map((id) => recipientById.get(id)!);
  }

  private async validateDefaultTemplate(templateId: number | null | undefined, user: RequestUser): Promise<void> {
    if (templateId === null || templateId === undefined) return;
    await this.templateService.findOne(templateId, user);
  }
}
