import { Permission } from '@bookorbit/types';

import type { NotifyPayload } from './notification.service';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let repo: {
    insertMany: ReturnType<typeof vi.fn>;
    findByUser: ReturnType<typeof vi.fn>;
    countUnread: ReturnType<typeof vi.fn>;
    setRead: ReturnType<typeof vi.fn>;
    setAllRead: ReturnType<typeof vi.fn>;
    deleteOne: ReturnType<typeof vi.fn>;
    deleteAllForUser: ReturnType<typeof vi.fn>;
    deleteOlderThan: ReturnType<typeof vi.fn>;
    findUserIdsWithLibraryAccess: ReturnType<typeof vi.fn>;
    findUserIdsWithPermission: ReturnType<typeof vi.fn>;
    findAllActiveUserIds: ReturnType<typeof vi.fn>;
    findUserSettings: ReturnType<typeof vi.fn>;
  };
  let gateway: {
    emitNew: ReturnType<typeof vi.fn>;
    emitCountUpdate: ReturnType<typeof vi.fn>;
    emitRead: ReturnType<typeof vi.fn>;
    emitDismissed: ReturnType<typeof vi.fn>;
    emitCleared: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repo = {
      insertMany: vi.fn(),
      findByUser: vi.fn(),
      countUnread: vi.fn(),
      setRead: vi.fn(),
      setAllRead: vi.fn(),
      deleteOne: vi.fn(),
      deleteAllForUser: vi.fn(),
      deleteOlderThan: vi.fn(),
      findUserIdsWithLibraryAccess: vi.fn(),
      findUserIdsWithPermission: vi.fn(),
      findAllActiveUserIds: vi.fn(),
      findUserSettings: vi.fn(),
    };
    gateway = {
      emitNew: vi.fn(),
      emitCountUpdate: vi.fn(),
      emitRead: vi.fn(),
      emitDismissed: vi.fn(),
      emitCleared: vi.fn(),
    };
    service = new NotificationService(repo as never, gateway as never);
  });

  function makeInserted(userId: number, overrides?: Partial<{ id: number; type: string; title: string }>) {
    return {
      id: overrides?.id ?? 1,
      userId,
      type: overrides?.type ?? 'scan_completed',
      title: overrides?.title ?? 'Library scan completed',
      message: null,
      actionUrl: null,
      meta: null,
      read: false,
      createdAt: new Date('2024-01-01'),
    };
  }

  function makePayload(scope: NotifyPayload['scope'], overrides?: Partial<NotifyPayload>): NotifyPayload {
    return {
      type: 'scan_completed',
      title: 'Library scan completed',
      scope,
      ...overrides,
    };
  }

  // ---------- notify() ----------

  describe('notify()', () => {
    it('resolves user IDs for "user" scope', async () => {
      repo.findUserSettings.mockResolvedValue(new Map());
      repo.insertMany.mockResolvedValue([makeInserted(42)]);

      await service.notify(makePayload({ kind: 'user', userId: 42 }));

      expect(repo.findUserSettings).toHaveBeenCalledWith([42]);
      expect(repo.insertMany).toHaveBeenCalled();
      expect(repo.insertMany.mock.calls[0][0][0]).toMatchObject({ userId: 42 });
    });

    it('resolves user IDs for "library" scope', async () => {
      repo.findUserIdsWithLibraryAccess.mockResolvedValue([10, 20]);
      repo.findUserSettings.mockResolvedValue(new Map());
      repo.insertMany.mockResolvedValue([makeInserted(10), makeInserted(20, { id: 2 })]);

      await service.notify(makePayload({ kind: 'library', libraryId: 5 }));

      expect(repo.findUserIdsWithLibraryAccess).toHaveBeenCalledWith(5);
      expect(repo.insertMany).toHaveBeenCalled();
    });

    it('resolves user IDs for "permission" scope', async () => {
      repo.findUserIdsWithPermission.mockResolvedValue([30]);
      repo.findUserSettings.mockResolvedValue(new Map());
      repo.insertMany.mockResolvedValue([makeInserted(30)]);

      await service.notify(makePayload({ kind: 'permission', permission: Permission.NotificationAccess }));

      expect(repo.findUserIdsWithPermission).toHaveBeenCalledWith(Permission.NotificationAccess);
    });

    it('resolves user IDs for "all" scope', async () => {
      repo.findAllActiveUserIds.mockResolvedValue([1, 2, 3]);
      repo.findUserSettings.mockResolvedValue(new Map());
      repo.insertMany.mockResolvedValue([makeInserted(1), makeInserted(2, { id: 2 }), makeInserted(3, { id: 3 })]);

      await service.notify(makePayload({ kind: 'all' }));

      expect(repo.findAllActiveUserIds).toHaveBeenCalled();
      expect(repo.insertMany.mock.calls[0][0]).toHaveLength(3);
    });

    it('skips when no target users resolved', async () => {
      repo.findAllActiveUserIds.mockResolvedValue([]);

      await service.notify(makePayload({ kind: 'all' }));

      expect(repo.findUserSettings).not.toHaveBeenCalled();
      expect(repo.insertMany).not.toHaveBeenCalled();
      expect(gateway.emitNew).not.toHaveBeenCalled();
    });

    it('filters by user preferences - skips users who disabled the category', async () => {
      repo.findUserIdsWithLibraryAccess.mockResolvedValue([10, 20]);
      repo.findUserSettings.mockResolvedValue(
        new Map<number, Record<string, unknown>>([
          [10, { notificationPreferences: { scanning: false } }],
          [20, {}],
        ]),
      );
      repo.insertMany.mockResolvedValue([makeInserted(20)]);

      await service.notify(makePayload({ kind: 'library', libraryId: 1 }));

      const insertedRows = repo.insertMany.mock.calls[0][0];
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0].userId).toBe(20);
    });

    it('defaults to enabled when no preferences set', async () => {
      repo.findUserSettings.mockResolvedValue(new Map([[42, {}]]));
      repo.insertMany.mockResolvedValue([makeInserted(42)]);

      await service.notify(makePayload({ kind: 'user', userId: 42 }));

      expect(repo.insertMany).toHaveBeenCalled();
      expect(repo.insertMany.mock.calls[0][0]).toHaveLength(1);
    });

    it('inserts notifications and emits via gateway for each', async () => {
      repo.findAllActiveUserIds.mockResolvedValue([10, 20]);
      repo.findUserSettings.mockResolvedValue(new Map());
      const inserted = [makeInserted(10, { id: 1 }), makeInserted(20, { id: 2 })];
      repo.insertMany.mockResolvedValue(inserted);

      await service.notify(makePayload({ kind: 'all' }, { message: 'Added 5 books', actionUrl: '/library/1', meta: { count: 5 } }));

      expect(repo.insertMany).toHaveBeenCalledOnce();
      const rows = repo.insertMany.mock.calls[0][0];
      expect(rows[0]).toMatchObject({ userId: 10, type: 'scan_completed', title: 'Library scan completed' });

      expect(gateway.emitNew).toHaveBeenCalledTimes(2);
      expect(gateway.emitNew).toHaveBeenCalledWith(10, expect.objectContaining({ id: 1, type: 'scan_completed' }));
      expect(gateway.emitNew).toHaveBeenCalledWith(20, expect.objectContaining({ id: 2 }));
    });

    it('handles unknown notification type category - defaults to enabled', async () => {
      repo.findUserSettings.mockResolvedValue(new Map([[42, { notificationPreferences: { scanning: false } }]]));
      repo.insertMany.mockResolvedValue([{ ...makeInserted(42), type: 'unknown_type' }]);

      await service.notify(makePayload({ kind: 'user', userId: 42 }, { type: 'unknown_type' as never }));

      expect(repo.insertMany).toHaveBeenCalled();
      expect(repo.insertMany.mock.calls[0][0]).toHaveLength(1);
    });

    it('catches and re-throws errors', async () => {
      const error = new Error('DB connection failed');
      repo.findAllActiveUserIds.mockRejectedValue(error);

      await expect(service.notify(makePayload({ kind: 'all' }))).rejects.toThrow('DB connection failed');
    });

    it('skips insert when all users filtered out by preferences', async () => {
      repo.findUserSettings.mockResolvedValue(new Map<number, Record<string, unknown>>([[42, { notificationPreferences: { scanning: false } }]]));

      await service.notify(makePayload({ kind: 'user', userId: 42 }));

      expect(repo.insertMany).not.toHaveBeenCalled();
      expect(gateway.emitNew).not.toHaveBeenCalled();
    });
  });

  // ---------- list() ----------

  describe('list()', () => {
    it('returns paginated items transformed via toItem', async () => {
      const dbRow = {
        id: 1,
        type: 'scan_completed',
        title: 'Done',
        message: 'All good',
        actionUrl: '/lib/1',
        meta: { count: 3 },
        read: false,
        createdAt: new Date('2024-06-15T12:00:00Z'),
      };
      repo.findByUser.mockResolvedValue({ items: [dbRow], total: 1 });

      const result = await service.list(42, 20, 0);

      expect(repo.findByUser).toHaveBeenCalledWith(42, 20, 0);
      expect(result.total).toBe(1);
      expect(result.items[0]).toEqual({
        id: 1,
        type: 'scan_completed',
        title: 'Done',
        message: 'All good',
        actionUrl: '/lib/1',
        meta: { count: 3 },
        read: false,
        createdAt: '2024-06-15T12:00:00.000Z',
      });
    });
  });

  // ---------- markAsRead() ----------

  describe('markAsRead()', () => {
    it('marks as read and emits events when notification exists', async () => {
      repo.setRead.mockResolvedValue(true);
      repo.countUnread.mockResolvedValue(3);

      const result = await service.markAsRead(42, 7);

      expect(result).toBe(true);
      expect(repo.setRead).toHaveBeenCalledWith(7, 42);
      expect(gateway.emitRead).toHaveBeenCalledWith(42, 7);
      expect(repo.countUnread).toHaveBeenCalledWith(42);
      expect(gateway.emitCountUpdate).toHaveBeenCalledWith(42, 3);
    });

    it('returns false and does not emit events when notification not found', async () => {
      repo.setRead.mockResolvedValue(false);

      const result = await service.markAsRead(42, 999);

      expect(result).toBe(false);
      expect(gateway.emitRead).not.toHaveBeenCalled();
      expect(gateway.emitCountUpdate).not.toHaveBeenCalled();
    });
  });

  // ---------- markAllAsRead() ----------

  describe('markAllAsRead()', () => {
    it('marks all as read and emits count update + cleared', async () => {
      repo.setAllRead.mockResolvedValue(undefined);
      repo.countUnread.mockResolvedValue(0);

      await service.markAllAsRead(42);

      expect(repo.setAllRead).toHaveBeenCalledWith(42);
      expect(repo.countUnread).toHaveBeenCalledWith(42);
      expect(gateway.emitCountUpdate).toHaveBeenCalledWith(42, 0);
      expect(gateway.emitCleared).toHaveBeenCalledWith(42);
    });
  });

  // ---------- dismiss() ----------

  describe('dismiss()', () => {
    it('deletes and emits events when notification exists', async () => {
      repo.deleteOne.mockResolvedValue(true);
      repo.countUnread.mockResolvedValue(2);

      const result = await service.dismiss(42, 7);

      expect(result).toBe(true);
      expect(repo.deleteOne).toHaveBeenCalledWith(7, 42);
      expect(gateway.emitDismissed).toHaveBeenCalledWith(42, 7);
      expect(repo.countUnread).toHaveBeenCalledWith(42);
      expect(gateway.emitCountUpdate).toHaveBeenCalledWith(42, 2);
    });

    it('returns false and does not emit events when notification not found', async () => {
      repo.deleteOne.mockResolvedValue(false);

      const result = await service.dismiss(42, 999);

      expect(result).toBe(false);
      expect(gateway.emitDismissed).not.toHaveBeenCalled();
      expect(gateway.emitCountUpdate).not.toHaveBeenCalled();
    });
  });

  // ---------- clearAll() ----------

  describe('clearAll()', () => {
    it('deletes all and emits count=0 + cleared', async () => {
      repo.deleteAllForUser.mockResolvedValue(undefined);

      await service.clearAll(42);

      expect(repo.deleteAllForUser).toHaveBeenCalledWith(42);
      expect(gateway.emitCountUpdate).toHaveBeenCalledWith(42, 0);
      expect(gateway.emitCleared).toHaveBeenCalledWith(42);
    });
  });

  // ---------- getUnreadCount() ----------

  describe('getUnreadCount()', () => {
    it('returns count from repo', async () => {
      repo.countUnread.mockResolvedValue(5);

      const result = await service.getUnreadCount(42);

      expect(result).toBe(5);
      expect(repo.countUnread).toHaveBeenCalledWith(42);
    });
  });

  // ---------- deleteOlderThan() ----------

  describe('deleteOlderThan()', () => {
    it('calls repo with calculated cutoff date', async () => {
      repo.deleteOlderThan.mockResolvedValue(10);
      const now = new Date('2024-06-15T00:00:00Z');
      vi.setSystemTime(now);

      const result = await service.deleteOlderThan(30);

      expect(result).toBe(10);
      const cutoffArg = repo.deleteOlderThan.mock.calls[0][0] as Date;
      const expectedCutoff = new Date('2024-05-16T00:00:00Z');
      expect(cutoffArg.getTime()).toBe(expectedCutoff.getTime());

      vi.useRealTimers();
    });
  });
});
