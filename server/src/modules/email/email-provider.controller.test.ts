import 'reflect-metadata';
import type { RequestUser } from '../../common/types/request-user';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AuditAction, AuditResource, Permission } from '@projectx/types';
import { EmailProviderController } from './email-provider.controller';
import type { CreateEmailProviderDto } from './dto/create-email-provider.dto';
import type { UpdateEmailProviderDto } from './dto/update-email-provider.dto';
import { EmailProviderService } from './email-provider.service';
import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';

describe('EmailProviderController', () => {
  const user: RequestUser = {
    id: 10,
    username: 'owner',
    name: 'Owner',
    email: 'owner@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    isSuperuser: false,
    permissions: [],
  };

  const service = {
    findAll: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setDefault: vi.fn(),
    toggleShared: vi.fn(),
    testConnection: vi.fn(),
    setSystemProvider: vi.fn(),
    clearSystemProvider: vi.fn(),
  } as unknown as EmailProviderService;

  const controller = new EmailProviderController(service);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('delegation', () => {
    it('delegates findAll', async () => {
      await controller.findAll(user);
      expect(service.findAll).toHaveBeenCalledWith(user);
    });

    it('delegates findOne with parsed id', async () => {
      await controller.findOne(55, user);
      expect(service.findOne).toHaveBeenCalledWith(55, user);
    });

    it('delegates create', async () => {
      const dto: CreateEmailProviderDto = {
        name: 'SMTP',
        host: 'smtp.example.com',
        port: 587,
        auth: true,
        ssl: false,
        startTls: true,
      };

      await controller.create(dto, user);
      expect(service.create).toHaveBeenCalledWith(dto, user);
    });

    it('delegates update', async () => {
      const dto: UpdateEmailProviderDto = { port: 2525 };
      await controller.update(12, dto, user);
      expect(service.update).toHaveBeenCalledWith(12, dto, user);
    });

    it('delegates remove', async () => {
      await controller.remove(9, user);
      expect(service.remove).toHaveBeenCalledWith(9, user);
    });

    it('delegates setDefault', async () => {
      await controller.setDefault(3, user);
      expect(service.setDefault).toHaveBeenCalledWith(3, user);
    });

    it('delegates toggleShared', async () => {
      await controller.toggleShared(3, user);
      expect(service.toggleShared).toHaveBeenCalledWith(3, user);
    });

    it('delegates testConnection', async () => {
      await controller.testConnection(3, user);
      expect(service.testConnection).toHaveBeenCalledWith(3, user);
    });

    it('delegates setSystemProvider', async () => {
      await controller.setSystemProvider(7, user);
      expect(service.setSystemProvider).toHaveBeenCalledWith(7, user);
    });

    it('delegates clearSystemProvider', async () => {
      await controller.clearSystemProvider(user);
      expect(service.clearSystemProvider).toHaveBeenCalledWith(user);
    });
  });

  describe('permissions', () => {
    function getPermission(method: keyof EmailProviderController): Permission | undefined {
      return Reflect.getMetadata(PERMISSION_KEY, EmailProviderController.prototype[method as string]);
    }

    it('requires EmailSend to read providers', () => {
      expect(getPermission('findAll')).toBe(Permission.EmailSend);
      expect(getPermission('findOne')).toBe(Permission.EmailSend);
    });

    it('requires EmailSend to set default provider', () => {
      expect(getPermission('setDefault')).toBe(Permission.EmailSend);
    });

    it('requires ManageEmail to create a provider', () => {
      expect(getPermission('create')).toBe(Permission.ManageEmail);
    });

    it('requires ManageEmail to update a provider', () => {
      expect(getPermission('update')).toBe(Permission.ManageEmail);
    });

    it('requires ManageEmail to delete a provider', () => {
      expect(getPermission('remove')).toBe(Permission.ManageEmail);
    });

    it('requires ManageEmail to toggle sharing', () => {
      expect(getPermission('toggleShared')).toBe(Permission.ManageEmail);
    });

    it('requires ManageEmail to test a connection', () => {
      expect(getPermission('testConnection')).toBe(Permission.ManageEmail);
    });

    it('requires ManageEmail to set the system provider', () => {
      expect(getPermission('setSystemProvider')).toBe(Permission.ManageEmail);
    });

    it('requires ManageEmail to clear the system provider', () => {
      expect(getPermission('clearSystemProvider')).toBe(Permission.ManageEmail);
    });
  });

  describe('auditing metadata', () => {
    function getAudit(method: keyof EmailProviderController) {
      return Reflect.getMetadata(AUDITABLE_KEY, EmailProviderController.prototype[method as string]) as {
        action: AuditAction;
        resource: AuditResource;
        getResourceId?: (req: { params: Record<string, string> }) => number;
        description: ((req: { params: Record<string, string> }, res: unknown) => string) | string;
      };
    }

    it('defines audit resource ids and descriptions for mutation routes', () => {
      const createAudit = getAudit('create');
      expect(createAudit.action).toBe(AuditAction.EmailProviderCreate);
      expect(createAudit.resource).toBe(AuditResource.EmailProvider);
      expect((createAudit.description as (req: unknown, res: { name?: string }) => string)({} as never, { name: 'SMTP' })).toBe(
        "Created email provider 'SMTP'",
      );

      const updateAudit = getAudit('update');
      expect(updateAudit.getResourceId?.({ params: { id: '12' } })).toBe(12);
      expect((updateAudit.description as (req: { params: Record<string, string> }, res: unknown) => string)({ params: { id: '12' } }, null)).toBe(
        'Updated email provider #12',
      );

      const deleteAudit = getAudit('remove');
      expect(deleteAudit.getResourceId?.({ params: { id: '13' } })).toBe(13);
      expect((deleteAudit.description as (req: { params: Record<string, string> }, res: unknown) => string)({ params: { id: '13' } }, null)).toBe(
        'Deleted email provider #13',
      );

      const setDefaultAudit = getAudit('setDefault');
      expect(setDefaultAudit.getResourceId?.({ params: { id: '7' } })).toBe(7);
      expect((setDefaultAudit.description as (req: { params: Record<string, string> }, res: unknown) => string)({ params: { id: '7' } }, null)).toBe(
        'Set email provider #7 as default',
      );

      const toggleAudit = getAudit('toggleShared');
      expect(toggleAudit.getResourceId?.({ params: { id: '6' } })).toBe(6);
      expect((toggleAudit.description as (req: { params: Record<string, string> }, res: unknown) => string)({ params: { id: '6' } }, null)).toBe(
        'Toggled sharing for email provider #6',
      );

      const setSystemAudit = getAudit('setSystemProvider');
      expect(setSystemAudit.getResourceId?.({ params: { id: '9' } })).toBe(9);
      expect((setSystemAudit.description as (req: { params: Record<string, string> }, res: unknown) => string)({ params: { id: '9' } }, null)).toBe(
        'Set email provider #9 as system mail provider',
      );

      const clearSystemAudit = getAudit('clearSystemProvider');
      expect(clearSystemAudit.action).toBe(AuditAction.EmailProviderClearSystem);
      expect((clearSystemAudit.description as () => string)()).toBe('Cleared system mail provider');
    });
  });
});
