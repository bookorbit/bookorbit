import { basename } from 'node:path';

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EmailTemplatePreview, EmailTemplate as EmailTemplateJson, EmailTemplateTextPreview } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { Unserialized } from '../../common/types/unserialized';
import { EmailTemplateRepository } from './email-template.repository';
import { EmailPreferencesRepository } from './email-preferences.repository';
import { EmailTemplateContextService } from './email-template-context.service';
import { renderTemplate } from './email-template-renderer';
import { EmailBookAccessService } from './email-book-access.service';
import { EmailFileSelector } from './email-file-selector';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import type { EmailTemplate } from '../../db/schema';
import { isUniqueViolation } from './email-db-error.util';

type EmailTemplateResponse = Unserialized<EmailTemplateJson, 'createdAt' | 'updatedAt'>;

@Injectable()
export class EmailTemplateService {
  constructor(
    private readonly repo: EmailTemplateRepository,
    private readonly contextService: EmailTemplateContextService,
    private readonly bookAccessService: EmailBookAccessService,
    private readonly preferences: EmailPreferencesRepository,
    private readonly fileSelector: EmailFileSelector,
  ) {}

  async findAll(user: RequestUser): Promise<EmailTemplateResponse[]> {
    const templates = await this.repo.findAllForUser(user.id);
    const hasUserDefault = templates.some((t) => t.userId !== null && t.isDefault);
    if (!hasUserDefault) return templates;
    return templates.map((t) => (t.userId === null ? { ...t, isDefault: false } : t));
  }

  async findOne(id: number, user: RequestUser): Promise<EmailTemplateResponse> {
    return this.getAccessible(id, user);
  }

  async create(dto: CreateEmailTemplateDto, user: RequestUser): Promise<EmailTemplateResponse> {
    try {
      const [created] = await this.repo.insert({
        userId: user.id,
        name: dto.name,
        subject: dto.subject,
        bodyText: dto.bodyText,
      });
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An email template with this name already exists');
      }
      throw error;
    }
  }

  async update(id: number, dto: UpdateEmailTemplateDto, user: RequestUser): Promise<EmailTemplateResponse> {
    const template = await this.getAccessible(id, user);
    const isSuperuser = user.isSuperuser;

    if (template.isSystem && !isSuperuser) throw new ForbiddenException('Only administrators can modify system templates');
    if (!template.isSystem && template.userId !== user.id) throw new ForbiddenException('Cannot modify this template');

    try {
      const [updated] = template.isSystem ? await this.repo.updateById(id, dto) : await this.repo.update(id, user.id, dto);
      if (!updated) throw new NotFoundException('Template not found');
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An email template with this name already exists');
      }
      throw error;
    }
  }

  async remove(id: number, user: RequestUser) {
    const template = await this.getAccessible(id, user);
    if (template.isSystem) throw new BadRequestException('System templates cannot be deleted');
    if (template.isDefault) throw new BadRequestException('Cannot delete your default template. Set another as default first.');
    if (template.userId !== user.id) throw new ForbiddenException('Cannot delete this template');

    await this.repo.delete(id, user.id);
  }

  async setDefault(id: number, user: RequestUser): Promise<EmailTemplateResponse> {
    const template = await this.getAccessible(id, user);
    if (template.userId !== user.id && !template.isSystem) {
      throw new ForbiddenException('Cannot set this template as default');
    }
    await this.preferences.setDefaults(user.id, { defaultTemplateId: id });
    if (template.isSystem) return template;
    const [updated] = await this.repo.findById(id);
    if (!updated) throw new NotFoundException('Template not found');
    return updated;
  }

  async preview(id: number, bookId: number, fileId: number | null, user: RequestUser): Promise<EmailTemplatePreview> {
    const template = await this.getAccessible(id, user);
    // This route predates the attachment, so its response keeps exactly the shape released clients read.
    const { subject, bodyText } = await this.previewText(template.subject, template.bodyText, bookId, user, fileId);
    return { subject, bodyText };
  }

  /**
   * The text as a send of this book would read, and the file it would attach, named as the email names
   * it. Without a file, {{format}} and {{fileSize}} describe the edition a send would pick by default.
   */
  async previewText(
    subject: string,
    bodyText: string,
    bookId: number,
    user: RequestUser,
    fileId: number | null = null,
  ): Promise<Required<EmailTemplateTextPreview>> {
    await this.bookAccessService.assertUserCanAccessBook(bookId, user);
    const file = await this.fileSelector.select(bookId, fileId, null).catch(() => null);
    const context = await this.contextService.buildForBook(bookId, file?.id ?? null, user.name);
    const attachment = file ? { fileName: basename(file.absolutePath), format: file.format, sizeBytes: file.sizeBytes } : null;
    return { ...renderTemplate(subject, bodyText, context), attachment };
  }

  async resolveTemplate(templateId: number | null | undefined, user: RequestUser): Promise<EmailTemplate> {
    if (templateId !== null && templateId !== undefined) {
      const [tpl] = await this.repo.findById(templateId);
      if (!tpl) {
        throw new NotFoundException('Template not found');
      }
      if (tpl.userId !== null && tpl.userId !== user.id) {
        throw new ForbiddenException('No access to the specified email template');
      }
      return tpl;
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
