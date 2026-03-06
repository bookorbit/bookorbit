import { Test, TestingModule } from '@nestjs/testing';
import { EmailPreferencesService } from './email-preferences.service';
import { EmailPreferencesRepository } from './email-preferences.repository';
import type { RequestUser } from '../../common/types/request-user';

describe('EmailPreferencesService', () => {
  let service: EmailPreferencesService;
  let repo: EmailPreferencesRepository;

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
    roles: [],
  };

  const mockPrefs = { userId: 1, defaultProviderId: 10, defaultRecipientId: 20 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailPreferencesService,
        {
          provide: EmailPreferencesRepository,
          useValue: {
            findByUserId: jest.fn().mockResolvedValue([mockPrefs]),
            upsert: jest.fn().mockResolvedValue([mockPrefs]),
          },
        },
      ],
    }).compile();

    service = module.get<EmailPreferencesService>(EmailPreferencesService);
    repo = module.get<EmailPreferencesRepository>(EmailPreferencesRepository);
  });

  it('should find for user', async () => {
    const result = await service.findForUser(mockUser);
    expect(result.defaultProviderId).toBe(10);
  });

  it('should return default object if not found', async () => {
    (repo.findByUserId as jest.Mock).mockResolvedValue([]);
    const result = await service.findForUser(mockUser);
    expect(result.userId).toBe(1);
    expect(result.defaultProviderId).toBeNull();
  });

  it('should upsert preferences', async () => {
    const dto = { defaultProviderId: 99 };
    const result = await service.upsert(dto, mockUser);
    expect(repo.upsert).toHaveBeenCalledWith(1, dto);
    expect(result.defaultProviderId).toBe(10);
  });

  it('should get for user by id', async () => {
    const result = await service.getForUser(1);
    expect(result?.defaultProviderId).toBe(10);
  });
});
