import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { notifications, users, userPermissions, userLibraryAccess } from '../../db/schema';
import type { NewNotification, Notification } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class NotificationRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async insertMany(rows: NewNotification[]): Promise<Notification[]> {
    if (rows.length === 0) return [];
    return this.db.insert(notifications).values(rows).returning();
  }

  async findByUser(userId: number, limit: number, offset: number): Promise<{ items: Notification[]; total: number }> {
    const [items, [{ value: total }]] = await Promise.all([
      this.db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit).offset(offset),
      this.db.select({ value: count() }).from(notifications).where(eq(notifications.userId, userId)),
    ]);
    return { items, total };
  }

  async countUnread(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
    return value;
  }

  async setRead(id: number, userId: number): Promise<boolean> {
    const result = await this.db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async setAllRead(userId: number): Promise<number> {
    const result = await this.db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
    return result.rowCount ?? 0;
  }

  async deleteOne(id: number, userId: number): Promise<boolean> {
    const result = await this.db.delete(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  async deleteAllForUser(userId: number): Promise<number> {
    const result = await this.db.delete(notifications).where(eq(notifications.userId, userId));
    return result.rowCount ?? 0;
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.db.delete(notifications).where(lt(notifications.createdAt, date));
    return result.rowCount ?? 0;
  }

  async findUserIdsWithLibraryAccess(libraryId: number): Promise<number[]> {
    const byAccess = this.db
      .select({ userId: userLibraryAccess.userId })
      .from(userLibraryAccess)
      .innerJoin(users, eq(users.id, userLibraryAccess.userId))
      .where(and(eq(userLibraryAccess.libraryId, libraryId), eq(users.active, true)));

    const superusers = this.db
      .select({ userId: users.id })
      .from(users)
      .where(and(eq(users.isSuperuser, true), eq(users.active, true)));

    const rows = await this.db.selectDistinct({ userId: sql<number>`user_id` }).from(sql`(${byAccess} UNION ${superusers}) as combined`);
    return rows.map((r) => r.userId);
  }

  async findUserIdsWithPermission(permission: string): Promise<number[]> {
    const byPermission = this.db
      .select({ userId: userPermissions.userId })
      .from(userPermissions)
      .innerJoin(users, eq(users.id, userPermissions.userId))
      .where(and(eq(userPermissions.permissionName, permission), eq(users.active, true)));

    const superusers = this.db
      .select({ userId: users.id })
      .from(users)
      .where(and(eq(users.isSuperuser, true), eq(users.active, true)));

    const rows = await this.db.selectDistinct({ userId: sql<number>`user_id` }).from(sql`(${byPermission} UNION ${superusers}) as combined`);
    return rows.map((r) => r.userId);
  }

  async findAllActiveUserIds(): Promise<number[]> {
    const rows = await this.db.select({ id: users.id }).from(users).where(eq(users.active, true));
    return rows.map((r) => r.id);
  }

  async findUserSettings(userIds: number[]): Promise<Map<number, Record<string, unknown>>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db.select({ id: users.id, settings: users.settings }).from(users).where(inArray(users.id, userIds));
    return new Map(rows.map((r) => [r.id, (r.settings ?? {}) as Record<string, unknown>]));
  }
}
