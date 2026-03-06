import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailTemplateService } from './email-template.service';
import { EmailTemplateRepository } from './email-template.repository';
import { EmailTemplateContextService } from './email-template-context.service';
import type { RequestUser } from '../../common/types/request-user';

describe('EmailTemplateService', () => {
  let service: EmailTemplateService;
  let repo: EmailTemplateRepository;

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
    roles: [{ id: 1, name: 'User', description: '', isSuperuser: false, isSystem: false, permissions: [] }],
  };

  const mockAdmin: RequestUser = {
    ...mockUser,
    roles: [{ id: 2, name: 'Admin', description: '', isSuperuser: true, isSystem: false, permissions: [] }],
  };

  const mockTemplate = { id: 10, userId: 1, name: 'Template', subject: 'S', bodyText: 'B', isSystem: false, isDefault: true };
  const mockSystemTemplate = { id: 20, userId: null, name: 'System', subject: 'S', bodyText: 'B', isSystem: true, isDefault: true };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailTemplateService,
        {
          provide: EmailTemplateRepository,
          useValue: {
            findAllForUser: jest.fn().mockResolvedValue([mockTemplate, mockSystemTemplate]),
            findById: jest.fn().mockResolvedValue([mockTemplate]),
            findUserDefault: jest.fn().mockResolvedValue([mockTemplate]),
            findSystemDefault: jest.fn().mockResolvedValue([mockSystemTemplate]),
            insert: jest.fn().mockResolvedValue([mockTemplate]),
            update: jest.fn().mockResolvedValue([mockTemplate]),
            updateById: jest.fn().mockResolvedValue([mockTemplate]),
            delete: jest.fn(),
            clearDefault: jest.fn(),
            setDefault: jest.fn().mockResolvedValue([mockTemplate]),
          },
        },
        {
          provide: EmailTemplateContextService,
          useValue: { buildForBook: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<EmailTemplateService>(EmailTemplateService);
    repo = module.get<EmailTemplateRepository>(EmailTemplateRepository);
  });

  describe('findAll', () => {
    it('should return templates and hide system default if user has own default', async () => {
      const result = await service.findAll(mockUser);
      expect(result).toHaveLength(2);
      expect(result.find((t) => t.id === 20)?.isDefault).toBe(false);
    });

    it('should return all templates if no user default', async () => {
      (repo.findAllForUser as jest.Mock).mockResolvedValue([{ ...mockTemplate, isDefault: false }, mockSystemTemplate]);
      const result = await service.findAll(mockUser);
      expect(result.find((t) => t.id === 20)?.isDefault).toBe(true);
    });
  });

  describe('create', () => {
    it('should create a template', async () => {
      const dto = { name: 'New', subject: 'S', bodyText: 'B' };
      const result = await service.create(dto, mockUser);
      expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'New', userId: 1 }));
      expect(result.id).toBe(10);
    });
  });

  describe('update', () => {
    it('should update owned template', async () => {
      const dto = { name: 'Updated' };
      const result = await service.update(10, dto, mockUser);
      expect(repo.update).toHaveBeenCalledWith(10, 1, dto);
      expect(result.id).toBe(10);
    });

    it('should throw ForbiddenException if user tries to modify system template', async () => {
      (repo.findById as jest.Mock).mockResolvedValue([mockSystemTemplate]);
      await expect(service.update(20, { name: 'New' }, mockUser)).rejects.toThrow(ForbiddenException);
    });

    it('should allow admin to modify system template', async () => {
      (repo.findById as jest.Mock).mockResolvedValue([mockSystemTemplate]);
      (repo.updateById as jest.Mock).mockResolvedValue([{ ...mockSystemTemplate, name: 'New' }]);
      const result = await service.update(20, { name: 'New' }, mockAdmin);
      expect(result.name).toBe('New');
    });
  });

  describe('remove', () => {
    it('should remove owned non-default template', async () => {
      (repo.findById as jest.Mock).mockResolvedValue([{ ...mockTemplate, isDefault: false }]);
      await service.remove(10, mockUser);
      expect(repo.delete).toHaveBeenCalledWith(10, 1);
    });

    it('should throw BadRequestException if system template', async () => {
      (repo.findById as jest.Mock).mockResolvedValue([mockSystemTemplate]);
      await expect(service.remove(20, mockUser)).rejects.toThrow('System templates cannot be deleted');
    });

    it('should throw BadRequestException if default template', async () => {
      (repo.findById as jest.Mock).mockResolvedValue([mockTemplate]);
      await expect(service.remove(10, mockUser)).rejects.toThrow('Cannot delete your default template');
    });
  });

  describe('setDefault', () => {
    it('should set owned template as default', async () => {
      const result = await service.setDefault(10, mockUser);
      expect(repo.clearDefault).toHaveBeenCalledWith(1);
      expect(repo.setDefault).toHaveBeenCalledWith(10, 1);
      expect(result.id).toBe(10);
    });

    it('should allow system template as default without database update', async () => {
      (repo.findById as jest.Mock).mockResolvedValue([mockSystemTemplate]);
      const result = await service.setDefault(20, mockUser);
      expect(repo.clearDefault).toHaveBeenCalledWith(1);
      expect(repo.setDefault).not.toHaveBeenCalled();
      expect(result.id).toBe(20);
    });
  });

  describe('preview', () => {
    it('should render template with book context', async () => {
      const contextService = (service as any).contextService;
      (contextService.buildForBook as jest.Mock).mockResolvedValue({ title: 'Preview' });

      const result = await service.preview(10, 1, 100, mockUser);
      expect(result.subject).toBe('S');
    });
  });

  describe('resolveTemplate', () => {
    it('should return specific template if requested and accessible', async () => {
      const result = await service.resolveTemplate(10, mockUser);
      expect(result.id).toBe(10);
    });

    it('should throw ForbiddenException if specific template is not owned', async () => {
      (repo.findById as jest.Mock).mockResolvedValue([{ ...mockTemplate, userId: 2 }]);
      await expect(service.resolveTemplate(10, mockUser)).rejects.toThrow(ForbiddenException);
    });

    it('should return user default if no template requested', async () => {
      const result = await service.resolveTemplate(null, mockUser);
      expect(result.id).toBe(10);
      expect(repo.findUserDefault).toHaveBeenCalledWith(1);
    });

    it('should return system default if no user default', async () => {
      (repo.findUserDefault as jest.Mock).mockResolvedValue([]);
      const result = await service.resolveTemplate(null, mockUser);
      expect(result.id).toBe(20);
      expect(repo.findSystemDefault).toHaveBeenCalled();
    });
  });
});
