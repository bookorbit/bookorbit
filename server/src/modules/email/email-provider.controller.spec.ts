import type { RequestUser } from '../../common/types/request-user';
import { EmailProviderController } from './email-provider.controller';
import type { CreateEmailProviderDto } from './dto/create-email-provider.dto';
import type { UpdateEmailProviderDto } from './dto/update-email-provider.dto';
import { EmailProviderService } from './email-provider.service';

describe('EmailProviderController', () => {
  const user: RequestUser = {
    id: 10,
    username: 'owner',
    name: 'Owner',
    email: 'owner@example.com',
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
    toggleShared: jest.fn(),
    testConnection: jest.fn(),
  } as unknown as EmailProviderService;

  const controller = new EmailProviderController(service);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates findAll', async () => {
    await controller.findAll(user);
    expect(service.findAll).toHaveBeenCalledWith(user);
  });

  it('delegates findOne with parsed id', async () => {
    await controller.findOne(55, user);
    expect(service.findOne).toHaveBeenCalledWith(55, user);
  });

  it('delegates create', async () => {
    const dto: CreateEmailProviderDto = {
      name: 'SMTP',
      host: 'smtp.example.com',
      port: 587,
      auth: true,
      ssl: false,
      startTls: true,
    };

    await controller.create(dto, user);
    expect(service.create).toHaveBeenCalledWith(dto, user);
  });

  it('delegates update', async () => {
    const dto: UpdateEmailProviderDto = { port: 2525 };
    await controller.update(12, dto, user);
    expect(service.update).toHaveBeenCalledWith(12, dto, user);
  });

  it('delegates remove', async () => {
    await controller.remove(9, user);
    expect(service.remove).toHaveBeenCalledWith(9, user);
  });

  it('delegates setDefault', async () => {
    await controller.setDefault(3, user);
    expect(service.setDefault).toHaveBeenCalledWith(3, user);
  });

  it('delegates toggleShared', async () => {
    await controller.toggleShared(3, user);
    expect(service.toggleShared).toHaveBeenCalledWith(3, user);
  });

  it('delegates testConnection', async () => {
    await controller.testConnection(3, user);
    expect(service.testConnection).toHaveBeenCalledWith(3, user);
  });
});
