import { Test, TestingModule } from '@nestjs/testing';
import { EmailPreferencesService } from './email-preferences.service';
import { EmailPreferencesRepository } from './email-preferences.repository';
import { EmailProviderService } from './email-provider.service';
import { EmailRecipientService } from './email-recipient.service';
import { EmailTemplateService } from './email-template.service';
import type { RequestUser } from '../../common/types/request-user';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

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

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };

  const mockPrefs = { id: 1, userId: 1, defaultProviderId: 10, defaultRecipientId: 20, defaultTemplateId: 30 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailPreferencesService,
        {
          provide: EmailPreferencesRepository,
          useValue: {
            findByUserId: vi.fn().mockResolvedValue([mockPrefs]),
            findFlaggedDefaults: vi.fn().mockResolvedValue({ providerId: null, recipientId: null, templateId: null }),
            setDefaults: vi.fn().mockResolvedValue(mockPrefs),
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

  it('returns the stored defaults without looking at the flags', async () => {
    const result = await service.findForUser(mockUser);
    expect(result).toEqual(mockPrefs);
    expect(repo.findFlaggedDefaults).not.toHaveBeenCalled();
  });

  it('returns empty defaults when the account has neither a row nor flags', async () => {
    (repo.findByUserId as vi.Mock).mockResolvedValue([]);
    const result = await service.findForUser(mockUser);
    expect(result).toEqual({ userId: 1, defaultProviderId: null, defaultRecipientId: null, defaultTemplateId: null });
    expect(await service.getForUser(1)).toBeNull();
  });

  it('falls back to rows still flagged isDefault, so star-only accounts keep their defaults', async () => {
    (repo.findByUserId as vi.Mock).mockResolvedValue([]);
    (repo.findFlaggedDefaults as vi.Mock).mockResolvedValue({ providerId: 4, recipientId: 5, templateId: null });

    expect(await service.getForUser(1)).toEqual({ userId: 1, defaultProviderId: 4, defaultRecipientId: 5, defaultTemplateId: null });
  });

  it('fills only the empty fields from the flags', async () => {
    (repo.findByUserId as vi.Mock).mockResolvedValue([{ ...mockPrefs, defaultRecipientId: null }]);
    (repo.findFlaggedDefaults as vi.Mock).mockResolvedValue({ providerId: 99, recipientId: 7, templateId: 98 });

    expect(await service.getForUser(1)).toEqual({ ...mockPrefs, defaultRecipientId: 7 });
  });

  it('writes the defaults through setDefaults, which also moves the flags', async () => {
    const dto = { defaultProviderId: 99 };
    const result = await service.upsert(dto, mockUser);
    expect(providerService.findOne).toHaveBeenCalledWith(99, mockUser);
    expect(repo.setDefaults).toHaveBeenCalledWith(1, dto);
    expect(result.defaultProviderId).toBe(10);
  });

  it('clears a default without validating anything', async () => {
    await service.upsert({ defaultRecipientId: null }, mockUser);
    expect(recipientService.getOwnedById).not.toHaveBeenCalled();
    expect(repo.setDefaults).toHaveBeenCalledWith(1, { defaultRecipientId: null });
  });

  it('should validate recipient ownership when defaultRecipientId is provided', async () => {
    await service.upsert({ defaultRecipientId: 55 }, mockUser);
    expect(recipientService.getOwnedById).toHaveBeenCalledWith(55, mockUser);
  });

  it('should validate template access when defaultTemplateId is provided', async () => {
    await service.upsert({ defaultTemplateId: 66 }, mockUser);
    expect(templateService.findOne).toHaveBeenCalledWith(66, mockUser);
  });

  it('does not write when validation fails', async () => {
    (providerService.findOne as vi.Mock).mockRejectedValue(new Error('No access to this provider'));
    await expect(service.upsert({ defaultProviderId: 3 }, mockUser)).rejects.toThrow('No access to this provider');
    expect(repo.setDefaults).not.toHaveBeenCalled();
  });
});
