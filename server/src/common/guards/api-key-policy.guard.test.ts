import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AllowApiKey, InteractiveOnly, KeyReadSafe } from '../decorators/api-key-policy.decorator';
import type { ApiKeyCredential } from '../types/request-user';
import { ApiKeyPolicyGuard } from './api-key-policy.guard';

@InteractiveOnly()
class AccountController {
  me() {}
  sessions() {}
}
AllowApiKey()(AccountController.prototype, 'me', Object.getOwnPropertyDescriptor(AccountController.prototype, 'me')!);

class BooksController {
  list() {}
  query() {}
  update() {}
  rotate() {}
}
KeyReadSafe()(BooksController.prototype, 'query', Object.getOwnPropertyDescriptor(BooksController.prototype, 'query')!);
InteractiveOnly()(BooksController.prototype, 'rotate', Object.getOwnPropertyDescriptor(BooksController.prototype, 'rotate')!);

function key(access: 'read' | 'write'): ApiKeyCredential {
  return { kind: 'api_key', keyId: 1, keyName: 'k', audience: 'api', access, libraryIds: null, ownerIsSuperuser: false };
}

function context(controller: new () => object, method: string, httpMethod: string, credential?: unknown, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    getClass: () => controller,
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    switchToHttp: () => ({ getRequest: () => ({ method: httpMethod, user: credential === undefined ? { id: 1 } : { id: 1, credential } }) }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyPolicyGuard', () => {
  const guard = new ApiKeyPolicyGuard(new Reflector());

  it('never touches a session request', () => {
    expect(guard.canActivate(context(AccountController, 'sessions', 'DELETE'))).toBe(true);
    expect(guard.canActivate(context(BooksController, 'update', 'PATCH', { kind: 'session', sessionId: 3 }))).toBe(true);
  });

  it('refuses a key on an interactive-only controller unless the handler allows keys', () => {
    expect(() => guard.canActivate(context(AccountController, 'sessions', 'GET', key('write')))).toThrow(ForbiddenException);
    expect(guard.canActivate(context(AccountController, 'me', 'GET', key('read')))).toBe(true);
    expect(() => guard.canActivate(context(BooksController, 'rotate', 'GET', key('write')))).toThrow('API keys cannot use this route');
  });

  it('keeps a read-only key to reads, by HTTP method or an explicit read-safe marker', () => {
    expect(guard.canActivate(context(BooksController, 'list', 'GET', key('read')))).toBe(true);
    expect(guard.canActivate(context(BooksController, 'list', 'HEAD', key('read')))).toBe(true);
    expect(guard.canActivate(context(BooksController, 'query', 'POST', key('read')))).toBe(true);
    try {
      guard.canActivate(context(BooksController, 'update', 'PATCH', key('read')));
      expect.unreachable();
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toMatchObject({ errorCode: 'API_KEY_READ_ONLY' });
    }
    expect(guard.canActivate(context(BooksController, 'update', 'PATCH', key('write')))).toBe(true);
  });

  it('leaves socket messages to the gateway that authenticated the socket', () => {
    expect(guard.canActivate(context(AccountController, 'sessions', 'GET', key('read'), 'ws'))).toBe(true);
  });
});
