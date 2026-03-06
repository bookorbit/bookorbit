import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailProviderResolver } from './email-provider-resolver';
import { EmailProviderService } from './email-provider.service';
import { EmailPreferencesService } from './email-preferences.service';
import type { RequestUser } from '../../common/types/request-user';

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
    roles: [],
  };
  const mockProvider = {
    id: 10,
    name: 'My SMTP',
    host: 'smtp.test.com',
    port: 587,
    username: 'test-user',
    plainPassword: 'decrypted-password',
    auth: true,
    ssl: false,
    startTls: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProviderResolver,
        {
          provide: EmailProviderService,
          useValue: {
            getProviderWithDecryptedPassword: jest.fn(),
          },
        },
        {
          provide: EmailPreferencesService,
          useValue: {
            getForUser: jest.fn(),
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
      (providerService.getProviderWithDecryptedPassword as jest.Mock).mockResolvedValue(mockProvider);

      const result = await resolver.resolve(mockUser, 10);

      expect(providerService.getProviderWithDecryptedPassword).toHaveBeenCalledWith(10, mockUser);
      expect(result.providerId).toBe(10);
      expect(result.config.password).toBe('decrypted-password');
      expect(result.config.host).toBe('smtp.test.com');
    });

    it('should resolve from default provider if no ID requested', async () => {
      (preferencesService.getForUser as jest.Mock).mockResolvedValue({ defaultProviderId: 20 });
      (providerService.getProviderWithDecryptedPassword as jest.Mock).mockResolvedValue({ ...mockProvider, id: 20 });

      const result = await resolver.resolve(mockUser, null);

      expect(preferencesService.getForUser).toHaveBeenCalledWith(mockUser.id);
      expect(providerService.getProviderWithDecryptedPassword).toHaveBeenCalledWith(20, mockUser);
      expect(result.providerId).toBe(20);
    });

    it('should throw BadRequestException if no provider is requested and no default is set', async () => {
      (preferencesService.getForUser as jest.Mock).mockResolvedValue(null);

      await expect(resolver.resolve(mockUser, null)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if requested provider is missing', async () => {
      (providerService.getProviderWithDecryptedPassword as jest.Mock).mockRejectedValue(new Error('Not found'));

      await expect(resolver.resolve(mockUser, 99)).rejects.toThrow();
    });

    it('should treat providerId=0 as an explicit provider selection (not as missing)', async () => {
      (providerService.getProviderWithDecryptedPassword as jest.Mock).mockResolvedValue({ ...mockProvider, id: 0 });

      const result = await resolver.resolve(mockUser, 0);

      expect(providerService.getProviderWithDecryptedPassword).toHaveBeenCalledWith(0, mockUser);
      expect(result.providerId).toBe(0);
    });
  });
});
