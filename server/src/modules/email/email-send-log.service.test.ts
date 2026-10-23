import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailSendLogService, MAX_SEND_ATTEMPTS } from './email-send-log.service';
import { EmailSendLogRepository } from './email-send-log.repository';
import type { RequestUser } from '../../common/types/request-user';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

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
    isSuperuser: false,
    permissions: [],

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };

  const mockLog = { id: 10, userId: 1, toEmail: 'test@test.com', status: 'pending', attemptCount: 0 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailSendLogService,
        {
          provide: EmailSendLogRepository,
          useValue: {
            insert: vi.fn().mockResolvedValue([mockLog]),
            markSent: vi.fn().mockResolvedValue([{ ...mockLog, status: 'sent' }]),
            markFailed: vi.fn(),
            findForUser: vi.fn().mockResolvedValue([mockLog]),
            countForUser: vi.fn().mockResolvedValue({ total: 3, failed: 1, pending: 0 }),
            findUnresolvedFailures: vi.fn().mockResolvedValue([]),
            findAll: vi.fn().mockResolvedValue([mockLog]),
            findById: vi.fn().mockResolvedValue([mockLog]),
            delete: vi.fn(),
            findPending: vi.fn().mockResolvedValue([]),
            markAbandoned: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EmailSendLogService>(EmailSendLogService);
    repo = module.get<EmailSendLogRepository>(EmailSendLogRepository);
  });

  describe('onApplicationBootstrap', () => {
    it('should mark pending entries as abandoned', async () => {
      (repo.findPending as vi.Mock).mockResolvedValue([{ id: 100 }, { id: 101 }]);
      await service.onApplicationBootstrap();
      expect(repo.markAbandoned).toHaveBeenCalledTimes(2);
      expect(repo.markAbandoned).toHaveBeenCalledWith(100);
      expect(repo.markAbandoned).toHaveBeenCalledWith(101);
    });

    it('recovers interrupted sends in bounded keyset batches', async () => {
      vi.mocked(repo.findPending)
        .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) as never)
        .mockResolvedValueOnce([{ id: 101 }] as never);
      await service.onApplicationBootstrap();
      expect(repo.findPending).toHaveBeenNthCalledWith(1, 0);
      expect(repo.findPending).toHaveBeenNthCalledWith(2, 100);
      expect(repo.markAbandoned).toHaveBeenCalledTimes(101);
    });

    it('should do nothing if no pending entries', async () => {
      (repo.findPending as vi.Mock).mockResolvedValue([]);
      await service.onApplicationBootstrap();
      expect(repo.markAbandoned).not.toHaveBeenCalled();
    });
  });

  describe('findForUser', () => {
    it('should find for user with pagination', async () => {
      const result = await service.findForUser(mockUser, 1, 10);
      expect(repo.findForUser).toHaveBeenCalledWith(1, 10, 10, {});
      expect(result).toHaveLength(1);
    });

    it('should pass the book filter through', async () => {
      await service.findForUser(mockUser, 0, 20, { bookId: 965 });
      expect(repo.findForUser).toHaveBeenCalledWith(1, 20, 0, { bookId: 965 });
    });

    it('should pass the status filter through', async () => {
      await service.findForUser(mockUser, 0, 20, { status: 'failed' });
      expect(repo.findForUser).toHaveBeenCalledWith(1, 20, 0, { status: 'failed' });
    });
  });

  describe('summary and attention', () => {
    it("counts the caller's log", async () => {
      expect(await service.summary(mockUser)).toEqual({ total: 3, failed: 1, pending: 0 });
      expect(repo.countForUser).toHaveBeenCalledWith(1);
    });

    it('asks for unresolved failures from the last seven days', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-12T20:00:00Z'));
      try {
        await service.findAttention(mockUser);
        expect(repo.findUnresolvedFailures).toHaveBeenCalledWith(1, new Date('2026-10-05T20:00:00Z'), 20);
      } finally {
        vi.useRealTimers();
      }
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
      (repo.findById as vi.Mock).mockResolvedValue([{ ...mockLog, userId: 99 }]);
      await expect(service.findOneOwned(10, mockUser)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if not found', async () => {
      (repo.findById as vi.Mock).mockResolvedValue([]);
      await expect(service.findOneOwned(10, mockUser)).rejects.toThrow(NotFoundException);
    });
  });
});
