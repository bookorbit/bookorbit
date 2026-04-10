import { AuditAction, AuditResource } from '@projectx/types';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { EmailRecipientController } from './email-recipient.controller';
import type { CreateEmailRecipientDto } from './dto/create-email-recipient.dto';
import type { UpdateEmailRecipientDto } from './dto/update-email-recipient.dto';
import { EmailRecipientService } from './email-recipient.service';

describe('EmailRecipientController', () => {
  const user: RequestUser = {
    id: 2,
    username: 'reader2',
    name: 'Reader 2',
    email: 'reader2@example.com',
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
  } as unknown as EmailRecipientService;

  const controller = new EmailRecipientController(service);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates findAll and findOne', async () => {
    await controller.findAll(user);
    await controller.findOne(4, user);

    expect(service.findAll).toHaveBeenCalledWith(user);
    expect(service.findOne).toHaveBeenCalledWith(4, user);
  });

  it('delegates create and update', async () => {
    const createDto: CreateEmailRecipientDto = {
      name: 'Kindle Address',
      email: 'kindle@example.com',
      deviceType: 'kindle',
      preferredFormat: 'mobi',
      defaultTemplateId: 10,
    };
    const updateDto: UpdateEmailRecipientDto = { name: 'Renamed', preferredFormat: null };

    await controller.create(createDto, user);
    await controller.update(4, updateDto, user);

    expect(service.create).toHaveBeenCalledWith(createDto, user);
    expect(service.update).toHaveBeenCalledWith(4, updateDto, user);
  });

  it('delegates remove and setDefault', async () => {
    await controller.remove(4, user);
    await controller.setDefault(4, user);

    expect(service.remove).toHaveBeenCalledWith(4, user);
    expect(service.setDefault).toHaveBeenCalledWith(4, user);
  });

  it('defines audit metadata for recipient mutation routes', () => {
    const createAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailRecipientController.prototype.create) as {
      action: AuditAction;
      resource: AuditResource;
      description: (req: unknown, res: { email?: string }) => string;
    };
    expect(createAudit.action).toBe(AuditAction.EmailRecipientCreate);
    expect(createAudit.resource).toBe(AuditResource.EmailRecipient);
    expect(createAudit.description({} as never, { email: 'kindle@example.com' })).toBe("Created email recipient 'kindle@example.com'");

    const updateAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailRecipientController.prototype.update) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }, res: unknown) => string;
    };
    expect(updateAudit.getResourceId({ params: { id: '3' } })).toBe(3);
    expect(updateAudit.description({ params: { id: '3' } }, null)).toBe('Updated email recipient #3');

    const removeAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailRecipientController.prototype.remove) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }, res: unknown) => string;
    };
    expect(removeAudit.getResourceId({ params: { id: '3' } })).toBe(3);
    expect(removeAudit.description({ params: { id: '3' } }, null)).toBe('Deleted email recipient #3');
  });
});
