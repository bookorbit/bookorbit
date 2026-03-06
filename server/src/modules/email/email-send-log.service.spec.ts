import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailSendLogService, MAX_SEND_ATTEMPTS } from './email-send-log.service';
import { EmailSendLogRepository } from './email-send-log.repository';
import type { RequestUser } from '../../common/types/request-user';

describe('EmailSendLogService', () => {
  let service: EmailSendLogService;
  let repo: EmailSendLogRepository;

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

  const mockLog = { id: 10, userId: 1, toEmail: 'test@test.com', status: 'pending', attemptCount: 0 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailSendLogService,
        {
          provide: EmailSendLogRepository,
          useValue: {
            insert: jest.fn().mockResolvedValue([mockLog]),
            markSent: jest.fn().mockResolvedValue([{ ...mockLog, status: 'sent' }]),
            markFailed: jest.fn(),
            findForUser: jest.fn().mockResolvedValue([mockLog]),
            findAll: jest.fn().mockResolvedValue([mockLog]),
            findById: jest.fn().mockResolvedValue([mockLog]),
            delete: jest.fn(),
            findPendingRetries: jest.fn().mockResolvedValue([]),
            markAbandoned: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EmailSendLogService>(EmailSendLogService);
    repo = module.get<EmailSendLogRepository>(EmailSendLogRepository);
  });

  describe('onApplicationBootstrap', () => {
    it('should mark stale pending entries as abandoned', async () => {
      (repo.findPendingRetries as jest.Mock).mockResolvedValue([{ id: 100 }, { id: 101 }]);
      await service.onApplicationBootstrap();
      expect(repo.markAbandoned).toHaveBeenCalledTimes(2);
      expect(repo.markAbandoned).toHaveBeenCalledWith(100);
      expect(repo.markAbandoned).toHaveBeenCalledWith(101);
    });

    it('should do nothing if no stale pending entries', async () => {
      (repo.findPendingRetries as jest.Mock).mockResolvedValue([]);
      await service.onApplicationBootstrap();
      expect(repo.markAbandoned).not.toHaveBeenCalled();
    });
  });

  describe('findForUser', () => {
    it('should find for user with pagination', async () => {
      const result = await service.findForUser(mockUser, 1, 10);
      expect(repo.findForUser).toHaveBeenCalledWith(1, 10, 10);
      expect(result).toHaveLength(1);
    });
  });

  describe('findAllAdmin', () => {
    it('should find all for admin with pagination', async () => {
      const result = await service.findAllAdmin(0, 5);
      expect(repo.findAll).toHaveBeenCalledWith(5, 0);
      expect(result).toHaveLength(1);
    });
  });

  describe('remove', () => {
    it('should remove owned entry', async () => {
      await service.remove(10, mockUser);
      expect(repo.delete).toHaveBeenCalledWith(10, 1);
    });
  });

  describe('markFailed', () => {
    it('should return isFinal=false if attempts < MAX_SEND_ATTEMPTS', async () => {
      const result = await service.markFailed(10, 'Error', 0);
      expect(result.isFinal).toBe(false);
      expect(repo.markFailed).toHaveBeenCalledWith(10, 'Error', expect.any(Date));
    });

    it('should return isFinal=true if attempts >= MAX_SEND_ATTEMPTS', async () => {
      const result = await service.markFailed(10, 'Error', MAX_SEND_ATTEMPTS - 1);
      expect(result.isFinal).toBe(true);
      expect(repo.markFailed).toHaveBeenCalledWith(10, 'Error', null);
    });
  });

  describe('findOneOwned', () => {
    it('should throw ForbiddenException if userId mismatch', async () => {
      (repo.findById as jest.Mock).mockResolvedValue([{ ...mockLog, userId: 99 }]);
      await expect(service.findOneOwned(10, mockUser)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if not found', async () => {
      (repo.findById as jest.Mock).mockResolvedValue([]);
      await expect(service.findOneOwned(10, mockUser)).rejects.toThrow(NotFoundException);
    });
  });
});
