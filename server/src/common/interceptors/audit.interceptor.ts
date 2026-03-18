import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import type { RequestUser } from '../types/request-user';
import { AUDITABLE_KEY, AuditableOptions, AuditRequest } from '../decorators/auditable.decorator';
import { AUDIT_EVENT, AuditEventsService } from '../../modules/audit/audit-events.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditEvents: AuditEventsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditableOptions | undefined>(AUDITABLE_KEY, context.getHandler());
    if (!options) return next.handle();

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: RequestUser }>() as AuditRequest & { user?: RequestUser; ip: string };

    return next.handle().pipe(
      tap((responseBody) => {
        const user = req.user;
        const description = typeof options.description === 'function' ? options.description(req, responseBody) : options.description;

        this.auditEvents.emit(AUDIT_EVENT, {
          userId: user?.id ?? null,
          actorUsername: user?.username ?? 'system',
          action: options.action,
          resource: options.resource,
          resourceId: options.getResourceId?.(req, responseBody),
          description,
          ip: req.ip,
        });
      }),
    );
  }
}
