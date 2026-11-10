import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { from, Observable, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';

import { apiKeyCredentialOf, type RequestUser } from '../types/request-user';
import { AUDITABLE_KEY, AuditableOptions, AuditRequest } from '../decorators/auditable.decorator';
import { runAsApiKey } from '../../modules/audit/api-key-audit-context';
import { AUDIT_EVENT, AuditEventsService } from '../../modules/audit/audit-events.service';
import { AuditTargetLabelService } from '../../modules/audit/audit-target-label.service';

const REMOVES_TARGET = /\.(delete|purge|remove)$/;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditEvents: AuditEventsService,
    @Optional() private readonly targetLabels?: AuditTargetLabelService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const credential = context.getType() === 'http' ? apiKeyCredentialOf(context.switchToHttp().getRequest<{ user?: RequestUser }>().user) : null;
    if (!credential) return this.audit(context, next);
    // The handler only runs once the response is subscribed to, so the subscription is what has to
    // happen inside the key's async context for every audit event the request causes to name the key.
    const actor = { keyId: credential.keyId, keyName: credential.keyName };
    return new Observable((subscriber) => runAsApiKey(actor, () => this.audit(context, next).subscribe(subscriber)));
  }

  private audit(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditableOptions | undefined>(AUDITABLE_KEY, context.getHandler());
    if (!options) return next.handle();

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: RequestUser }>() as AuditRequest & { user?: RequestUser; ip: string };

    // A delete leaves nothing to name afterwards, so its target's name is read before the handler runs.
    const before = this.removesTarget(req, options) ? from(this.labelBefore(req, options)) : of(undefined);

    return before.pipe(
      switchMap((resourceLabel) =>
        next.handle().pipe(
          tap((responseBody) => {
            if (options.when && !options.when(req, responseBody)) return;
            const user = req.user;
            const action = typeof options.action === 'function' ? options.action(req, responseBody) : options.action;
            const description = typeof options.description === 'function' ? options.description(req, responseBody) : options.description;
            const meta = options.getMeta?.(req, responseBody);

            this.auditEvents.emit(AUDIT_EVENT, {
              userId: user?.id ?? null,
              actorUsername: user?.username ?? 'system',
              action,
              resource: options.resource,
              resourceId: options.getResourceId?.(req, responseBody),
              description,
              ip: req.ip,
              ...(meta ? { meta } : {}),
              ...(resourceLabel ? { resourceLabel } : {}),
            });
          }),
        ),
      ),
    );
  }

  private removesTarget(req: AuditRequest, options: AuditableOptions): boolean {
    if (!this.targetLabels || !options.resource || !options.getResourceId) return false;
    return req.method === 'DELETE' || (typeof options.action === 'string' && REMOVES_TARGET.test(options.action));
  }

  private async labelBefore(req: AuditRequest, options: AuditableOptions): Promise<string | undefined> {
    let resourceId: number | undefined;
    try {
      resourceId = options.getResourceId?.(req, undefined);
    } catch {
      return undefined;
    }
    if (!Number.isInteger(resourceId)) return undefined;
    return (await this.targetLabels!.resolveForWrite(options.resource, resourceId)) ?? undefined;
  }
}
