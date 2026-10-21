import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailProviderResolver } from './email-provider-resolver';
import { EmailProviderService } from './email-provider.service';
import { EmailPreferencesService } from './email-preferences.service';
import type { RequestUser } from '../../common/types/request-user';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

describe('EmailProviderResolver', () => {
  let resolver: EmailProviderResolver;
  let providerService: EmailProviderService;
  let preferencesService: EmailPreferencesService;

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
  const mockProvider = {
    id: 10,
    name: 'My SMTP',
    host: 'smtp.test.com',
    port: 587,
    username: 'test-user',
    plainPassword: 'decrypted-password',
    fromName: 'BookOrbit Bot',
    fromAddress: 'bot@example.com',
    auth: true,
    ssl: false,
    startTls: true,
    tlsRejectUnauthorized: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProviderResolver,
        {
          provide: EmailProviderService,
          useValue: {
            getProviderWithDecryptedPassword: vi.fn(),
            getSharedDefaultWithDecryptedPassword: vi.fn(),
          },
        },
        {
          provide: EmailPreferencesService,
          useValue: {
            getForUser: vi.fn(),
          },
        },
      ],
    }).compile();

    resolver = module.get<EmailProviderResolver>(EmailProviderResolver);
    providerService = module.get<EmailProviderService>(EmailProviderService);
    preferencesService = module.get<EmailPreferencesService>(EmailPreferencesService);
  });

  describe('resolve', () => {
    it('should resolve from requested provider ID', async () => {
      (providerService.getProviderWithDecryptedPassword as vi.Mock).mockResolvedValue(mockProvider);

      const result = await resolver.resolve(mockUser, 10);

      expect(providerService.getProviderWithDecryptedPassword).toHaveBeenCalledWith(10, mockUser);
      expect(result.providerId).toBe(10);
      expect(result.config.password).toBe('decrypted-password');
      expect(result.config.host).toBe('smtp.test.com');
      expect(result.config.fromName).toBe('BookOrbit Bot');
      expect(result.config.fromAddress).toBe('bot@example.com');
      expect(result.config.tlsRejectUnauthorized).toBe(true);
      expect(preferencesService.getForUser).not.toHaveBeenCalled();
      expect(providerService.getSharedDefaultWithDecryptedPassword).not.toHaveBeenCalled();
    });

    it('should include tlsRejectUnauthorized=false in resolved config when provider has it disabled', async () => {
      (providerService.getProviderWithDecryptedPassword as vi.Mock).mockResolvedValue({ ...mockProvider, tlsRejectUnauthorized: false });

      const result = await resolver.resolve(mockUser, 10);

      expect(result.config.tlsRejectUnauthorized).toBe(false);
    });

    it('should resolve from default provider if no ID requested', async () => {
      (preferencesService.getForUser as vi.Mock).mockResolvedValue({ defaultProviderId: 20 });
      (providerService.getProviderWithDecryptedPassword as vi.Mock).mockResolvedValue({ ...mockProvider, id: 20 });

      const result = await resolver.resolve(mockUser, null);

      expect(preferencesService.getForUser).toHaveBeenCalledWith(mockUser.id);
      expect(providerService.getProviderWithDecryptedPassword).toHaveBeenCalledWith(20, mockUser);
      expect(providerService.getSharedDefaultWithDecryptedPassword).not.toHaveBeenCalled();
      expect(result.providerId).toBe(20);
    });

    it('should resolve from the shared default if the user has no provider preference', async () => {
      (preferencesService.getForUser as vi.Mock).mockResolvedValue(null);
      (providerService.getSharedDefaultWithDecryptedPassword as vi.Mock).mockResolvedValue({
        ...mockProvider,
        id: 30,
        isShared: true,
        isDefault: true,
      });

      const result = await resolver.resolve(mockUser, null);

      expect(providerService.getSharedDefaultWithDecryptedPassword).toHaveBeenCalledOnce();
      expect(providerService.getProviderWithDecryptedPassword).not.toHaveBeenCalled();
      expect(result.providerId).toBe(30);
      expect(result.config.password).toBe('decrypted-password');
    });

    it('should resolve from the shared default if other preferences exist without a provider preference', async () => {
      (preferencesService.getForUser as vi.Mock).mockResolvedValue({ defaultProviderId: null, defaultRecipientId: 40, defaultTemplateId: 50 });
      (providerService.getSharedDefaultWithDecryptedPassword as vi.Mock).mockResolvedValue({
        ...mockProvider,
        id: 31,
        isShared: true,
        isDefault: true,
      });

      const result = await resolver.resolve(mockUser);

      expect(providerService.getSharedDefaultWithDecryptedPassword).toHaveBeenCalledOnce();
      expect(result.providerId).toBe(31);
    });

    it('should throw BadRequestException if no requested, preferred, or shared default provider exists', async () => {
      (preferencesService.getForUser as vi.Mock).mockResolvedValue(null);
      (providerService.getSharedDefaultWithDecryptedPassword as vi.Mock).mockResolvedValue(null);

      await expect(resolver.resolve(mockUser, null)).rejects.toThrow(
        new BadRequestException('No email provider configured. Add a provider in email settings.'),
      );
    });

    it('should throw BadRequestException if requested provider is missing', async () => {
      (providerService.getProviderWithDecryptedPassword as vi.Mock).mockRejectedValue(new Error('Not found'));

      await expect(resolver.resolve(mockUser, 99)).rejects.toThrow();
    });

    it('should treat providerId=0 as an explicit provider selection (not as missing)', async () => {
      (providerService.getProviderWithDecryptedPassword as vi.Mock).mockResolvedValue({ ...mockProvider, id: 0 });

      const result = await resolver.resolve(mockUser, 0);

      expect(providerService.getProviderWithDecryptedPassword).toHaveBeenCalledWith(0, mockUser);
      expect(result.providerId).toBe(0);
    });
  });
});
