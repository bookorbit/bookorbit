import { NotFoundException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { NotificationController } from './notification.controller';

describe('NotificationController', () => {
  let controller: NotificationController;
  let service: {
    list: ReturnType<typeof vi.fn>;
    getUnreadCount: ReturnType<typeof vi.fn>;
    markAsRead: ReturnType<typeof vi.fn>;
    markAllAsRead: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    clearAll: ReturnType<typeof vi.fn>;
  };
  const mockUser: RequestUser = {
    id: 42,
    username: 'testuser',
    name: 'Test User',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [Permission.NotificationAccess],
  };

  beforeEach(() => {
    service = {
      list: vi.fn(),
      getUnreadCount: vi.fn(),
      markAsRead: vi.fn(),
      markAllAsRead: vi.fn(),
      dismiss: vi.fn(),
      clearAll: vi.fn(),
    };
    controller = new NotificationController(service as never);
  });

  describe('list()', () => {
    it('delegates to service with default limit=20 and offset=0', () => {
      const expected = { items: [], total: 0 };
      service.list.mockReturnValue(expected);

      const result = controller.list(mockUser, {});

      expect(service.list).toHaveBeenCalledWith(42, 20, 0);
      expect(result).toBe(expected);
    });

    it('uses DTO values when provided', async () => {
      const expected = { items: [], total: 0 };
      service.list.mockResolvedValue(expected);

      await controller.list(mockUser, { limit: 50, offset: 10 });

      expect(service.list).toHaveBeenCalledWith(42, 50, 10);
    });
  });

  describe('getUnreadCount()', () => {
    it('returns count object', async () => {
      service.getUnreadCount.mockResolvedValue(7);

      const result = await controller.getUnreadCount(mockUser);

      expect(result).toEqual({ count: 7 });
      expect(service.getUnreadCount).toHaveBeenCalledWith(42);
    });
  });

  describe('markAllAsRead()', () => {
    it('calls service with user id', async () => {
      service.markAllAsRead.mockResolvedValue(undefined);

      await controller.markAllAsRead(mockUser);

      expect(service.markAllAsRead).toHaveBeenCalledWith(42);
    });
  });

  describe('markAsRead()', () => {
    it('calls service and succeeds when notification exists', async () => {
      service.markAsRead.mockResolvedValue(true);

      await controller.markAsRead(mockUser, 7);

      expect(service.markAsRead).toHaveBeenCalledWith(42, 7);
    });

    it('throws NotFoundException when service returns false', async () => {
      service.markAsRead.mockResolvedValue(false);

      await expect(controller.markAsRead(mockUser, 999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('dismiss()', () => {
    it('calls service and succeeds when notification exists', async () => {
      service.dismiss.mockResolvedValue(true);

      await controller.dismiss(mockUser, 7);

      expect(service.dismiss).toHaveBeenCalledWith(42, 7);
    });

    it('throws NotFoundException when service returns false', async () => {
      service.dismiss.mockResolvedValue(false);

      await expect(controller.dismiss(mockUser, 999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('clearAll()', () => {
    it('calls service with user id', async () => {
      service.clearAll.mockResolvedValue(undefined);

      await controller.clearAll(mockUser);

      expect(service.clearAll).toHaveBeenCalledWith(42);
    });
  });

  it('marks controller as demo-restricted', () => {
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, NotificationController)).toEqual({
      permission: Permission.DemoRestricted,
      message: 'Demo-restricted account cannot access notifications',
    });
  });
});
