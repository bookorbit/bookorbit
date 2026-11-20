import { Body, Controller, Get, Injectable, Post, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { buildEmptyJsonBodyStream, markEmptyBodyInjected, shouldInjectEmptyJsonBody } from '../../common/utils/bootstrap.utils';
import { AppAttestGuard, RequireAppAttest } from './app-attest.guard';
import type { AppAttestPolicy } from './app-attest.policy';
import { APP_ATTEST_HEADERS, AppAttestService, appAttestBodySha256, appAttestClientData } from './app-attest.service';
import { AppAttestStore } from './app-attest.store';
import { fixtureAssertion, fixtureAttestation } from './test-fixtures/app-attest-test-helpers';
import { ATTESTATION_FIXTURE } from './test-fixtures/attestation-fixture';

const fixture = ATTESTATION_FIXTURE;

function contextFor(user: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user, method: 'GET', url: '/probe', headers: {} }) }) } as unknown as ExecutionContext;
}

@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<{ user: unknown }>().user = { id: 7 };
    return true;
  }
}

@Controller('probe')
@UseGuards(StubAuthGuard, AppAttestGuard)
class ProbeController {
  @Get()
  read() {
    return { ok: true };
  }

  @Post()
  write(@Body() body: Record<string, unknown>) {
    return { ok: true, body };
  }
}

// Decorators apply from the bottom up, so the stub's user is set before App Attest runs.
@Controller('probe-unsigned')
@RequireAppAttest({ unsignedOutsideProduction: true })
@UseGuards(StubAuthGuard)
class UnsignedProbeController {
  @Get()
  read() {
    return { ok: true };
  }
}

describe('AppAttestGuard', () => {
  let app: NestFastifyApplication;
  let counter = 0;
  const policy: AppAttestPolicy = { appIds: [fixture.appId], allowDevelopment: true, trustedRoots: [fixture.rootPem], acceptUnsigned: false };

  beforeAll(async () => {
    const store = new AppAttestStore();
    const service = new AppAttestService(policy, store);
    store.addChallenge(fixture.challenge, 7);
    service.registerKey({ id: 7 } as never, {
      keyId: fixture.keyId,
      attestation: fixtureAttestation().toString('base64'),
      challenge: fixture.challenge,
    });

    const module = await Test.createTestingModule({
      controllers: [ProbeController, UnsignedProbeController],
      providers: [{ provide: AppAttestService, useValue: service }, AppAttestGuard, StubAuthGuard],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false, rawBody: true });
    app.setGlobalPrefix('api/v1');
    // Mirrors the empty JSON body injection in main.ts.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('preParsing', (request, _reply, payload, done) => {
        if (shouldInjectEmptyJsonBody(request.method, request.headers)) {
          markEmptyBodyInjected(request);
          done(null, buildEmptyJsonBodyStream(request.headers));
          return;
        }
        done(null, payload);
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function attest(method: string, url: string, signedBody: Buffer) {
    const timestamp = String(Date.now());
    const assertion = fixtureAssertion(appAttestClientData(method, url, timestamp, appAttestBodySha256(signedBody)), ++counter);
    return {
      [APP_ATTEST_HEADERS.keyId]: fixture.keyId,
      [APP_ATTEST_HEADERS.assertion]: assertion.toString('base64'),
      [APP_ATTEST_HEADERS.timestamp]: timestamp,
    };
  }

  function errorCodeOf(response: { json: () => unknown }) {
    return (response.json() as { errorCode?: string }).errorCode;
  }

  it('verifies a bodyless request', async () => {
    const url = '/api/v1/probe?x=1';
    const response = await app.inject({ method: 'GET', url, headers: attest('GET', url, Buffer.alloc(0)) });
    expect(response.statusCode).toBe(200);
  });

  it('verifies a JSON body against its raw bytes', async () => {
    const url = '/api/v1/probe';
    const payload = '{"a": 1,  "b":[2]}';
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...attest('POST', url, Buffer.from(payload)) },
      payload,
    });
    expect(response.statusCode).toBe(201);
  });

  it('rejects a JSON body that differs from the signed one', async () => {
    const url = '/api/v1/probe';
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...attest('POST', url, Buffer.from('{"a":1}')) },
      payload: '{"a":2}',
    });
    expect(response.statusCode).toBe(403);
    expect(errorCodeOf(response)).toBe('APP_ATTEST_INVALID');
  });

  it('treats an empty JSON-typed body as empty, not as the injected {}', async () => {
    const url = '/api/v1/probe';
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...attest('POST', url, Buffer.alloc(0)) },
    });
    expect(response.statusCode).toBe(201);
  });

  it('refuses a request without an assertion', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/probe' });
    expect(response.statusCode).toBe(403);
    expect(errorCodeOf(response)).toBe('APP_ATTEST_REQUIRED');
  });

  describe('on a route that accepts unsigned requests outside production', () => {
    afterEach(() => {
      policy.acceptUnsigned = false;
    });

    it('accepts a request with no assertion when the server is not in production', async () => {
      policy.acceptUnsigned = true;
      expect((await app.inject({ method: 'GET', url: '/api/v1/probe-unsigned' })).statusCode).toBe(200);
    });

    it('still verifies a request that carries an assertion', async () => {
      policy.acceptUnsigned = true;
      const forged = {
        [APP_ATTEST_HEADERS.keyId]: 'A'.repeat(43) + '=',
        [APP_ATTEST_HEADERS.assertion]: 'AAAA',
        [APP_ATTEST_HEADERS.timestamp]: String(Date.now()),
      };
      const response = await app.inject({ method: 'GET', url: '/api/v1/probe-unsigned', headers: forged });
      expect(response.statusCode).toBe(403);
      expect(errorCodeOf(response)).toBe('APP_ATTEST_KEY_UNKNOWN');
      const partial = await app.inject({ method: 'GET', url: '/api/v1/probe-unsigned', headers: { [APP_ATTEST_HEADERS.keyId]: fixture.keyId } });
      expect(errorCodeOf(partial)).toBe('APP_ATTEST_REQUIRED');
      const url = '/api/v1/probe-unsigned';
      expect((await app.inject({ method: 'GET', url, headers: attest('GET', url, Buffer.alloc(0)) })).statusCode).toBe(200);
    });

    it('refuses a request with no assertion on a production server', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/probe-unsigned' });
      expect(response.statusCode).toBe(403);
      expect(errorCodeOf(response)).toBe('APP_ATTEST_REQUIRED');
    });

    it('leaves every other guarded route refusing unsigned requests', async () => {
      policy.acceptUnsigned = true;
      expect((await app.inject({ method: 'GET', url: '/api/v1/probe' })).statusCode).toBe(403);
    });
  });

  it('refuses an API key before verifying, because a key is never an attested app', () => {
    const verifyRequest = vi.fn();
    const keyUser = { id: 7, credential: { kind: 'api_key', keyId: 3 } };
    const guard = new AppAttestGuard({ verifyRequest } as never);
    expect(() => guard.canActivate(contextFor(keyUser))).toThrow('API keys cannot use this route');
    expect(verifyRequest).not.toHaveBeenCalled();
  });
});
