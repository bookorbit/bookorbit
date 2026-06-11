import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { Permission } from '@bookorbit/types';
import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { PermissionService } from '../../../common/services/permission.service';
import { UserService } from '../../user/user.service';

export interface KoboDeviceContext {
  deviceId: number;
  deviceToken: string;
  userId: number;
}

@Injectable()
export class KoboTokenGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const deviceToken = (request.params as Record<string, string | undefined>).deviceToken;
    const clientDeviceId = this.readHeader(request.headers?.['x-kobo-deviceid']);

    if (!deviceToken && !clientDeviceId) throw new UnauthorizedException('Missing device token');

    let device: typeof schema.koboDevices.$inferSelect | undefined;
    if (deviceToken) {
      device = await this.db.query.koboDevices.findFirst({
        where: eq(schema.koboDevices.token, deviceToken),
      });
    } else {
      if (!clientDeviceId) throw new UnauthorizedException('Missing device token');
      device = await this.db.query.koboDevices.findFirst({
        where: eq(schema.koboDevices.clientDeviceId, clientDeviceId),
      });
    }

    if (!device) throw new UnauthorizedException(deviceToken ? 'Invalid device token' : 'Unknown Kobo device');

    const user = await this.userService.findByIdWithPermissions(device.userId);
    if (!user || !user.active) throw new UnauthorizedException('Account not found or disabled');
    if (!this.permissionService.userHas(user, Permission.KoboSync)) throw new UnauthorizedException('Kobo sync permission revoked');

    // Tokened calls learn the device's hardware id so token-less Reading Services
    // calls (no :deviceToken in the path) can be attributed to the same device.
    if (clientDeviceId) {
      await this.touchDevice(device.id, clientDeviceId).catch(() => undefined);
    } else {
      this.touchDevice(device.id, null).catch(() => undefined);
    }

    (request as unknown as Record<string, unknown>).user = user;
    (request as unknown as Record<string, unknown>).koboDevice = {
      deviceId: device.id,
      deviceToken: device.token,
      userId: device.userId,
    } satisfies KoboDeviceContext;

    return true;
  }

  private async touchDevice(deviceId: number, clientDeviceId: string | null): Promise<void> {
    if (clientDeviceId) {
      await this.db
        .update(schema.koboDevices)
        .set({ clientDeviceId: null })
        .where(and(eq(schema.koboDevices.clientDeviceId, clientDeviceId), ne(schema.koboDevices.id, deviceId)));
    }

    await this.db
      .update(schema.koboDevices)
      .set({ lastSeenAt: new Date(), ...(clientDeviceId && { clientDeviceId }) })
      .where(eq(schema.koboDevices.id, deviceId));
  }

  private readHeader(value: string | string[] | undefined): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (!raw) return null;
    const normalized = raw.trim();
    return normalized.length > 0 && normalized.length <= 128 ? normalized : null;
  }
}
