import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailRecipientGroupService } from './email-recipient-group.service';
import { EmailRecipientGroupRepository } from './email-recipient-group.repository';
import { EmailRecipientRepository } from './email-recipient.repository';
import type { RequestUser } from '../../common/types/request-user';

describe('EmailRecipientGroupService', () => {
  let service: EmailRecipientGroupService;
  let repo: EmailRecipientGroupRepository;
  let recipientRepo: EmailRecipientRepository;

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

  const mockGroup = { id: 10, userId: 1, name: 'Test Group' };
  const mockMember = { recipient: { id: 100, name: 'R1', email: 'r1@test.com' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailRecipientGroupService,
        {
          provide: EmailRecipientGroupRepository,
          useValue: {
            findAllForUser: jest.fn().mockResolvedValue([mockGroup]),
            findById: jest.fn().mockResolvedValue([mockGroup]),
            findMembers: jest.fn().mockResolvedValue([mockMember]),
            insert: jest.fn().mockResolvedValue([mockGroup]),
            update: jest.fn().mockResolvedValue([mockGroup]),
            delete: jest.fn(),
            addMember: jest.fn(),
            removeMember: jest.fn(),
          },
        },
        {
          provide: EmailRecipientRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue([{ id: 100, userId: 1 }]),
          },
        },
      ],
    }).compile();

    service = module.get<EmailRecipientGroupService>(EmailRecipientGroupService);
    repo = module.get<EmailRecipientGroupRepository>(EmailRecipientGroupRepository);
    recipientRepo = module.get<EmailRecipientRepository>(EmailRecipientRepository);
  });

  describe('findAll', () => {
    it('should return groups with members', async () => {
      const result = await service.findAll(mockUser);
      expect(result).toHaveLength(1);
      expect(result[0].members).toHaveLength(1);
      expect(result[0].members[0].name).toBe('R1');
    });
  });

  describe('findOne', () => {
    it('should return group with members', async () => {
      const result = await service.findOne(10, mockUser);
      expect(result.id).toBe(10);
      expect(result.members).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('should create group', async () => {
      const dto = { name: 'New Group' };
      const result = await service.create(dto, mockUser);
      expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Group' }));
      expect(result.id).toBe(10);
    });
  });

  describe('update', () => {
    it('should update group', async () => {
      const dto = { name: 'Updated' };
      const result = await service.update(10, dto, mockUser);
      expect(repo.update).toHaveBeenCalledWith(10, 1, dto);
      expect(result.id).toBe(10);
    });
  });

  describe('remove', () => {
    it('should remove group', async () => {
      await service.remove(10, mockUser);
      expect(repo.delete).toHaveBeenCalledWith(10, 1);
    });
  });

  describe('addMember', () => {
    it('should add member and return updated group', async () => {
      await service.addMember(10, 100, mockUser);
      expect(repo.addMember).toHaveBeenCalledWith(10, 100);
      expect(repo.findMembers).toHaveBeenCalledWith(10);
    });

    it('should throw ForbiddenException if recipient not owned by user', async () => {
      (recipientRepo.findById as jest.Mock).mockResolvedValue([{ id: 100, userId: 2 }]);
      await expect(service.addMember(10, 100, mockUser)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if recipient does not exist', async () => {
      (recipientRepo.findById as jest.Mock).mockResolvedValue([]);
      await expect(service.addMember(10, 100, mockUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeMember', () => {
    it('should remove member', async () => {
      await service.removeMember(10, 100, mockUser);
      expect(repo.removeMember).toHaveBeenCalledWith(10, 100);
    });
  });

  describe('expandOwnedGroupToRecipientIds', () => {
    it('should return member recipient ids', async () => {
      const ids = await service.expandOwnedGroupToRecipientIds(10, mockUser);
      expect(ids).toEqual([100]);
    });
  });
});
