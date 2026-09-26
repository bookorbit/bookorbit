import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { FastifyRequest } from 'fastify';

import type { RequestUser } from '../../common/types/request-user';
import { PodcastStreamTicketService } from './podcast-stream-ticket.service';

export function firstQueryValue(query: unknown, key: string): string | undefined {
  const value = (query as Record<string, string | string[] | undefined> | undefined)?.[key];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/**
 * The stream route is the one podcast route a native player loads as a bare URL, so it accepts a
 * single-episode ticket in the query string. Without a ticket it falls back to the normal JWT
 * flow, which the route's `@Public()` marker would otherwise skip.
 */
@Injectable()
export class PodcastStreamAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly tickets: PodcastStreamTicketService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ticket = firstQueryValue(request.query, 'ticket');
    if (!ticket) return (await super.canActivate(context)) as boolean;

    const episodeId = Number((request.params as Record<string, string> | undefined)?.episodeId);
    if (!Number.isInteger(episodeId) || episodeId <= 0) throw new UnauthorizedException('Invalid podcast stream ticket');
    (request as unknown as Record<string, unknown>).user = await this.tickets.authorize(ticket, episodeId);
    return true;
  }

  handleRequest<T extends RequestUser>(err: unknown, user: T): T {
    if (err || !user) throw new UnauthorizedException();
    if (user.isDefaultPassword) throw new ForbiddenException('Password change required');
    return user;
  }
}
