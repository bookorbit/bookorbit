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
    roles: [],
  };

  const service = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    setDefault: jest.fn(),
  } as unknown as EmailRecipientService;

  const controller = new EmailRecipientController(service);

  beforeEach(() => {
    jest.clearAllMocks();
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
});
