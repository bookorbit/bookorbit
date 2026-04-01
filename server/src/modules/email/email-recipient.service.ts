import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { EmailRecipientRepository } from './email-recipient.repository';
import { CreateEmailRecipientDto } from './dto/create-email-recipient.dto';
import { UpdateEmailRecipientDto } from './dto/update-email-recipient.dto';
import type { EmailRecipient } from '../../db/schema';

@Injectable()
export class EmailRecipientService {
  constructor(private readonly repo: EmailRecipientRepository) {}

  findAll(user: RequestUser) {
    return this.repo.findAllForUser(user.id);
  }

  async findOne(id: number, user: RequestUser) {
    return this.getOwnedById(id, user);
  }

  async create(dto: CreateEmailRecipientDto, user: RequestUser) {
    const [created] = await this.repo.insert({
      userId: user.id,
      name: dto.name,
      email: dto.email,
      deviceType: dto.deviceType ?? null,
      preferredFormat: dto.preferredFormat ?? null,
      defaultTemplateId: dto.defaultTemplateId ?? null,
    });
    return created;
  }

  async update(id: number, dto: UpdateEmailRecipientDto, user: RequestUser) {
    await this.getOwnedById(id, user);
    const [updated] = await this.repo.update(id, user.id, dto);
    if (!updated) throw new NotFoundException('Recipient not found');
    return updated;
  }

  async remove(id: number, user: RequestUser) {
    await this.getOwnedById(id, user);
    await this.repo.delete(id, user.id);
  }

  async setDefault(id: number, user: RequestUser) {
    await this.getOwnedById(id, user);
    await this.repo.clearDefault(user.id);
    const [updated] = await this.repo.setDefault(id, user.id);
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
}
