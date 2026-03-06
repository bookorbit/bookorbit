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
    roles: [],
  };

  const service = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
  } as unknown as EmailRecipientGroupService;

  const controller = new EmailRecipientGroupController(service);

  beforeEach(() => {
    jest.clearAllMocks();
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
});
