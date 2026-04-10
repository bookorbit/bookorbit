import { AuditAction, AuditResource } from '@projectx/types';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { EmailTemplateController } from './email-template.controller';
import type { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import type { PreviewTemplateDto } from './dto/preview-template.dto';
import type { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { EmailTemplateService } from './email-template.service';

describe('EmailTemplateController', () => {
  const user: RequestUser = {
    id: 14,
    username: 'templater',
    name: 'Template User',
    email: 'templater@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    isSuperuser: false,
    permissions: [],
  };

  const service = {
    findAll: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setDefault: vi.fn(),
    preview: vi.fn(),
  } as unknown as EmailTemplateService;

  const controller = new EmailTemplateController(service);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates list and retrieval', async () => {
    await controller.findAll(user);
    await controller.findOne(2, user);

    expect(service.findAll).toHaveBeenCalledWith(user);
    expect(service.findOne).toHaveBeenCalledWith(2, user);
  });

  it('delegates create and update', async () => {
    const createDto: CreateEmailTemplateDto = { name: 'Default', subject: 'Subject', bodyText: 'Body' };
    const updateDto: UpdateEmailTemplateDto = { subject: 'Updated subject' };

    await controller.create(createDto, user);
    await controller.update(2, updateDto, user);

    expect(service.create).toHaveBeenCalledWith(createDto, user);
    expect(service.update).toHaveBeenCalledWith(2, updateDto, user);
  });

  it('delegates remove and setDefault', async () => {
    await controller.remove(2, user);
    await controller.setDefault(2, user);

    expect(service.remove).toHaveBeenCalledWith(2, user);
    expect(service.setDefault).toHaveBeenCalledWith(2, user);
  });

  it('passes preview request with book id and null recipient override', async () => {
    const dto: PreviewTemplateDto = { bookId: 77 };

    await controller.preview(2, dto, user);

    expect(service.preview).toHaveBeenCalledWith(2, 77, null, user);
  });

  it('defines audit metadata for template mutation endpoints', () => {
    const createAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailTemplateController.prototype.create) as {
      action: AuditAction;
      resource: AuditResource;
      description: (req: unknown, res: { name?: string }) => string;
    };
    expect(createAudit.action).toBe(AuditAction.EmailTemplateCreate);
    expect(createAudit.resource).toBe(AuditResource.EmailTemplate);
    expect(createAudit.description({} as never, { name: 'Default' })).toBe("Created email template 'Default'");

    const updateAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailTemplateController.prototype.update) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }, res: unknown) => string;
    };
    expect(updateAudit.getResourceId({ params: { id: '5' } })).toBe(5);
    expect(updateAudit.description({ params: { id: '5' } }, null)).toBe('Updated email template #5');

    const removeAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailTemplateController.prototype.remove) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }, res: unknown) => string;
    };
    expect(removeAudit.getResourceId({ params: { id: '5' } })).toBe(5);
    expect(removeAudit.description({ params: { id: '5' } }, null)).toBe('Deleted email template #5');

    const setDefaultAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailTemplateController.prototype.setDefault) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }, res: unknown) => string;
    };
    expect(setDefaultAudit.getResourceId({ params: { id: '5' } })).toBe(5);
    expect(setDefaultAudit.description({ params: { id: '5' } }, null)).toBe('Set email template #5 as default');
  });
});
