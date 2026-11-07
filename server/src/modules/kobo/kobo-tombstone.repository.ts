import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** A tombstone is dropped after this long even if a device never synced to receive it. */
export const KOBO_TOMBSTONE_RETENTION_DAYS = 90;

export type KoboPendingRemoval = {
  entitlementId: string;
  /** The numeric id to remove as well, when this device may still know the book by it. */
  legacyBookId: number | null;
};

@Injectable()
export class KoboTombstoneRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async hasPending(userId: number, deviceId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ entitlementId: schema.koboDeviceEntitlementTombstones.entitlementId })
      .from(schema.koboDeviceEntitlementTombstones)
      .where(and(eq(schema.koboDeviceEntitlementTombstones.userId, userId), eq(schema.koboDeviceEntitlementTombstones.deviceId, deviceId)))
      .limit(1);
    return Boolean(row);
  }

  async findPending(userId: number, deviceId: number, limit: number): Promise<KoboPendingRemoval[]> {
    const device = schema.koboDeviceEntitlementTombstones;
    const tombstone = schema.koboEntitlementTombstones;
    return this.db
      .select({
        entitlementId: device.entitlementId,
        legacyBookId: sql<number | null>`case when ${device.legacyNumericRemoval} then ${tombstone.legacyBookId} end`,
      })
      .from(device)
      .innerJoin(tombstone, and(eq(tombstone.userId, device.userId), eq(tombstone.entitlementId, device.entitlementId)))
      .where(and(eq(device.userId, userId), eq(device.deviceId, deviceId)))
      .orderBy(asc(device.entitlementId))
      .limit(limit);
  }

  async markServed(userId: number, deviceId: number, entitlementIds: string[]): Promise<void> {
    if (entitlementIds.length === 0) return;
    await this.db
      .delete(schema.koboDeviceEntitlementTombstones)
      .where(
        and(
          eq(schema.koboDeviceEntitlementTombstones.userId, userId),
          eq(schema.koboDeviceEntitlementTombstones.deviceId, deviceId),
          inArray(schema.koboDeviceEntitlementTombstones.entitlementId, entitlementIds),
        ),
      );
  }

  /** Drops the user's tombstones every device has been sent, and any past retention with what devices still owe. */
  async prune(userId: number): Promise<void> {
    const tombstone = schema.koboEntitlementTombstones;
    const device = schema.koboDeviceEntitlementTombstones;
    await this.db.delete(tombstone).where(
      and(
        eq(tombstone.userId, userId),
        sql`(${tombstone.removedAt} < now() - make_interval(days => ${KOBO_TOMBSTONE_RETENTION_DAYS})
          or not exists (
            select 1 from ${device}
            where ${device.userId} = ${tombstone.userId} and ${device.entitlementId} = ${tombstone.entitlementId}
          ))`,
      ),
    );
  }
}
