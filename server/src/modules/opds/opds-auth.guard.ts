import { createHmac } from 'crypto';

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { PermissionService } from '../../common/services/permission.service';
import { OpdsUserService } from './opds-user.service';
import { UserService } from '../user/user.service';

export interface OpdsRequestUser {
  opdsUserId: number;
  userId: number;
  username: string;
  sortOrder: 'recent' | 'title_asc' | 'title_desc' | 'author_asc' | 'author_desc' | 'series_asc' | 'series_desc';
  isSuperuser: boolean;
  coverToken: string;
}

export function createCoverToken(userId: number, secret: string): string {
  const sig = createHmac('sha256', secret).update(String(userId)).digest('hex').slice(0, 32);
  return `${userId}.${sig}`;
}

function parseCoverToken(token: string, secret: string): number | null {
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const userId = parseInt(token.slice(0, dot), 10);
  if (isNaN(userId) || userId <= 0) return null;
  const expected = createCoverToken(userId, secret);
  if (token !== expected) return null;
  return userId;
}

@Injectable()
export class OpdsAuthGuard implements CanActivate {
  constructor(
    private readonly opdsUserService: OpdsUserService,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    const tokenParam = (request.query as Record<string, string | undefined>).t;
    if (tokenParam) {
      const secret = this.config.get<string>('auth.jwtSecret')!;
      const userId = parseCoverToken(tokenParam, secret);
      if (!userId) throw new UnauthorizedException('Invalid token');

      const fullUser = await this.userService.findByIdWithPermissions(userId);
      if (!fullUser || !fullUser.active) throw new UnauthorizedException('Account not found or disabled');
      if (!this.permissionService.userHas(fullUser, 'opds_access')) throw new ForbiddenException('OPDS access revoked');

      (request as unknown as Record<string, unknown>).opdsUser = {
        opdsUserId: 0,
        userId: fullUser.id,
        username: fullUser.username,
        sortOrder: 'recent',
        isSuperuser: fullUser.isSuperuser,
        coverToken: tokenParam,
      } satisfies OpdsRequestUser;

      return true;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Basic ')) {
      reply.header('WWW-Authenticate', 'Basic realm="projectx OPDS"');
      throw new UnauthorizedException('Basic authentication required');
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      reply.header('WWW-Authenticate', 'Basic realm="projectx OPDS"');
      throw new UnauthorizedException('Invalid credentials');
    }

    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);

    const result = await this.opdsUserService.validateCredentials(username, password);
    if (!result) {
      reply.header('WWW-Authenticate', 'Basic realm="projectx OPDS"');
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!result.parentUser.active) {
      throw new UnauthorizedException('Account is disabled');
    }

    const fullUser = await this.userService.findByIdWithPermissions(result.parentUser.id);
    if (!fullUser) {
      throw new UnauthorizedException('Account not found');
    }

    if (!this.permissionService.userHas(fullUser, 'opds_access')) {
      throw new ForbiddenException('OPDS access revoked');
    }

    const secret = this.config.get<string>('auth.jwtSecret')!;

    (request as unknown as Record<string, unknown>).opdsUser = {
      opdsUserId: result.opdsUser.id,
      userId: result.parentUser.id,
      username: result.opdsUser.username,
      sortOrder: result.opdsUser.sortOrder,
      isSuperuser: fullUser.isSuperuser,
      coverToken: createCoverToken(result.parentUser.id, secret),
    } satisfies OpdsRequestUser;

    return true;
  }
}
