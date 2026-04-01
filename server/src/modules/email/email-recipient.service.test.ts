import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailRecipientService } from './email-recipient.service';
import { EmailRecipientRepository } from './email-recipient.repository';
import type { RequestUser } from '../../common/types/request-user';

describe('EmailRecipientService', () => {
  let service: EmailRecipientService;
  let repo: EmailRecipientRepository;

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

  const mockRecipient = { id: 10, userId: 1, name: 'Recipient', email: 'r@test.com' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailRecipientService,
        {
          provide: EmailRecipientRepository,
          useValue: {
            findAllForUser: vi.fn().mockResolvedValue([mockRecipient]),
            findById: vi.fn().mockResolvedValue([mockRecipient]),
            findByIds: vi.fn().mockResolvedValue([mockRecipient]),
            insert: vi.fn().mockResolvedValue([mockRecipient]),
            update: vi.fn().mockResolvedValue([mockRecipient]),
            delete: vi.fn(),
            clearDefault: vi.fn(),
            setDefault: vi.fn().mockResolvedValue([mockRecipient]),
          },
        },
      ],
    }).compile();

    service = module.get<EmailRecipientService>(EmailRecipientService);
    repo = module.get<EmailRecipientRepository>(EmailRecipientRepository);
  });

  it('should find all for user', async () => {
    const result = await service.findAll(mockUser);
    expect(result).toHaveLength(1);
    expect(repo.findAllForUser).toHaveBeenCalledWith(1);
  });

  it('should find one', async () => {
    const result = await service.findOne(10, mockUser);
    expect(result.id).toBe(10);
  });

  it('should create a recipient', async () => {
    const dto = { name: 'New', email: 'new@test.com' };
    const result = await service.create(dto, mockUser);
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@test.com' }));
    expect(result.id).toBe(10);
  });

  it('should update a recipient', async () => {
    const dto = { name: 'Updated' };
    const result = await service.update(10, dto, mockUser);
    expect(repo.update).toHaveBeenCalledWith(10, 1, dto);
    expect(result.id).toBe(10);
  });

  it('should remove a recipient', async () => {
    await service.remove(10, mockUser);
    expect(repo.delete).toHaveBeenCalledWith(10, 1);
  });

  it('should set default recipient', async () => {
    const result = await service.setDefault(10, mockUser);
    expect(repo.clearDefault).toHaveBeenCalledWith(1);
    expect(repo.setDefault).toHaveBeenCalledWith(10, 1);
    expect(result.id).toBe(10);
  });

  it('should throw NotFoundException on update if not exists', async () => {
    (repo.update as vi.Mock).mockResolvedValue([]);
    await expect(service.update(10, { name: 'U' }, mockUser)).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException on setDefault if not exists', async () => {
    (repo.setDefault as vi.Mock).mockResolvedValue([]);
    await expect(service.setDefault(10, mockUser)).rejects.toThrow(NotFoundException);
  });

  it('should get owned recipients by ids', async () => {
    const result = await service.getOwnedByIds([10], mockUser);
    expect(result).toHaveLength(1);
    expect(repo.findByIds).toHaveBeenCalledWith([10]);
  });

  it('should throw NotFoundException when one of requested recipients does not exist', async () => {
    (repo.findByIds as vi.Mock).mockResolvedValue([]);
    await expect(service.getOwnedByIds([10], mockUser)).rejects.toThrow(NotFoundException);
  });

  it('should get owned recipient by id', async () => {
    const result = await service.getOwnedById(10, mockUser);
    expect(result.id).toBe(10);
  });
});
