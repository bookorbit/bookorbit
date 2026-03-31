import { Test, TestingModule } from '@nestjs/testing';
import { EmailPreferencesService } from './email-preferences.service';
import { EmailPreferencesRepository } from './email-preferences.repository';
import { EmailProviderService } from './email-provider.service';
import { EmailRecipientService } from './email-recipient.service';
import { EmailTemplateService } from './email-template.service';
import type { RequestUser } from '../../common/types/request-user';

describe('EmailPreferencesService', () => {
  let service: EmailPreferencesService;
  let repo: EmailPreferencesRepository;
  let providerService: EmailProviderService;
  let recipientService: EmailRecipientService;
  let templateService: EmailTemplateService;

  const mockUser: RequestUser = {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    email: 'test@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    isSuperuser: false,
    permissions: [],
  };

  const mockPrefs = { userId: 1, defaultProviderId: 10, defaultRecipientId: 20 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailPreferencesService,
        {
          provide: EmailPreferencesRepository,
          useValue: {
            findByUserId: vi.fn().mockResolvedValue([mockPrefs]),
            upsert: vi.fn().mockResolvedValue([mockPrefs]),
          },
        },
        {
          provide: EmailProviderService,
          useValue: { findOne: vi.fn().mockResolvedValue({ id: 10 }) },
        },
        {
          provide: EmailRecipientService,
          useValue: { getOwnedById: vi.fn().mockResolvedValue({ id: 20 }) },
        },
        {
          provide: EmailTemplateService,
          useValue: { findOne: vi.fn().mockResolvedValue({ id: 30 }) },
        },
      ],
    }).compile();

    service = module.get<EmailPreferencesService>(EmailPreferencesService);
    repo = module.get<EmailPreferencesRepository>(EmailPreferencesRepository);
    providerService = module.get<EmailProviderService>(EmailProviderService);
    recipientService = module.get<EmailRecipientService>(EmailRecipientService);
    templateService = module.get<EmailTemplateService>(EmailTemplateService);
  });

  it('should find for user', async () => {
    const result = await service.findForUser(mockUser);
    expect(result.defaultProviderId).toBe(10);
  });

  it('should return default object if not found', async () => {
    (repo.findByUserId as vi.Mock).mockResolvedValue([]);
    const result = await service.findForUser(mockUser);
    expect(result.userId).toBe(1);
    expect(result.defaultProviderId).toBeNull();
  });

  it('should upsert preferences', async () => {
    const dto = { defaultProviderId: 99 };
    const result = await service.upsert(dto, mockUser);
    expect(repo.upsert).toHaveBeenCalledWith(1, dto);
    expect(providerService.findOne).toHaveBeenCalledWith(99, mockUser);
    expect(result.defaultProviderId).toBe(10);
  });

  it('should validate recipient ownership when defaultRecipientId is provided', async () => {
    await service.upsert({ defaultRecipientId: 55 }, mockUser);
    expect(recipientService.getOwnedById).toHaveBeenCalledWith(55, mockUser);
  });

  it('should validate template access when defaultTemplateId is provided', async () => {
    await service.upsert({ defaultTemplateId: 66 }, mockUser);
    expect(templateService.findOne).toHaveBeenCalledWith(66, mockUser);
  });

  it('should get for user by id', async () => {
    const result = await service.getForUser(1);
    expect(result?.defaultProviderId).toBe(10);
  });
});
