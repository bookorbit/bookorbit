import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { EmailRecipientGroupRepository } from './email-recipient-group.repository';
import { EmailRecipientRepository } from './email-recipient.repository';
import { CreateEmailRecipientGroupDto } from './dto/create-email-recipient-group.dto';
import { UpdateEmailRecipientGroupDto } from './dto/update-email-recipient-group.dto';
import type { EmailRecipientGroup } from '../../db/schema';

@Injectable()
export class EmailRecipientGroupService {
  constructor(
    private readonly repo: EmailRecipientGroupRepository,
    private readonly recipientRepo: EmailRecipientRepository,
  ) {}

  async findAll(user: RequestUser) {
    const groups = await this.repo.findAllForUser(user.id);
    if (groups.length === 0) return [];

    const memberRows = await this.repo.findMembersForGroupIds(groups.map((group) => group.id));
    const membersByGroupId = new Map<number, Array<(typeof memberRows)[number]>>();
    for (const memberRow of memberRows) {
      const rows = membersByGroupId.get(memberRow.groupId);
      if (rows) {
        rows.push(memberRow);
      } else {
        membersByGroupId.set(memberRow.groupId, [memberRow]);
      }
    }

    return groups.map((group) => ({
      ...group,
      members: (membersByGroupId.get(group.id) ?? []).map((row) => row.recipient),
    }));
  }

  async findOne(id: number, user: RequestUser) {
    const group = await this.getOwned(id, user);
    const memberRows = await this.repo.findMembers(group.id);
    return { ...group, members: memberRows.map((r) => r.recipient) };
  }

  async create(dto: CreateEmailRecipientGroupDto, user: RequestUser) {
    const [created] = await this.repo.insert({
      userId: user.id,
      name: dto.name,
      defaultTemplateId: dto.defaultTemplateId ?? null,
    });
    return { ...created, members: [] };
  }

  async update(id: number, dto: UpdateEmailRecipientGroupDto, user: RequestUser) {
    await this.getOwned(id, user);
    const [updated] = await this.repo.update(id, user.id, dto);
    if (!updated) throw new NotFoundException('Group not found');
    return updated;
  }

  async remove(id: number, user: RequestUser) {
    await this.getOwned(id, user);
    await this.repo.delete(id, user.id);
  }

  async addMember(groupId: number, recipientId: number, user: RequestUser) {
    await this.getOwned(groupId, user);
    const [recipient] = await this.recipientRepo.findById(recipientId);
    if (!recipient) throw new NotFoundException('Recipient not found');
    if (recipient.userId !== user.id) throw new ForbiddenException('Cannot add a recipient you do not own');
    await this.repo.addMember(groupId, recipientId);
    return this.findOne(groupId, user);
  }

  async removeMember(groupId: number, recipientId: number, user: RequestUser) {
    await this.getOwned(groupId, user);
    await this.repo.removeMember(groupId, recipientId);
  }

  async expandOwnedGroupToRecipientIds(groupId: number, user: RequestUser): Promise<number[]> {
    await this.getOwned(groupId, user);
    const memberRows = await this.repo.findMembers(groupId);
    return memberRows.map((r) => r.recipient.id);
  }

  private async getOwned(id: number, user: RequestUser): Promise<EmailRecipientGroup> {
    const [group] = await this.repo.findById(id);
    if (!group) throw new NotFoundException('Group not found');
    if (group.userId !== user.id) throw new ForbiddenException('Cannot modify this group');
    return group;
  }
}
