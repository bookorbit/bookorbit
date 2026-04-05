import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailProviderService } from './email-provider.service';
import { EmailProviderRepository } from './email-provider.repository';
import { EmailEncryptionService } from './email-encryption.service';
import { EmailTransportService } from './email-transport.service';
import type { RequestUser } from '../../common/types/request-user';

describe('EmailProviderService', () => {
  let service: EmailProviderService;
  let repo: EmailProviderRepository;
  let encryption: EmailEncryptionService;
  let transport: EmailTransportService;

  const mockUser: RequestUser = {
    id: 1,
    username: 'testuser',
    name: 'Test User',
    email: 'test@example.com',
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    permissions: [],
  };

  const mockAdmin: RequestUser = {
    ...mockUser,
    isSuperuser: true,
  };

  const mockProvider = {
    id: 10,
    userId: 1,
    name: 'Test SMTP',
    host: 'smtp.test.com',
    port: 587,
    username: 'testuser',
    passwordEnc: 'encrypted',
    isShared: false,
    auth: true,
    ssl: false,
    startTls: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProviderService,
        {
          provide: EmailProviderRepository,
          useValue: {
            findAllForUser: vi.fn().mockResolvedValue([mockProvider]),
            findById: vi.fn().mockResolvedValue([mockProvider]),
            insert: vi.fn().mockResolvedValue([mockProvider]),
            update: vi.fn().mockResolvedValue([mockProvider]),
            delete: vi.fn(),
            clearDefault: vi.fn(),
            setDefault: vi.fn().mockResolvedValue([mockProvider]),
            setSharedByOwner: vi.fn().mockResolvedValue([{ ...mockProvider, isShared: true }]),
          },
        },
        {
          provide: EmailEncryptionService,
          useValue: { encrypt: vi.fn().mockReturnValue('encrypted'), decrypt: vi.fn().mockReturnValue('decrypted') },
        },
        {
          provide: EmailTransportService,
          useValue: { buildTransporter: vi.fn(), verifyTransporter: vi.fn() },
        },
      ],
    }).compile();

    service = module.get<EmailProviderService>(EmailProviderService);
    repo = module.get<EmailProviderRepository>(EmailProviderRepository);
    encryption = module.get<EmailEncryptionService>(EmailEncryptionService);
    transport = module.get<EmailTransportService>(EmailTransportService);
  });

  describe('findAll', () => {
    it('should return all providers for user sanitized', async () => {
      const result = await service.findAll(mockUser);
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('passwordEnc');
      expect(result[0]).toHaveProperty('hasPassword', true);
    });
  });

  describe('create', () => {
    it('should encrypt password and insert provider', async () => {
      const dto = { name: 'New SMTP', host: 'new.test.com', port: 465, password: 'new-password', auth: true, ssl: true, startTls: false };
      await service.create(dto, mockUser);
      expect(encryption.encrypt).toHaveBeenCalledWith('new-password');
      expect(repo.insert).toHaveBeenCalled();
    });

    it('should map duplicate provider names to ConflictException', async () => {
      (repo.insert as vi.Mock).mockRejectedValue({ code: '23505' });
      const dto = { name: 'New SMTP', host: 'new.test.com', port: 465, password: 'new-password', auth: true, ssl: true, startTls: false };
      await expect(service.create(dto, mockUser)).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('should return one provider sanitized', async () => {
      const result = await service.findOne(10, mockUser);
      expect(result.id).toBe(10);
      expect(result).not.toHaveProperty('passwordEnc');
    });
  });

  describe('update', () => {
    it('should encrypt new password if provided', async () => {
      const dto = { password: 'updated-pass' };
      const result = await service.update(10, dto, mockUser);
      expect(encryption.encrypt).toHaveBeenCalledWith('updated-pass');
      expect(repo.update).toHaveBeenCalledWith(10, 1, expect.objectContaining({ passwordEnc: 'encrypted' }));
      expect(result.id).toBe(10);
    });

    it('should throw NotFoundException if update fails', async () => {
      (repo.update as vi.Mock).mockResolvedValue([]);
      await expect(service.update(10, {}, mockUser)).rejects.toThrow(NotFoundException);
    });

    it('should map duplicate provider names to ConflictException', async () => {
      (repo.update as vi.Mock).mockRejectedValue({ code: '23505' });
      await expect(service.update(10, { name: 'duplicate' }, mockUser)).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('should remove a provider', async () => {
      await service.remove(10, mockUser);
      expect(repo.delete).toHaveBeenCalledWith(10, 1);
    });
  });

  describe('setDefault', () => {
    it('should set default provider', async () => {
      const result = await service.setDefault(10, mockUser);
      expect(repo.setDefault).toHaveBeenCalledWith(10, 1);
      expect(result.id).toBe(10);
    });
  });

  describe('getProviderWithDecryptedPassword', () => {
    it('should return provider with plain password', async () => {
      const result = await service.getProviderWithDecryptedPassword(10, mockUser);
      expect(result.plainPassword).toBe('decrypted');
    });
  });

  describe('toggleShared', () => {
    it('should allow superuser to toggle sharing', async () => {
      const result = await service.toggleShared(10, mockAdmin);
      expect(result.isShared).toBe(true);
      expect(repo.setSharedByOwner).toHaveBeenCalled();
    });

    it('should throw ForbiddenException for non-superuser', async () => {
      await expect(service.toggleShared(10, mockUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('testConnection', () => {
    it('should return success: true on successful verification', async () => {
      (transport.verifyTransporter as vi.Mock).mockResolvedValue(undefined);
      const result = await service.testConnection(10, mockUser);
      expect(result.success).toBe(true);
    });

    it('should return success: false and error on failure', async () => {
      (transport.verifyTransporter as vi.Mock).mockRejectedValue(new Error('Connection failed'));
      const result = await service.testConnection(10, mockUser);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('getOwnedOrShared', () => {
    it('should throw ForbiddenException if not owner and not shared', async () => {
      const otherUser: RequestUser = { ...mockUser, id: 99 };
      (repo.findById as vi.Mock).mockResolvedValue([{ ...mockProvider, userId: 1, isShared: false }]);
      await expect(service.findOne(10, otherUser)).rejects.toThrow(ForbiddenException);
    });

    it('should allow access if not owner but shared', async () => {
      const otherUser: RequestUser = { ...mockUser, id: 99 };
      (repo.findById as vi.Mock).mockResolvedValue([{ ...mockProvider, userId: 1, isShared: true }]);
      const result = await service.findOne(10, otherUser);
      expect(result.id).toBe(10);
    });
  });
});
