import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
    const deviceToken = (request.params as Record<string, string>).deviceToken;

    if (!deviceToken) throw new UnauthorizedException('Missing device token');

    const device = await this.db.query.koboDevices.findFirst({
      where: eq(schema.koboDevices.token, deviceToken),
    });

    if (!device) throw new UnauthorizedException('Invalid device token');

    const user = await this.userService.findByIdWithPermissions(device.userId);
    if (!user || !user.active) throw new UnauthorizedException('Account not found or disabled');
    if (!this.permissionService.userHas(user, Permission.KoboSync)) throw new UnauthorizedException('Kobo sync permission revoked');

    // Update last seen asynchronously so it doesn't block the request
    this.db
      .update(schema.koboDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.koboDevices.id, device.id))
      .catch(() => undefined);

    (request as unknown as Record<string, unknown>).user = user;
    (request as unknown as Record<string, unknown>).koboDevice = {
      deviceId: device.id,
      deviceToken: device.token,
      userId: device.userId,
    } satisfies KoboDeviceContext;

    return true;
  }
}
