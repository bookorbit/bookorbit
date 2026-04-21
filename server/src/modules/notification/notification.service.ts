import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_CATEGORIES, Permission } from '@bookorbit/types';
import type { NotificationCategory, NotificationItem, NotificationType, NotificationPreferences } from '@bookorbit/types';

import { NotificationGateway } from './notification.gateway';
import { NotificationRepository } from './notification.repository';

export type NotificationScope =
  | { kind: 'library'; libraryId: number }
  | { kind: 'user'; userId: number }
  | { kind: 'permission'; permission: Permission }
  | { kind: 'all' };

export interface NotifyPayload {
  type: NotificationType;
  title: string;
  message?: string;
  actionUrl?: string;
  meta?: Record<string, unknown>;
  scope: NotificationScope;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly repo: NotificationRepository,
    private readonly gateway: NotificationGateway,
  ) {}

  async notify(payload: NotifyPayload): Promise<void> {
    const event = 'notification.notify';
    const scopeLabel = this.formatScope(payload.scope);
    this.logger.log(`[${event}] [start] type=${payload.type} ${scopeLabel} - notification dispatch started`);
    const startedAt = Date.now();

    try {
      const targetUserIds = await this.resolveUserIds(payload.scope);
      if (targetUserIds.length === 0) {
        this.logger.log(
          `[${event}] [end] type=${payload.type} targetUsers=0 eligible=0 durationMs=${Date.now() - startedAt} - notification dispatch completed`,
        );
        return;
      }

      const settingsMap = await this.repo.findUserSettings(targetUserIds);
      const category = this.findCategory(payload.type);
      const eligibleUserIds = targetUserIds.filter((uid) => this.isEnabled(settingsMap.get(uid), category));

      if (eligibleUserIds.length === 0) {
        this.logger.log(
          `[${event}] [end] type=${payload.type} targetUsers=${targetUserIds.length} eligible=0 durationMs=${Date.now() - startedAt} - notification dispatch completed`,
        );
        return;
      }

      const rows = eligibleUserIds.map((userId) => ({
        userId,
        type: payload.type,
        title: payload.title,
        message: payload.message ?? null,
        actionUrl: payload.actionUrl ?? null,
        meta: payload.meta ?? null,
      }));

      const inserted = await this.repo.insertMany(rows);

      for (const notification of inserted) {
        const item = this.toItem(notification);
        this.gateway.emitNew(notification.userId, item);
      }

      this.logger.log(
        `[${event}] [end] type=${payload.type} targetUsers=${targetUserIds.length} eligible=${eligibleUserIds.length} durationMs=${Date.now() - startedAt} - notification dispatch completed`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = (error instanceof Error ? error.message : String(error)).replace(/"/g, '\\"');
      this.logger.error(
        `[${event}] [fail] type=${payload.type} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - notification dispatch failed`,
      );
      throw error;
    }
  }

  async list(userId: number, limit: number, offset: number) {
    const { items, total } = await this.repo.findByUser(userId, limit, offset);
    return { items: items.map((n) => this.toItem(n)), total };
  }

  async markAsRead(userId: number, id: number): Promise<boolean> {
    const updated = await this.repo.setRead(id, userId);
    if (updated) {
      this.gateway.emitRead(userId, id);
      const count = await this.repo.countUnread(userId);
      this.gateway.emitCountUpdate(userId, count);
    }
    return updated;
  }

  async markAllAsRead(userId: number): Promise<void> {
    await this.repo.setAllRead(userId);
    const count = await this.repo.countUnread(userId);
    this.gateway.emitCountUpdate(userId, count);
    this.gateway.emitCleared(userId);
  }

  async dismiss(userId: number, id: number): Promise<boolean> {
    const deleted = await this.repo.deleteOne(id, userId);
    if (deleted) {
      this.gateway.emitDismissed(userId, id);
      const count = await this.repo.countUnread(userId);
      this.gateway.emitCountUpdate(userId, count);
    }
    return deleted;
  }

  async clearAll(userId: number): Promise<void> {
    await this.repo.deleteAllForUser(userId);
    this.gateway.emitCountUpdate(userId, 0);
    this.gateway.emitCleared(userId);
  }

  async getUnreadCount(userId: number): Promise<number> {
    return this.repo.countUnread(userId);
  }

  async deleteOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.repo.deleteOlderThan(cutoff);
  }

  private async resolveUserIds(scope: NotificationScope): Promise<number[]> {
    switch (scope.kind) {
      case 'user':
        return [scope.userId];
      case 'library':
        return this.repo.findUserIdsWithLibraryAccess(scope.libraryId);
      case 'permission':
        return this.repo.findUserIdsWithPermission(scope.permission);
      case 'all':
        return this.repo.findAllActiveUserIds();
    }
  }

  private findCategory(type: NotificationType): NotificationCategory | null {
    for (const [category, types] of Object.entries(NOTIFICATION_CATEGORIES)) {
      if ((types as readonly string[]).includes(type)) {
        return category as NotificationCategory;
      }
    }
    return null;
  }

  private isEnabled(settings: Record<string, unknown> | undefined, category: NotificationCategory | null): boolean {
    if (!category) return true;
    const prefs = settings?.notificationPreferences as NotificationPreferences | undefined;
    if (!prefs) return true;
    return prefs[category] !== false;
  }

  private toItem(n: {
    id: number;
    type: string;
    title: string;
    message: string | null;
    actionUrl: string | null;
    meta: unknown;
    read: boolean;
    createdAt: Date;
  }): NotificationItem {
    return {
      id: n.id,
      type: n.type as NotificationType,
      title: n.title,
      message: n.message,
      actionUrl: n.actionUrl,
      meta: (n.meta as Record<string, unknown>) ?? null,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    };
  }

  private formatScope(scope: NotificationScope): string {
    switch (scope.kind) {
      case 'library':
        return `scope=library libraryId=${scope.libraryId}`;
      case 'user':
        return `scope=user userId=${scope.userId}`;
      case 'permission':
        return `scope=permission permission=${scope.permission}`;
      case 'all':
        return 'scope=all';
    }
  }
}
