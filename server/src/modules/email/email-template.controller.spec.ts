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
    roles: [],
  };

  const service = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    setDefault: jest.fn(),
    preview: jest.fn(),
  } as unknown as EmailTemplateService;

  const controller = new EmailTemplateController(service);

  beforeEach(() => {
    jest.clearAllMocks();
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
});
