import { AuditAction, AuditResource } from '@projectx/types';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { EmailRecipientGroupController } from './email-recipient-group.controller';
import type { AddGroupMemberDto } from './dto/add-group-member.dto';
import type { CreateEmailRecipientGroupDto } from './dto/create-email-recipient-group.dto';
import type { UpdateEmailRecipientGroupDto } from './dto/update-email-recipient-group.dto';
import { EmailRecipientGroupService } from './email-recipient-group.service';

describe('EmailRecipientGroupController', () => {
  const user: RequestUser = {
    id: 5,
    username: 'u5',
    name: 'User Five',
    email: 'u5@example.com',
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
    addMember: vi.fn(),
    removeMember: vi.fn(),
  } as unknown as EmailRecipientGroupService;

  const controller = new EmailRecipientGroupController(service);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates base CRUD actions', async () => {
    const createDto: CreateEmailRecipientGroupDto = { name: 'Kindle Users', defaultTemplateId: 8 };
    const updateDto: UpdateEmailRecipientGroupDto = { name: 'Updated Group', defaultTemplateId: null };

    await controller.findAll(user);
    await controller.findOne(11, user);
    await controller.create(createDto, user);
    await controller.update(11, updateDto, user);
    await controller.remove(11, user);

    expect(service.findAll).toHaveBeenCalledWith(user);
    expect(service.findOne).toHaveBeenCalledWith(11, user);
    expect(service.create).toHaveBeenCalledWith(createDto, user);
    expect(service.update).toHaveBeenCalledWith(11, updateDto, user);
    expect(service.remove).toHaveBeenCalledWith(11, user);
  });

  it('delegates member add/remove with both ids', async () => {
    const dto: AddGroupMemberDto = { recipientId: 42 };

    await controller.addMember(3, dto, user);
    await controller.removeMember(3, 42, user);

    expect(service.addMember).toHaveBeenCalledWith(3, 42, user);
    expect(service.removeMember).toHaveBeenCalledWith(3, 42, user);
  });

  it('defines audit metadata for group mutations', () => {
    const createAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailRecipientGroupController.prototype.create) as {
      action: AuditAction;
      resource: AuditResource;
      description: (req: unknown, res: { name?: string }) => string;
    };
    expect(createAudit.action).toBe(AuditAction.EmailRecipientGroupCreate);
    expect(createAudit.resource).toBe(AuditResource.EmailRecipientGroup);
    expect(createAudit.description({} as never, { name: 'Group A' })).toBe("Created email recipient group 'Group A'");

    const updateAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailRecipientGroupController.prototype.update) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }, res: unknown) => string;
    };
    expect(updateAudit.getResourceId({ params: { id: '4' } })).toBe(4);
    expect(updateAudit.description({ params: { id: '4' } }, null)).toBe('Updated email recipient group #4');

    const deleteAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailRecipientGroupController.prototype.remove) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }, res: unknown) => string;
    };
    expect(deleteAudit.getResourceId({ params: { id: '4' } })).toBe(4);
    expect(deleteAudit.description({ params: { id: '4' } }, null)).toBe('Deleted email recipient group #4');

    const addMemberAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailRecipientGroupController.prototype.addMember) as {
      getResourceId: (req: { params: Record<string, string>; body: { recipientId?: number } }) => number;
      description: (req: { params: Record<string, string>; body: { recipientId?: number } }, res: unknown) => string;
    };
    expect(addMemberAudit.getResourceId({ params: { id: '8' }, body: { recipientId: 11 } })).toBe(8);
    expect(addMemberAudit.description({ params: { id: '8' }, body: { recipientId: 11 } }, null)).toBe('Added recipient #11 to group #8');

    const removeMemberAudit = Reflect.getMetadata(AUDITABLE_KEY, EmailRecipientGroupController.prototype.removeMember) as {
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }, res: unknown) => string;
    };
    expect(removeMemberAudit.getResourceId({ params: { id: '8', recipientId: '11' } })).toBe(8);
    expect(removeMemberAudit.description({ params: { id: '8', recipientId: '11' } }, null)).toBe('Removed recipient #11 from group #8');
  });
});
