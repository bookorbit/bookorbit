import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { AUDIT_EVENT } from '../../modules/audit/audit-events.service';
import { AUDITABLE_KEY } from '../decorators/auditable.decorator';
import { AuditInterceptor } from './audit.interceptor';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AuditInterceptor', () => {
  it('passes through untouched when endpoint is not auditable', async () => {
    const reflector = {
      get: vi.fn().mockReturnValue(undefined),
    };
    const auditEvents = {
      emit: vi.fn(),
    };
    const interceptor = new AuditInterceptor(reflector as never, auditEvents as never);
    const next: CallHandler = {
      handle: vi.fn().mockReturnValue(of({ ok: true })),
    };

    const response = await firstValueFrom(interceptor.intercept(makeContext({ ip: '127.0.0.1' }), next));

    expect(response).toEqual({ ok: true });
    expect(auditEvents.emit).not.toHaveBeenCalled();
  });

  it('emits audit events with user, resource id, and dynamic description', async () => {
    const reflector = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key !== AUDITABLE_KEY) return undefined;
        return {
          action: (_req: unknown, body: { source: string }) => (body.source === 'test' ? 'smart_scope.create' : 'smart_scope.update'),
          resource: 'smart_scope',
          getResourceId: (_req: unknown, body: { id: number }) => body.id,
          getMeta: (_req: unknown, body: { source: string }) => ({ source: body.source }),
          description: (_req: unknown, body: { name: string }) => `Created Smart Scope ${body.name}`,
        };
      }),
    };
    const auditEvents = {
      emit: vi.fn(),
    };
    const interceptor = new AuditInterceptor(reflector as never, auditEvents as never);
    const next: CallHandler = {
      handle: vi.fn().mockReturnValue(of({ id: 22, name: 'Favorites', source: 'test' })),
    };
    const context = makeContext({
      ip: '10.0.0.8',
      user: {
        id: 7,
        username: 'reader',
      },
    });

    await firstValueFrom(interceptor.intercept(context, next));

    expect(auditEvents.emit).toHaveBeenCalledWith(AUDIT_EVENT, {
      userId: 7,
      actorUsername: 'reader',
      action: 'smart_scope.create',
      resource: 'smart_scope',
      resourceId: 22,
      description: 'Created Smart Scope Favorites',
      ip: '10.0.0.8',
      meta: { source: 'test' },
    });
  });

  it('records nothing when the endpoint says this call is not worth recording', async () => {
    const when = vi.fn().mockReturnValue(false);
    const reflector = {
      get: vi.fn().mockReturnValue({
        action: 'book.metadata_update',
        description: 'Refreshed metadata for book #4',
        when,
      }),
    };
    const auditEvents = {
      emit: vi.fn(),
    };
    const interceptor = new AuditInterceptor(reflector as never, auditEvents as never);
    const next: CallHandler = {
      handle: vi.fn().mockReturnValue(of({ id: 4 })),
    };
    const request = { ip: '::1', query: { preview: 'true' } };

    const response = await firstValueFrom(interceptor.intercept(makeContext(request), next));

    expect(response).toEqual({ id: 4 });
    expect(when).toHaveBeenCalledWith(request, { id: 4 });
    expect(auditEvents.emit).not.toHaveBeenCalled();
  });

  it('records the call when the endpoint says it is worth recording', async () => {
    const reflector = {
      get: vi.fn().mockReturnValue({
        action: 'book.metadata_update',
        description: 'Refreshed metadata for book #4',
        when: () => true,
      }),
    };
    const auditEvents = {
      emit: vi.fn(),
    };
    const interceptor = new AuditInterceptor(reflector as never, auditEvents as never);
    const next: CallHandler = {
      handle: vi.fn().mockReturnValue(of({ id: 4 })),
    };

    await firstValueFrom(interceptor.intercept(makeContext({ ip: '::1', query: {} }), next));

    expect(auditEvents.emit).toHaveBeenCalledTimes(1);
  });

  it('falls back to system actor when request user is absent', async () => {
    const reflector = {
      get: vi.fn().mockReturnValue({
        action: 'system.event',
        description: 'System audit event',
      }),
    };
    const auditEvents = {
      emit: vi.fn(),
    };
    const interceptor = new AuditInterceptor(reflector as never, auditEvents as never);
    const next: CallHandler = {
      handle: vi.fn().mockReturnValue(of({})),
    };

    await firstValueFrom(interceptor.intercept(makeContext({ ip: '::1' }), next));

    expect(auditEvents.emit).toHaveBeenCalledWith(
      AUDIT_EVENT,
      expect.objectContaining({
        userId: null,
        actorUsername: 'system',
        ip: '::1',
      }),
    );
  });
});
