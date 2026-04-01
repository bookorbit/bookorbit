import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { EmailTemplateRepository } from './email-template.repository';
import { EmailTemplateContextService } from './email-template-context.service';
import { renderTemplate } from './email-template-renderer';
import { EmailBookAccessService } from './email-book-access.service';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import type { EmailTemplate } from '../../db/schema';

@Injectable()
export class EmailTemplateService {
  constructor(
    private readonly repo: EmailTemplateRepository,
    private readonly contextService: EmailTemplateContextService,
    private readonly bookAccessService: EmailBookAccessService,
  ) {}

  async findAll(user: RequestUser) {
    const templates = await this.repo.findAllForUser(user.id);
    const hasUserDefault = templates.some((t) => t.userId !== null && t.isDefault);
    if (!hasUserDefault) return templates;
    return templates.map((t) => (t.userId === null ? { ...t, isDefault: false } : t));
  }

  async findOne(id: number, user: RequestUser) {
    return this.getAccessible(id, user);
  }

  async create(dto: CreateEmailTemplateDto, user: RequestUser) {
    const [created] = await this.repo.insert({
      userId: user.id,
      name: dto.name,
      subject: dto.subject,
      bodyText: dto.bodyText,
    });
    return created;
  }

  async update(id: number, dto: UpdateEmailTemplateDto, user: RequestUser) {
    const template = await this.getAccessible(id, user);
    const isSuperuser = user.isSuperuser;

    if (template.isSystem && !isSuperuser) throw new ForbiddenException('Only administrators can modify system templates');
    if (!template.isSystem && template.userId !== user.id) throw new ForbiddenException('Cannot modify this template');

    const [updated] = template.isSystem ? await this.repo.updateById(id, dto) : await this.repo.update(id, user.id, dto);
    if (!updated) throw new NotFoundException('Template not found');
    return updated;
  }

  async remove(id: number, user: RequestUser) {
    const template = await this.getAccessible(id, user);
    if (template.isSystem) throw new BadRequestException('System templates cannot be deleted');
    if (template.isDefault) throw new BadRequestException('Cannot delete your default template. Set another as default first.');
    if (template.userId !== user.id) throw new ForbiddenException('Cannot delete this template');

    await this.repo.delete(id, user.id);
  }

  async setDefault(id: number, user: RequestUser) {
    const template = await this.getAccessible(id, user);
    if (template.userId !== user.id && !template.isSystem) {
      throw new ForbiddenException('Cannot set this template as default');
    }
    await this.repo.clearDefault(user.id);
    if (!template.isSystem) {
      const [updated] = await this.repo.setDefault(id, user.id);
      if (!updated) throw new NotFoundException('Template not found');
      return updated;
    }
    return template;
  }

  async preview(id: number, bookId: number, fileId: number | null, user: RequestUser) {
    const template = await this.getAccessible(id, user);
    await this.bookAccessService.assertUserCanAccessBook(bookId, user);
    const context = await this.contextService.buildForBook(bookId, fileId, user.name);
    return renderTemplate(template.subject, template.bodyText, context);
  }

  async resolveTemplate(templateId: number | null | undefined, user: RequestUser): Promise<EmailTemplate> {
    if (templateId) {
      const [tpl] = await this.repo.findById(templateId);
      if (tpl) {
        if (tpl.userId !== null && tpl.userId !== user.id) {
          throw new ForbiddenException('No access to the specified email template');
        }
        return tpl;
      }
    }
    const [userDefault] = await this.repo.findUserDefault(user.id);
    if (userDefault) return userDefault;
    const [system] = await this.repo.findSystemDefault();
    if (!system) throw new NotFoundException('No email template available');
    return system;
  }

  private async getAccessible(id: number, user: RequestUser): Promise<EmailTemplate> {
    const [template] = await this.repo.findById(id);
    if (!template) throw new NotFoundException('Template not found');
    if (template.userId !== null && template.userId !== user.id) {
      throw new ForbiddenException('No access to this template');
    }
    return template;
  }
}
