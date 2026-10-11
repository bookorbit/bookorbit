import { Inject, Injectable, ForbiddenException, ConflictException } from '@nestjs/common';
import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../../db';
import * as schema from '../../db/schema';

@Injectable()
export class KoboDeliveryRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async assertDevice(userId: number, deviceId: number): Promise<void> {
    const row = await this.db.query.koboDevices.findFirst({ where: and(eq(schema.koboDevices.userId, userId), eq(schema.koboDevices.id, deviceId)) });
    if (!row) throw new ForbiddenException();
  }

  findCurrent(userId: number, deviceId: number, bookId: number) {
    return this.db.query.koboDeviceDeliveries.findFirst({
      where: and(
        eq(schema.koboDeviceDeliveries.userId, userId),
        eq(schema.koboDeviceDeliveries.deviceId, deviceId),
        eq(schema.koboDeviceDeliveries.bookId, bookId),
        eq(schema.koboDeviceDeliveries.current, true),
      ),
      orderBy: desc(schema.koboDeviceDeliveries.createdAt),
    });
  }

  findById(userId: number, deviceId: number, id: string) {
    return this.db.query.koboDeviceDeliveries.findFirst({
      where: and(
        eq(schema.koboDeviceDeliveries.userId, userId),
        eq(schema.koboDeviceDeliveries.deviceId, deviceId),
        eq(schema.koboDeviceDeliveries.id, id),
      ),
    });
  }

  async offer(values: typeof schema.koboDeviceDeliveries.$inferInsert, replace = false) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${values.deviceId}, ${values.bookId})`);
      const existing = await tx.query.koboDeviceDeliveries.findFirst({
        where: and(
          eq(schema.koboDeviceDeliveries.userId, values.userId),
          eq(schema.koboDeviceDeliveries.deviceId, values.deviceId),
          eq(schema.koboDeviceDeliveries.bookId, values.bookId),
          eq(schema.koboDeviceDeliveries.current, true),
        ),
      });
      if (existing && !replace) return existing;
      if (replace && existing && ['prepared', 'offered', 'transfer_observed'].includes(existing.state) && existing.options.replacement) {
        if (existing.metadata.requestedVariant !== values.metadata.requestedVariant)
          throw new ConflictException({ code: 'KOBO_REPLACEMENT_ALREADY_PENDING' });
        return existing;
      }
      if (existing) await tx.update(schema.koboDeviceDeliveries).set({ current: false }).where(eq(schema.koboDeviceDeliveries.id, existing.id));
      const [row] = await tx
        .insert(schema.koboDeviceDeliveries)
        .values({ ...values, previousId: existing?.id ?? null })
        .returning();
      return row;
    });
  }

  async cancel(userId: number, deviceId: number, id: string) {
    return this.db.transaction(async (tx) => {
      const record = await tx.query.koboDeviceDeliveries.findFirst({
        where: and(
          eq(schema.koboDeviceDeliveries.userId, userId),
          eq(schema.koboDeviceDeliveries.deviceId, deviceId),
          eq(schema.koboDeviceDeliveries.id, id),
        ),
      });
      if (
        !record ||
        !record.current ||
        !record.options.replacement ||
        !['prepared', 'offered', 'transfer_observed', 'cancelled'].includes(record.state)
      )
        return;
      await tx.execute(sql`select pg_advisory_xact_lock(${deviceId}, ${record.bookId})`);
      const cancelled = await tx
        .update(schema.koboDeviceDeliveries)
        .set({ state: 'cancelled', current: record.state === 'prepared' && record.previousId ? false : record.current, updatedAt: new Date() })
        .where(
          and(
            eq(schema.koboDeviceDeliveries.id, id),
            eq(schema.koboDeviceDeliveries.state, record.state),
            eq(schema.koboDeviceDeliveries.current, true),
          ),
        )
        .returning();
      if (cancelled.length && record.state === 'prepared' && record.previousId)
        await tx.update(schema.koboDeviceDeliveries).set({ current: true }).where(eq(schema.koboDeviceDeliveries.id, record.previousId));
    });
  }

  transition(userId: number, deviceId: number, id: string, expected: string[], state: string) {
    return this.db
      .update(schema.koboDeviceDeliveries)
      .set({ state, updatedAt: new Date() })
      .where(
        and(
          eq(schema.koboDeviceDeliveries.userId, userId),
          eq(schema.koboDeviceDeliveries.deviceId, deviceId),
          eq(schema.koboDeviceDeliveries.id, id),
          inArray(schema.koboDeviceDeliveries.state, expected),
        ),
      )
      .returning();
  }

  async reoffer(userId: number, deviceId: number, bookId: number) {
    await this.db.execute(
      sql`update ${schema.koboSnapshotBooks} sb set synced = false, is_new = true, removed_by_device = false, pending_delete = false from ${schema.koboLibrarySnapshots} snap where snap.id = sb.snapshot_id and snap.user_id = ${userId} and snap.device_id = ${deviceId} and sb.book_id = ${bookId}`,
    );
  }
}
