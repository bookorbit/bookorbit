import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class KoboDeviceService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async listDevices(userId: number) {
    const rows = await this.db
      .select({
        id: schema.koboDevices.id,
        name: schema.koboDevices.name,
        lastSeenAt: schema.koboDevices.lastSeenAt,
        createdAt: schema.koboDevices.createdAt,
      })
      .from(schema.koboDevices)
      .where(eq(schema.koboDevices.userId, userId))
      .orderBy(schema.koboDevices.createdAt);
    return rows;
  }

  async createDevice(userId: number, name: string) {
    const token = randomUUID().replace(/-/g, '');
    const [device] = await this.db.insert(schema.koboDevices).values({ userId, name, token }).returning();

    return {
      id: device.id,
      name: device.name,
      token: device.token,
      lastSeenAt: device.lastSeenAt,
      createdAt: device.createdAt,
    };
  }

  async renameDevice(userId: number, deviceId: number, name: string) {
    const [device] = await this.db
      .select({ id: schema.koboDevices.id, userId: schema.koboDevices.userId })
      .from(schema.koboDevices)
      .where(and(eq(schema.koboDevices.id, deviceId), eq(schema.koboDevices.userId, userId)))
      .limit(1);

    if (!device) throw new NotFoundException('Device not found');

    const [updated] = await this.db
      .update(schema.koboDevices)
      .set({ name })
      .where(and(eq(schema.koboDevices.id, deviceId), eq(schema.koboDevices.userId, userId)))
      .returning({
        id: schema.koboDevices.id,
        name: schema.koboDevices.name,
        lastSeenAt: schema.koboDevices.lastSeenAt,
        createdAt: schema.koboDevices.createdAt,
      });
    return updated;
  }

  async revokeDevice(userId: number, deviceId: number) {
    const [device] = await this.db
      .select({ id: schema.koboDevices.id })
      .from(schema.koboDevices)
      .where(and(eq(schema.koboDevices.id, deviceId), eq(schema.koboDevices.userId, userId)))
      .limit(1);

    if (!device) throw new NotFoundException('Device not found');

    await this.db.delete(schema.koboDevices).where(and(eq(schema.koboDevices.id, deviceId), eq(schema.koboDevices.userId, userId)));
  }
}
